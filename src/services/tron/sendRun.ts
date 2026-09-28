/**
 * A plain USDT send from the moment the user confirms it to its end, kept
 * outside any screen.
 *
 * A screen can close, and the app can be killed, while a transfer is being
 * sent. That transfer is signed and may still reach a block afterwards, so the
 * send is written down before anything is signed, and every transfer is
 * recorded before it is posted (the onSubmit of sendUsdt). From that record:
 *   - no new send starts while a transfer could still land, which is what
 *     stops the same USDT going twice;
 *   - after a restart, the recorded transfers are settled against the chain
 *     before anything else is shown or offered.
 *
 * The swap runner's smaller twin: a send ends when its transfer is in a block,
 * where a swap carries on into an order to follow. The rules about what may be
 * said are the same and matter as much. Nothing is ever described as not sent
 * unless the chain or the backend settled that.
 *
 * The record store is passed in, so this runs under test with a plain object
 * and in the app with the persisted store (stores/usdtSendStore.ts).
 *
 * Nothing here logs.
 */

import {
    type SendingAccount,
    type SubmittedTransfer,
    type TronSendRemedy,
    type UsdtSendParams,
    type UsdtSendReceipt,
    type UsdtTransferFate,
    TronSendError,
    awaitUsdtTransferOutcome,
    confirmUsdtTransfer,
    sendUsdt,
} from './send';
import type { UsdtTransferSigner } from './transaction';

export type UsdtSendPhase =
    /** Signing and posting the transfer, in this app session. */
    | 'sending'
    /** Reading the chain to learn whether an interrupted send went out. */
    | 'checking'
    /** The outcome could not be read. Nothing new is sent until it is. */
    | 'unconfirmed'
    /** The transfer is in a block and the USDT arrived. */
    | 'sent'
    /** The transfer did not go out, so no USDT moved. */
    | 'not_sent';

export type UsdtSendTransfer = { readonly txID: string; readonly expirationMs: number };

export type UsdtSendRecord = {
    readonly id: string;
    readonly phase: UsdtSendPhase;
    readonly startedAtMs: number;
    readonly updatedAtMs: number;
    /** What the user asked for, to show while it runs and after it ends. */
    readonly request: {
        /** The USDT amount as a decimal string. */
        readonly amount: string;
        /** The Tron address it is going to. */
        readonly destination: string;
        /** The Tron address it is leaving, so a record cannot be shown for another wallet. */
        readonly from: string;
    };
    /** Every transfer signed for this send, oldest first, recorded before it was posted. */
    readonly transfers: readonly UsdtSendTransfer[];
    /** The transfer that reached a block. */
    readonly txID?: string;
    /** Why it did not go out, or why that is not known. Safe to show. */
    readonly sendError?: {
        readonly code: string;
        readonly message: string;
        readonly remedy: TronSendRemedy;
    };
};

export type UsdtSendRecordStore = {
    readonly get: () => UsdtSendRecord | null;
    readonly set: (record: UsdtSendRecord | null) => void;
};

export type UsdtSendRunnerDeps = {
    readonly send: (params: UsdtSendParams) => Promise<UsdtSendReceipt>;
    readonly confirm: (transfer: SubmittedTransfer) => Promise<unknown>;
    readonly settleTransfer: (txID: string, expirationMs: number) => Promise<UsdtTransferFate>;
    readonly now: () => number;
    readonly newId: () => string;
};

const DEFAULT_DEPS: UsdtSendRunnerDeps = {
    send: params => sendUsdt(params),
    confirm: transfer => confirmUsdtTransfer(transfer),
    settleTransfer: (txID, expirationMs) => awaitUsdtTransferOutcome(txID, expirationMs),
    now: () => Date.now(),
    newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
};

export type UsdtSendStart = {
    readonly account: SendingAccount;
    /** The Tron address to send to. */
    readonly to: string;
    /** The amount as a decimal string, for display. */
    readonly amount: string;
    /** The same amount in USDT's smallest unit, as the send takes it. */
    readonly amountUnits: string;
    readonly sign: UsdtTransferSigner;
};

export type UsdtSendRunner = {
    /** Whether a new send may start: not while a transfer could still land. */
    canStart(): boolean;
    /**
     * Record the send, then sign it and wait for it to land. Returns once the
     * record is written, before anything is signed; the rest runs on and
     * reports through the record. Throws when a send is already under way.
     */
    start(input: UsdtSendStart): void;
    /** Carry on with the recorded send: settle an interrupted one against the chain. */
    resume(): void;
    /**
     * Forget the recorded send, when that is safe: once it has ended either
     * way. Returns whether it was forgotten. An unconfirmed send is never
     * forgotten, because its transfer may still land.
     */
    dismiss(): boolean;
};

const NOTHING_MOVED = 'The transfer did not go out, so no USDT moved.';

const UNCONFIRMED =
    'Could not confirm whether your transfer went out. It may still land, so do not send this USDT again until this is settled. Check again once you are online.';

/** A send in one of these phases has ended, and may be replaced or forgotten. */
const ENDED: readonly UsdtSendPhase[] = ['sent', 'not_sent'];

/** Why the send failed, as the record keeps it. */
function sendFailure(error: unknown, signed: boolean): Pick<UsdtSendRecord, 'phase' | 'sendError'> {
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
        sendError: { code: 'NOT_SENT', message: 'The transfer could not be prepared. Nothing was sent.', remedy: 'none' },
    };
}

export function createUsdtSendRunner(
    store: UsdtSendRecordStore,
    deps: UsdtSendRunnerDeps = DEFAULT_DEPS,
): UsdtSendRunner {
    /** A send or a check is running. Either may learn that a transfer is out. */
    let running = false;

    /** Update the record, unless it was dismissed or replaced while the work ran. */
    const patch = (id: string, change: Partial<UsdtSendRecord>) => {
        const record = store.get();
        if (!record || record.id !== id) return;
        store.set({ ...record, ...change, updatedAtMs: deps.now() });
    };

    const canStart = () => {
        const record = store.get();
        return !running && (!record || ENDED.includes(record.phase));
    };

    async function send(id: string, input: UsdtSendStart): Promise<void> {
        try {
            const receipt = await deps.send({
                from: input.account,
                to: input.to,
                amountUnits: input.amountUnits,
                sign: input.sign,
                onSubmit: transfer => {
                    const record = store.get();
                    if (!record || record.id !== id) return;
                    patch(id, {
                        transfers: [...record.transfers, { txID: transfer.txID, expirationMs: transfer.expirationMs }],
                    });
                },
            });
            await deps.confirm(receipt);
            patch(id, { phase: 'sent', txID: receipt.txID, sendError: undefined });
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
                    patch(id, { phase: 'sent', txID: transfer.txID, sendError: undefined });
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

    /** Errors are recorded where they happen, never thrown from here. */
    function run(work: () => Promise<void>): void {
        running = true;
        void work()
            .catch(() => undefined)
            .finally(() => {
                running = false;
            });
    }

    return {
        canStart,

        start(input) {
            if (!canStart()) {
                throw new Error('A send is already under way');
            }
            const now = deps.now();
            const id = deps.newId();
            store.set({
                id,
                phase: 'sending',
                startedAtMs: now,
                updatedAtMs: now,
                request: { amount: input.amount, destination: input.to, from: input.account.address },
                transfers: [],
            });
            run(() => send(id, input));
        },

        resume() {
            const record = store.get();
            if (!record || running) return;
            if (record.phase === 'sending' || record.phase === 'checking' || record.phase === 'unconfirmed') {
                // Not sending in this session, so the app stopped mid-send or
                // the outcome was unreadable. The chain decides what happened.
                run(() => check(record.id));
            }
        },

        dismiss() {
            const record = store.get();
            if (!record) return true;
            if (running || !ENDED.includes(record.phase)) return false;
            store.set(null);
            return true;
        },
    };
}

/* ------------------------------------------------------------------ */
/* What the screen says about it                                       */
/* ------------------------------------------------------------------ */

export type UsdtSendView = {
    readonly title: string;
    readonly detail: string;
    readonly tone: 'working' | 'success' | 'problem';
    /** Work is under way: show a spinner and no buttons. */
    readonly busy: boolean;
    /** Nothing moved and another attempt is reasonable. */
    readonly canRetry: boolean;
    /** A transfer may still land, so settle it rather than sending again. */
    readonly canCheckAgain: boolean;
    /** Show the transfer id, for support and for a block explorer. */
    readonly txID?: string;
};

/** A remedy that means nothing moved and trying again now is reasonable. */
const RETRYABLE: ReadonlySet<TronSendRemedy> = new Set<TronSendRemedy>(['retry', 'wait', 'retry_later']);

/**
 * Where a send is, for the screen that shows it.
 *
 * Kept beside the record rather than in the screen so the mapping, which
 * decides what a user is told about their money, is unit-tested. Nothing here
 * says the transfer did not go out unless the phase is the one the chain or
 * the backend settled.
 */
export function describeUsdtSend(record: UsdtSendRecord): UsdtSendView {
    const latest = record.txID ?? record.transfers[record.transfers.length - 1]?.txID;
    const withTx = (view: Omit<UsdtSendView, 'txID'>): UsdtSendView => ({
        ...view,
        ...(latest ? { txID: latest } : {}),
    });

    switch (record.phase) {
        case 'sending':
            return withTx({
                title: 'Sending your USDT',
                detail: `Your ${record.request.amount} USDT is on its way to ${record.request.destination}. This usually takes about a minute.`,
                tone: 'working',
                busy: true,
                canRetry: false,
                canCheckAgain: false,
            });
        case 'checking':
            return withTx({
                title: 'Checking your transfer',
                detail: 'The app closed while your transfer was being sent. Checking the Tron network to see whether it went out.',
                tone: 'working',
                busy: true,
                canRetry: false,
                canCheckAgain: false,
            });
        case 'unconfirmed':
            return withTx({
                title: 'Not confirmed yet',
                detail: record.sendError?.message ?? 'Could not confirm whether your transfer went out.',
                tone: 'problem',
                busy: false,
                canRetry: false,
                canCheckAgain: true,
            });
        case 'not_sent':
            return withTx({
                title: 'Not sent',
                detail: record.sendError?.message ?? NOTHING_MOVED,
                tone: 'problem',
                busy: false,
                canRetry: RETRYABLE.has(record.sendError?.remedy ?? 'none'),
                canCheckAgain: false,
            });
        case 'sent':
            return withTx({
                title: 'Sent',
                detail: `${record.request.amount} USDT is on its way to ${record.request.destination}.`,
                tone: 'success',
                busy: false,
                canRetry: false,
                canCheckAgain: false,
            });
    }
}
