/**
 * Sending USDT from the user's Tron account.
 *
 * The phone builds and signs each transfer (./transaction). Our backend rents
 * the energy the transfer needs and broadcasts it, because our users hold no
 * TRX to pay the network fee themselves. This module runs that exchange, and
 * it exists mostly to keep one rule:
 *
 *   Never sign a new transfer while an earlier one could still land.
 *
 * Each signed transfer is a payment of its own. If the connection drops while
 * the backend holds one, it may already be on chain, and a fresh signature
 * would pay a second time. So:
 *   - A transfer is signed again only when the backend says the last one did
 *     not go out (RESIGN_REQUIRED, ENERGY_NOT_DELIVERED) and every request for
 *     it got an answer.
 *   - A request that ends without an answer is repeated with the same bytes.
 *     That is safe: the backend and the network both treat a repeat as the
 *     same transfer, and the energy is paid for once.
 *   - When that does not settle it, the chain does. A transfer expires a
 *     minute after its reference block. Once the network is past that and the
 *     transfer is in no block, it never will be, and only then is it treated
 *     as not sent.
 *   - One send runs at a time per account, so a double tap cannot start two.
 *
 * A caller gets a receipt (the transfer is out), or a TronSendError whose
 * remedy says what to offer next. When even the chain cannot be read the
 * error is indeterminate, and that one must never be shown as "your money did
 * not move".
 *
 * Nothing here logs. Everything in scope identifies the user.
 */

import BigNumber from 'bignumber.js';
import { Buffer } from 'buffer';

import {
    TronApiError,
    type TronAccountState,
    type TronSendAnswer,
    type TronSendRefusalCode,
    type TronTransactionOutcome,
    getTronAccountState,
    getTronReferenceBlock,
    getTronTransactionOutcome,
    getTronUsdtBalance,
    postTronSend,
} from '../../api/tronAPIs';
import type { ChainSwapOrder } from '../chainSwap/types';
import { tronAddressFromPublicKey, tronAddressToHex } from './address';
import { USDT_DECIMALS } from './constants';
import { decimalToUnits } from './contract';
import type { TronAccount } from './keys';
import { hasTransferBandwidth, secondsUntilTransferBandwidth, usdtSendNeeds } from './sendNeeds';
import type { SignedUsdtTransfer, TronReferenceBlock, UsdtTransferSigner } from './transaction';

/** Signatures one send may make, the first included. */
const MAX_SIGNATURES = 3;

/** Requests per signed transfer: the first, and one repeat if it goes unanswered. */
const MAX_POSTS_PER_TRANSFER = 2;

/** Pause before repeating an unanswered request. */
const REPOST_DELAY_MS = 2_000;

/** One Tron block, the pace of every poll here. */
const POLL_INTERVAL_MS = 3_000;

/**
 * How long to wait for energy the backend rented but saw arrive too late,
 * before signing again. The backend rents per transfer, so a new signature
 * pays for energy again unless the first rental has landed by then.
 */
const ENERGY_GRACE_MS = 15_000;

/**
 * A node checks a transfer's expiry against the block before the one it is
 * building, so the block after the expiry can still include it. Three blocks
 * of margin before a missing transfer is taken as gone.
 */
const LANDING_MARGIN_MS = 9_000;

/** Failed chain reads in a row before the outcome is called unknown. */
const MAX_READ_FAILURES = 5;

/** Longest wait for an outcome, whatever the chain says. */
const MAX_OUTCOME_WAIT_MS = 180_000;

/**
 * No new signature for a conversion deposit this close to its quote's expiry.
 *
 * A Flashnet quote holds its price for two minutes, and a deposit that lands
 * later is repriced at the live rate rather than refunded. A send takes up to
 * about 35 seconds from signing to a block, so this leaves room for that and
 * for the deposit to be detected.
 */
export const CONVERSION_SEND_MARGIN_MS = 45_000;

const RESIGN_CODES: ReadonlySet<TronSendRefusalCode> = new Set<TronSendRefusalCode>([
    'RESIGN_REQUIRED',
    'ENERGY_NOT_DELIVERED',
]);

/**
 * Senders with a send running, by hex address. One at a time per account: two
 * sends started together, by a double tap say, sign two different transfers,
 * and the backend can pay for and broadcast both before either is on chain.
 */
const sendsInFlight = new Set<string>();

/** What the backend and the chain need to know about the sender. */
export type SendingAccount = Pick<TronAccount, 'address' | 'publicKey'>;

/** A signed transfer about to be posted. */
export type SubmittedTransfer = {
    readonly txID: string;
    /** When it stops being valid, by the network's clock. */
    readonly expirationMs: number;
};

export type UsdtSendReceipt = SubmittedTransfer & {
    /** From the backend's answer. Absent when the chain confirmed the send instead. */
    readonly energyRented?: number;
    readonly activated?: boolean;
};

export type UsdtTransferFate =
    | Exclude<TronTransactionOutcome, { status: 'unknown' }>
    /** Past its expiry and in no block: it did not go out, and now it cannot. */
    | { readonly status: 'dropped' };

/** What a caller should offer after a send fails. */
export type TronSendRemedy =
    /** Nothing moved. Trying again now can work. */
    | 'retry'
    /** Nothing moved. Try again after `detail.retryAfterSeconds`, when it is known. */
    | 'wait'
    /** Nothing moved. Sending is paused or limited for hours. */
    | 'retry_later'
    /** Nothing moved. The conversion needs a new quote first. */
    | 'requote'
    /** Nothing moved, and this send cannot go through as asked. */
    | 'none'
    /**
     * The transfer may still land. Offer no new send until
     * awaitUsdtTransferOutcome settles it, using `detail.txID`.
     */
    | 'check_status';

export type TronSendErrorCode =
    | TronSendRefusalCode
    /** The quote is too close to expiry to start a deposit. */
    | 'QUOTE_EXPIRING'
    /** Could not read the Tron network to prepare the transfer. */
    | 'TRON_UNREACHABLE'
    /** The backend never answered clearly, and the chain shows the transfer did not go out. */
    | 'NOT_SENT'
    /** The transfer reached a block, but the transfer call in it failed. */
    | 'FAILED_ON_CHAIN'
    /** Could not tell whether the transfer went out. */
    | 'OUTCOME_UNKNOWN'
    /** Another send from the same account is still running. */
    | 'SEND_IN_PROGRESS';

export type TronSendErrorDetail = {
    readonly retryAfterSeconds?: number;
    readonly txID?: string;
    readonly expirationMs?: number;
    /** The node's or the backend's own word for what happened, for support. */
    readonly reason?: string;
};

/** A send that did not go through, or might not have. The message is safe to show. */
export class TronSendError extends Error {
    /**
     * The transfer may still land. Callers must not offer to send again, and
     * must not say the money did not move, until the outcome is known.
     */
    readonly indeterminate: boolean;

    constructor(
        readonly code: TronSendErrorCode,
        readonly remedy: TronSendRemedy,
        message: string,
        readonly detail: TronSendErrorDetail = {},
    ) {
        super(message);
        this.name = 'TronSendError';
        this.indeterminate = remedy === 'check_status';
    }
}

/** Time and waiting, replaceable in tests. */
export type TronSendClock = {
    readonly now: () => number;
    readonly sleep: (ms: number) => Promise<void>;
};

const systemClock: TronSendClock = {
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

type Purpose = 'conversion' | 'plain';

const NOTHING_SENT = 'Nothing was sent.';

function refusalError(
    code: TronSendRefusalCode,
    retryAfterSeconds: number | undefined,
    purpose: Purpose,
): TronSendError {
    const error = (remedy: TronSendRemedy, message: string) =>
        new TronSendError(code, remedy, message, retryAfterSeconds !== undefined ? { retryAfterSeconds } : {});
    switch (code) {
        case 'NOT_SPONSORED':
            // For a conversion this means the backend has no record of the
            // quote: it restarted, or the quote lapsed. A new one fixes it.
            return purpose === 'conversion'
                ? error('requote', `This quote is no longer on record. ${NOTHING_SENT} Get a new quote to continue.`)
                : error('none', `Sending USDT is not available yet. ${NOTHING_SENT}`);
        case 'BELOW_MINIMUM':
            return error('none', `This amount is below the minimum send. ${NOTHING_SENT}`);
        case 'INSUFFICIENT_USDT':
            return error('none', `Your USDT balance is lower than this amount. ${NOTHING_SENT}`);
        case 'BANDWIDTH_UNAVAILABLE':
            return error(
                'wait',
                `This wallet has used its free network allowance for now. ${NOTHING_SENT} It refills over the day, so try again later.`,
            );
        case 'RATE_LIMITED':
            return error('wait', `Too many attempts in a short time. ${NOTHING_SENT} Wait a minute and try again.`);
        case 'DAILY_LIMIT':
            return error('retry_later', `This wallet has reached today's transfer limit. ${NOTHING_SENT} Try again tomorrow.`);
        case 'BUDGET_EXHAUSTED':
            return error('retry_later', `USDT transfers are paused for today. ${NOTHING_SENT} Try again tomorrow.`);
        case 'ENERGY_PROVIDER_UNFUNDED':
        case 'TRON_NOT_CONFIGURED':
            return error('retry_later', `USDT transfers are not available right now. ${NOTHING_SENT} Try again later.`);
        case 'ENERGY_UNAVAILABLE':
            return error('retry', `The network fee could not be arranged. ${NOTHING_SENT} Try again shortly.`);
        case 'ENERGY_NOT_DELIVERED':
            return error('retry', `The network fee did not arrive in time. ${NOTHING_SENT} Try again in a few minutes.`);
        case 'RESIGN_REQUIRED':
            return error('retry', `The transfer took too long to go out. ${NOTHING_SENT} Try again.`);
        case 'TRANSFER_REJECTED':
            return error('none', `The Tron network refused this transfer. ${NOTHING_SENT}`);
        case 'INVALID_SIGNATURE':
            return error('none', `The Tron network does not accept this wallet's signature. ${NOTHING_SENT}`);
        default:
            return error('none', `This transfer could not be prepared correctly. ${NOTHING_SENT}`);
    }
}

const quoteExpiring = () =>
    new TronSendError(
        'QUOTE_EXPIRING',
        'requote',
        `This quote expires too soon to pay into. ${NOTHING_SENT} Get a new quote to continue.`,
    );

const tronUnreachable = () =>
    new TronSendError(
        'TRON_UNREACHABLE',
        'retry',
        `Could not reach the Tron network. ${NOTHING_SENT} Check your connection and try again.`,
    );

const notSent = (reason: string) =>
    new TronSendError(
        'NOT_SENT',
        'retry',
        `The transfer service did not answer. ${NOTHING_SENT} Check your connection and try again.`,
        { reason },
    );

function failedOnChain(txID: string, reason: string): TronSendError {
    // Out of energy is the one failure a new attempt can fix: the rental fell
    // short or arrived late. Anything else, such as a revert, will repeat.
    return reason === 'OUT_OF_ENERGY'
        ? new TronSendError(
              'FAILED_ON_CHAIN',
              'retry',
              'The transfer reached the network but its fee fell short, so no USDT moved. Try again.',
              { txID, reason },
          )
        : new TronSendError('FAILED_ON_CHAIN', 'none', 'The transfer reached the network but failed, so no USDT moved.', {
              txID,
              reason,
          });
}

const sendInProgress = () =>
    new TronSendError(
        'SEND_IN_PROGRESS',
        'none',
        'Another transfer from this wallet is still going through. Nothing new was sent.',
    );

const outcomeUnknown = (txID: string, expirationMs: number) =>
    new TronSendError(
        'OUTCOME_UNKNOWN',
        'check_status',
        'Could not confirm whether this transfer went out. Check your USDT balance before sending again.',
        { txID, expirationMs },
    );

/* ------------------------------------------------------------------ */
/* Before committing                                                   */
/* ------------------------------------------------------------------ */

export type UsdtSendReadiness =
    | { readonly ready: true }
    | { readonly ready: false; readonly code: 'INSUFFICIENT_USDT' }
    /** `retryAfterSeconds` is absent only if the allowance could never cover a transfer. */
    | { readonly ready: false; readonly code: 'BANDWIDTH_UNAVAILABLE'; readonly retryAfterSeconds?: number };

/**
 * Whether this wallet can send `amountUnits` now, read before anything is
 * committed. For a conversion that means before the quote is booked: a quote
 * holds for two minutes, and a wallet that has used its free bandwidth can
 * have hours to wait. The backend checks both again when the transfer arrives.
 *
 * A shortfall of USDT is reported first, since waiting does not fix it.
 * Throws TRON_UNREACHABLE when the chain cannot be read.
 */
export async function checkUsdtSendReadiness(
    address: string,
    amountUnits: string,
    clock: TronSendClock = systemClock,
): Promise<UsdtSendReadiness> {
    tronAddressToHex(address);
    if (!/^[1-9][0-9]*$/.test(amountUnits)) {
        throw new Error('Amount must be a whole number of units above zero');
    }
    let balance: string;
    let sender: TronAccountState;
    try {
        [balance, sender] = await Promise.all([getTronUsdtBalance(address), getTronAccountState(address)]);
    } catch {
        throw tronUnreachable();
    }
    if (new BigNumber(decimalToUnits(balance, USDT_DECIMALS)).isLessThan(amountUnits)) {
        return { ready: false, code: 'INSUFFICIENT_USDT' };
    }
    if (!hasTransferBandwidth(sender)) {
        const retryAfterSeconds = secondsUntilTransferBandwidth(sender, clock.now());
        return {
            ready: false,
            code: 'BANDWIDTH_UNAVAILABLE',
            ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        };
    }
    return { ready: true };
}

/* ------------------------------------------------------------------ */
/* The outcome of one transfer                                         */
/* ------------------------------------------------------------------ */

/**
 * Wait until a signed transfer is in a block, or can never be.
 *
 * "Dropped" is only returned once the network is past the transfer's expiry
 * with the transfer in no block, twice, a block apart: the two reads can reach
 * different nodes, and one may be a block behind. Throws an indeterminate
 * TronSendError when the chain cannot be read, never a guess.
 *
 * Also the way to settle an OUTCOME_UNKNOWN later, with its `detail.txID` and
 * `detail.expirationMs`.
 */
export async function awaitUsdtTransferOutcome(
    txID: string,
    expirationMs: number,
    clock: TronSendClock = systemClock,
): Promise<UsdtTransferFate> {
    const giveUpAt = clock.now() + MAX_OUTCOME_WAIT_MS;
    let failures = 0;
    let pastExpiry = 0;
    for (;;) {
        try {
            const outcome = await getTronTransactionOutcome(txID);
            if (outcome.status !== 'unknown') {
                return outcome;
            }
            const head = await getTronReferenceBlock();
            failures = 0;
            pastExpiry = head.timestamp > expirationMs + LANDING_MARGIN_MS ? pastExpiry + 1 : 0;
            if (pastExpiry >= 2) {
                return { status: 'dropped' };
            }
        } catch (error) {
            if (!(error instanceof TronApiError) || !error.retryable) {
                throw error;
            }
            failures += 1;
            if (failures >= MAX_READ_FAILURES) {
                throw outcomeUnknown(txID, expirationMs);
            }
        }
        if (clock.now() >= giveUpAt) {
            throw outcomeUnknown(txID, expirationMs);
        }
        await clock.sleep(POLL_INTERVAL_MS);
    }
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

type SendRequest = {
    readonly from: SendingAccount;
    readonly to: string;
    readonly amountUnits: string;
    readonly sign: UsdtTransferSigner;
    /** Network time after which no new signature is started. */
    readonly signBy?: number;
    readonly onSubmit?: (transfer: SubmittedTransfer) => void;
};

/**
 * Post a signed transfer, and post the same bytes once more if the first
 * request goes unanswered. `unanswered` records that either request did, which
 * means the transfer may be out whatever the last answer says.
 */
async function submit(
    signed: SignedUsdtTransfer,
    publicKey: string,
    clock: TronSendClock,
): Promise<{ answer: TronSendAnswer; unanswered: boolean }> {
    let unanswered = false;
    for (let posts = 1; ; posts += 1) {
        const answer = await postTronSend(signed.transactionHex, publicKey);
        if (answer.outcome === 'sent' && answer.txID !== signed.txID) {
            // A success for some other transfer settles nothing about ours.
            return { answer: { outcome: 'unknown', reason: 'answer for another transfer' }, unanswered: true };
        }
        if (answer.outcome !== 'unknown') {
            return { answer, unanswered };
        }
        unanswered = true;
        if (posts >= MAX_POSTS_PER_TRANSFER) {
            return { answer, unanswered };
        }
        await clock.sleep(REPOST_DELAY_MS);
    }
}

/**
 * After ENERGY_NOT_DELIVERED, give the rented energy a little longer to land
 * before signing again, so the next attempt finds it instead of renting more.
 * Only an optimisation: on any read failure it stops and the backend decides.
 */
async function waitForRentedEnergy(from: string, to: string, clock: TronSendClock): Promise<void> {
    const until = clock.now() + ENERGY_GRACE_MS;
    try {
        const recipientBalance = await getTronUsdtBalance(to);
        for (;;) {
            if (usdtSendNeeds(await getTronAccountState(from), recipientBalance).energyToSupply === 0) {
                return;
            }
            if (clock.now() + POLL_INTERVAL_MS > until) {
                return;
            }
            await clock.sleep(POLL_INTERVAL_MS);
        }
    } catch {
        // Sign again without it.
    }
}

async function signAndSubmit(request: SendRequest, purpose: Purpose, clock: TronSendClock): Promise<UsdtSendReceipt> {
    const { from, to, amountUnits, sign } = request;
    for (let signatures = 1; ; signatures += 1) {
        let referenceBlock: TronReferenceBlock;
        try {
            referenceBlock = await getTronReferenceBlock();
        } catch {
            throw tronUnreachable();
        }
        // Judged by the block's time, which is the network's clock rather than
        // the phone's, and the quote's expiry is the venue's.
        if (request.signBy !== undefined && referenceBlock.timestamp > request.signBy) {
            throw quoteExpiring();
        }
        const signed = sign({ from: from.address, to, amountUnits, referenceBlock, createdAtMs: clock.now() });
        request.onSubmit?.({ txID: signed.txID, expirationMs: signed.expirationMs });

        const { answer, unanswered } = await submit(signed, from.publicKey, clock);
        if (answer.outcome === 'sent') {
            return {
                txID: signed.txID,
                expirationMs: signed.expirationMs,
                energyRented: answer.energyRented,
                activated: answer.activated,
            };
        }
        if (unanswered) {
            const fate = await awaitUsdtTransferOutcome(signed.txID, signed.expirationMs, clock);
            if (fate.status === 'succeeded') {
                return { txID: signed.txID, expirationMs: signed.expirationMs };
            }
            if (fate.status === 'failed') {
                throw failedOnChain(signed.txID, fate.reason);
            }
            // Dropped: it did not go out, and past its expiry it never can.
        }
        if (answer.outcome === 'unknown') {
            throw notSent(answer.reason);
        }
        if (RESIGN_CODES.has(answer.code) && signatures < MAX_SIGNATURES) {
            if (answer.code === 'ENERGY_NOT_DELIVERED') {
                await waitForRentedEnergy(from.address, to, clock);
            }
            continue;
        }
        throw refusalError(answer.code, answer.retryAfterSeconds, purpose);
    }
}

async function runSend(request: SendRequest, purpose: Purpose, clock: TronSendClock): Promise<UsdtSendReceipt> {
    const { from, to, amountUnits } = request;
    // Mistakes that no retry fixes, caught before anything reaches the network.
    if (tronAddressFromPublicKey(Buffer.from(from.publicKey, 'hex')) !== from.address) {
        throw new Error('The public key does not belong to the sending address');
    }
    tronAddressToHex(to);
    if (!/^[1-9][0-9]*$/.test(amountUnits)) {
        throw new Error('Amount must be a whole number of units above zero');
    }

    const sender = tronAddressToHex(from.address);
    if (sendsInFlight.has(sender)) {
        throw sendInProgress();
    }
    sendsInFlight.add(sender);
    try {
        return await signAndSubmit(request, purpose, clock);
    } finally {
        sendsInFlight.delete(sender);
    }
}

export type UsdtSendParams = {
    readonly from: SendingAccount;
    readonly to: string;
    /** In USDT's smallest unit, as an integer string. */
    readonly amountUnits: string;
    readonly sign: UsdtTransferSigner;
    /**
     * Called with each newly signed transfer just before it is posted. Keep it
     * if the app might close mid-send: until awaitUsdtTransferOutcome settles
     * it, that transfer may still land.
     */
    readonly onSubmit?: (transfer: SubmittedTransfer) => void;
};

/**
 * Send USDT to an address, when it is not a conversion deposit.
 *
 * The backend refuses these (NOT_SPONSORED) until plain sends are switched on,
 * which waits on a decision about who pays their network fee.
 */
export async function sendUsdt(params: UsdtSendParams, clock: TronSendClock = systemClock): Promise<UsdtSendReceipt> {
    return runSend(params, 'plain', clock);
}

export type ConversionDepositParams = {
    /** The conversion to pay into, as createShift returned it. */
    readonly order: ChainSwapOrder;
    readonly from: SendingAccount;
    readonly sign: UsdtTransferSigner;
    /** See UsdtSendParams.onSubmit. */
    readonly onSubmit?: (transfer: SubmittedTransfer) => void;
};

/**
 * Pay the deposit of a conversion from USDT on Tron, quoted through our backend.
 *
 * The backend pays the energy only for a deposit it saw quoted: into that
 * quote's address, from the address the quote refunds to, for the quoted
 * amount. So the quote has to be booked with the user's own Tron address as
 * the refund address, and exactly the quote's amount is sent.
 */
export async function sendUsdtConversionDeposit(
    params: ConversionDepositParams,
    clock: TronSendClock = systemClock,
): Promise<UsdtSendReceipt> {
    const { order, from } = params;
    if (order.depositAsset.coin !== 'usdt' || order.depositAsset.network !== 'tron') {
        throw new Error('This conversion does not take a USDT deposit on Tron');
    }
    if (order.status !== 'awaiting_deposit') {
        throw new Error('This conversion is no longer waiting for a deposit');
    }
    if (!order.depositAddress) {
        throw new Error('This conversion has no deposit address');
    }
    if (order.depositMemo) {
        // A memo costs a TRX our users do not hold, and the backend refuses one.
        throw new Error('This conversion needs a memo, which a USDT send here cannot carry');
    }
    if (!order.refundAddress || tronAddressToHex(order.refundAddress) !== tronAddressToHex(from.address)) {
        throw new Error('This conversion refunds to a different address than the one sending');
    }
    // Without a real deadline, signing would never stop for an expiring quote.
    if (!Number.isFinite(order.expiresAt.getTime())) {
        throw new Error('This conversion has no valid expiry');
    }
    return runSend(
        {
            from,
            to: order.depositAddress,
            amountUnits: decimalToUnits(order.depositAmount, USDT_DECIMALS),
            sign: params.sign,
            signBy: order.expiresAt.getTime() - CONVERSION_SEND_MARGIN_MS,
            onSubmit: params.onSubmit,
        },
        'conversion',
        clock,
    );
}
