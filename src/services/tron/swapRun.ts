/**
 * A USDT swap from the moment the user confirms it to its end, kept outside
 * any screen.
 *
 * A screen can close, and the app can be killed, while the deposit is being
 * sent. The deposit is a signed Tron transfer that may still land after that,
 * so the swap is written down before anything is signed, and every transfer is
 * recorded before it is posted (the onSubmit of payUsdtConversion). From that
 * record:
 *   - no new swap starts while a deposit could still land;
 *   - after a restart, the recorded transfers are settled against the chain
 *     before anything else is shown or offered, as the terminal harness's
 *     `follow` does;
 *   - once the deposit is in a block, the order is followed until it ends,
 *     from whichever screen opens it.
 *
 * The record store is passed in, so this runs under test with a plain object
 * and in the app with the persisted store (stores/usdtSwapStore.ts). The same
 * goes for the conversion calls.
 *
 * Nothing here logs.
 */

import type { ChainSwapOrder, ChainSwapPollResult, ChainSwapStall } from '../chainSwap';
import { isTerminal } from '../chainSwap';
import {
    type FollowUsdtConversionOptions,
    type PreparedUsdtConversion,
    type UsdtConversionPayment,
    followUsdtConversion,
    payUsdtConversion,
} from './conversion';
import {
    type SendingAccount,
    type TronSendRemedy,
    type UsdtTransferFate,
    TronSendError,
    awaitUsdtTransferOutcome,
} from './send';
import type { UsdtTransferSigner } from './transaction';

export type UsdtSwapPhase =
    /** Signing and sending the deposit, in this app session. */
    | 'sending'
    /** Reading the chain to learn whether an interrupted send went out. */
    | 'checking'
    /** The send's outcome could not be read. Nothing new is sent until it is. */
    | 'unconfirmed'
    /** The deposit is in a block, and the order is being followed. */
    | 'following'
    /** The order ended: settled, refunded, expired or failed. */
    | 'finished'
    /** The deposit did not go out, so no USDT moved. */
    | 'not_sent';

/** A ChainSwapOrder with its dates as epoch milliseconds, so it survives JSON. */
export type StoredSwapOrder = Omit<ChainSwapOrder, 'createdAt' | 'expiresAt' | 'statusChangedAt'> & {
    readonly createdAtMs: number;
    readonly expiresAtMs: number;
    readonly statusChangedAtMs: number;
};

export type UsdtSwapTransfer = { readonly txID: string; readonly expirationMs: number };

export type UsdtSwapRecord = {
    /** The quote's id, which names the swap for its whole life. */
    readonly id: string;
    readonly phase: UsdtSwapPhase;
    readonly startedAtMs: number;
    readonly updatedAtMs: number;
    /** What the user asked for, to show and to quote again from. */
    readonly request: {
        /** The USDT amount they entered; unused when the invoice set the amount. */
        readonly usdtAmount: string;
        /** The destination as they entered it, before classification. */
        readonly destination: string;
    };
    /** What the confirmed quote said. Amounts are decimal strings. */
    readonly quote: {
        readonly depositAmount: string;
        /** In bitcoin. */
        readonly settleAmount: string;
        readonly settleAmountIsFirm: boolean;
        readonly minSettleAmount: string | null;
    };
    readonly order: StoredSwapOrder;
    /** Every deposit transfer signed for this swap, oldest first, recorded before it was posted. */
    readonly transfers: readonly UsdtSwapTransfer[];
    readonly stall: ChainSwapStall;
    /** Why the deposit did not go out, or why that is not known. Safe to show. */
    readonly sendError?: {
        readonly code: string;
        readonly message: string;
        readonly remedy: TronSendRemedy;
    };
    /** The last failure to read the order while following it. Safe to show. */
    readonly followError?: string;
};

export type UsdtSwapRecordStore = {
    readonly get: () => UsdtSwapRecord | null;
    readonly set: (record: UsdtSwapRecord | null) => void;
};

export type UsdtSwapRunnerDeps = {
    readonly pay: (payment: UsdtConversionPayment) => Promise<ChainSwapOrder>;
    readonly follow: (order: ChainSwapOrder, options: FollowUsdtConversionOptions) => Promise<ChainSwapPollResult>;
    readonly settleTransfer: (txID: string, expirationMs: number) => Promise<UsdtTransferFate>;
    readonly now: () => number;
};

const DEFAULT_DEPS: UsdtSwapRunnerDeps = {
    pay: payment => payUsdtConversion(payment),
    follow: (order, options) => followUsdtConversion(order, options),
    settleTransfer: (txID, expirationMs) => awaitUsdtTransferOutcome(txID, expirationMs),
    now: () => Date.now(),
};

export type UsdtSwapStart = {
    readonly prepared: Extract<PreparedUsdtConversion, { ready: true }>;
    readonly account: SendingAccount;
    readonly sign: UsdtTransferSigner;
    readonly request: UsdtSwapRecord['request'];
};

export type UsdtSwapRunner = {
    /** Whether a new swap may start: not while a deposit could still land, or an order is being followed. */
    canStart(): boolean;
    /**
     * Record the swap, then pay its deposit and follow the order. Returns once
     * the record is written, before anything is signed; the rest runs on and
     * reports through the record. Throws when a swap is already under way.
     */
    start(input: UsdtSwapStart): void;
    /** Carry on with the recorded swap: settle an interrupted send, or follow the order. */
    resume(): void;
    /**
     * Forget the recorded swap, when that is safe: once it has ended, when
     * nothing was sent, or once its deposit is in a block and only the
     * following would stop. Returns whether it was forgotten.
     */
    dismiss(): boolean;
};

const NOTHING_MOVED = 'The deposit did not go out, so no USDT moved.';

const UNCONFIRMED =
    'Could not confirm whether your deposit went out. It may still land, so do not swap this USDT again until this is settled. Check again once you are online.';

export const toStoredOrder = (order: ChainSwapOrder): StoredSwapOrder => {
    const { createdAt, expiresAt, statusChangedAt, ...rest } = order;
    return {
        ...rest,
        createdAtMs: createdAt.getTime(),
        expiresAtMs: expiresAt.getTime(),
        statusChangedAtMs: statusChangedAt.getTime(),
    };
};

export const fromStoredOrder = (stored: StoredSwapOrder): ChainSwapOrder => {
    const { createdAtMs, expiresAtMs, statusChangedAtMs, ...rest } = stored;
    return {
        ...rest,
        createdAt: new Date(createdAtMs),
        expiresAt: new Date(expiresAtMs),
        statusChangedAt: new Date(statusChangedAtMs),
    };
};

/** A swap in one of these phases may be replaced by a new one. */
const ENDED: readonly UsdtSwapPhase[] = ['finished', 'not_sent'];

/** A swap in one of these may be forgotten: nothing it signed can still land. */
const DISMISSABLE: readonly UsdtSwapPhase[] = ['finished', 'not_sent', 'following'];

/** Why the send failed, as the record keeps it. */
function sendFailure(error: unknown, signed: boolean): Pick<UsdtSwapRecord, 'phase' | 'sendError'> {
    // The send module has settled these against the backend or the chain:
    // nothing moved, and its message says what to do.
    if (error instanceof TronSendError && !error.indeterminate) {
        return { phase: 'not_sent', sendError: { code: error.code, message: error.message, remedy: error.remedy } };
    }
    // An indeterminate send, or anything unexpected once a transfer was
    // signed: that transfer may be on its way to a block.
    if (error instanceof TronSendError || signed) {
        return {
            phase: 'unconfirmed',
            sendError: {
                code: error instanceof TronSendError ? error.code : 'OUTCOME_UNKNOWN',
                message: UNCONFIRMED,
                remedy: 'check_status',
            },
        };
    }
    return {
        phase: 'not_sent',
        sendError: { code: 'NOT_SENT', message: 'The deposit could not be prepared. Nothing was sent.', remedy: 'none' },
    };
}

function followErrorMessage(error: unknown): string {
    return error instanceof Error && error.name === 'VenueUnavailableError'
        ? 'Flashnet is not answering right now. The swap carries on without the app.'
        : 'Could not read this swap from Flashnet. The swap carries on without the app.';
}

export function createUsdtSwapRunner(
    store: UsdtSwapRecordStore,
    deps: UsdtSwapRunnerDeps = DEFAULT_DEPS,
): UsdtSwapRunner {
    /** A send or a check is running. Either may learn that a transfer is out. */
    let sending = false;
    /** The swap whose order is being followed, and how to stop it. */
    let following: { id: string; abort: AbortController } | null = null;

    /** Update the record, unless it was dismissed or replaced while the work ran. */
    const patch = (id: string, change: Partial<UsdtSwapRecord>) => {
        const record = store.get();
        if (!record || record.id !== id) return;
        store.set({ ...record, ...change, updatedAtMs: deps.now() });
    };

    const canStart = () => {
        const record = store.get();
        return !sending && (!record || ENDED.includes(record.phase));
    };

    async function send(id: string, input: UsdtSwapStart): Promise<void> {
        try {
            const paid = await deps.pay({
                order: input.prepared.order,
                account: input.account,
                sign: input.sign,
                onSubmit: transfer => {
                    const record = store.get();
                    if (!record || record.id !== id) return;
                    patch(id, { transfers: [...record.transfers, { txID: transfer.txID, expirationMs: transfer.expirationMs }] });
                },
            });
            patch(id, { phase: 'following', order: toStoredOrder(paid), sendError: undefined });
        } catch (error) {
            const signed = (store.get()?.transfers.length ?? 0) > 0;
            patch(id, sendFailure(error, signed));
        }
    }

    /** Settle an interrupted send from the chain: newest transfer first, as only one can have landed. */
    async function check(id: string): Promise<void> {
        const record = store.get();
        if (!record || record.id !== id) return;
        patch(id, { phase: 'checking' });
        try {
            for (const transfer of [...record.transfers].reverse()) {
                const fate = await deps.settleTransfer(transfer.txID, transfer.expirationMs);
                if (fate.status === 'succeeded') {
                    // Its clock restarts at the landing, as payUsdtConversion's does.
                    const order = { ...record.order, depositTxId: transfer.txID, statusChangedAtMs: deps.now() };
                    patch(id, { phase: 'following', order, sendError: undefined });
                    return;
                }
            }
            const message = record.transfers.length > 0 ? NOTHING_MOVED : 'Nothing was sent.';
            patch(id, { phase: 'not_sent', sendError: { code: 'NOT_SENT', message, remedy: 'retry' } });
        } catch (error) {
            patch(id, {
                phase: 'unconfirmed',
                sendError: {
                    code: error instanceof TronSendError ? error.code : 'OUTCOME_UNKNOWN',
                    message: UNCONFIRMED,
                    remedy: 'check_status',
                },
            });
        }
    }

    async function follow(id: string): Promise<void> {
        const record = store.get();
        if (!record || record.id !== id || record.phase !== 'following' || following?.id === id) return;
        const abort = new AbortController();
        following = { id, abort };
        try {
            const result = await deps.follow(fromStoredOrder(record.order), {
                signal: abort.signal,
                onUpdate: ({ order, stall }) => patch(id, { order: toStoredOrder(order), stall, followError: undefined }),
            });
            if (isTerminal(result.order.status)) {
                patch(id, { phase: 'finished', order: toStoredOrder(result.order), stall: 'none', followError: undefined });
            }
        } catch (error) {
            patch(id, { followError: followErrorMessage(error) });
        } finally {
            if (following?.abort === abort) following = null;
        }
    }

    /** Send or check, then follow. Errors are recorded where they happen, never thrown from here. */
    function runToEnd(id: string, first: () => Promise<void>): void {
        sending = true;
        void first()
            .finally(() => {
                sending = false;
            })
            .then(() => follow(id))
            .catch(() => undefined);
    }

    return {
        canStart,

        start(input) {
            if (!canStart()) {
                throw new Error('A swap is already under way');
            }
            const { prepared, request } = input;
            const now = deps.now();
            const id = prepared.quote.id;
            store.set({
                id,
                phase: 'sending',
                startedAtMs: now,
                updatedAtMs: now,
                request,
                quote: {
                    depositAmount: prepared.quote.depositAmount,
                    settleAmount: prepared.quote.settleAmount,
                    // Absent means committed, per the quote contract.
                    settleAmountIsFirm: prepared.quote.settleAmountIsFirm !== false,
                    minSettleAmount: prepared.quote.minSettleAmount ?? null,
                },
                order: toStoredOrder(prepared.order),
                transfers: [],
                stall: 'none',
            });
            runToEnd(id, () => send(id, input));
        },

        resume() {
            const record = store.get();
            if (!record || sending) return;
            if (record.phase === 'sending' || record.phase === 'checking' || record.phase === 'unconfirmed') {
                // Not sending in this session, so the app stopped mid-send or
                // the outcome was unreadable. The chain decides what happened.
                runToEnd(record.id, () => check(record.id));
            } else if (record.phase === 'following') {
                void follow(record.id).catch(() => undefined);
            }
        },

        dismiss() {
            const record = store.get();
            if (!record) return true;
            if (sending || !DISMISSABLE.includes(record.phase)) return false;
            if (following?.id === record.id) following.abort.abort();
            store.set(null);
            return true;
        },
    };
}
