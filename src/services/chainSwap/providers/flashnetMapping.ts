/**
 * chainSwap/providers/flashnetMapping: pure translation between the chainSwap
 * contract and Flashnet's Orchestra API.
 *
 * No network and no React Native imports, so every rule here is unit-tested
 * in isolation. Sources, all read 2026-09-17:
 *   statuses and the order snapshot: docs.flashnet.xyz/orchestra/status
 *   quote fields:                    docs.flashnet.xyz/orchestra/quotes
 *   error codes:                     docs.flashnet.xyz/api/errors
 *
 * Two things differ from SideShift and drive most of this file:
 *   - Amounts are integer strings in an asset's smallest units, so every
 *     amount crossing this boundary is converted with a decimal library.
 *   - `processing` means both "created, waiting for the deposit" and an
 *     operator hold, because Flashnet masks its internal `paused` state as
 *     `processing` and emits no event for it. Telling those apart needs the
 *     previous order, which is why the status mapper takes one.
 */

import BigNumber from 'bignumber.js';

import type {
    ChainAsset,
    ChainSwapOrder,
    ChainSwapProviderId,
    ChainSwapQuote,
    ChainSwapStatus,
} from '../types';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    InvalidAddressError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
} from '../types';

const ID: ChainSwapProviderId = 'flashnet';

/* ------------------------------------------------------------------ */
/* Assets and amounts                                                  */
/* ------------------------------------------------------------------ */

/** Flashnet names a route by chain plus asset, e.g. tron + USDT. */
export function toFlashnetRoute(a: ChainAsset): { chain: string; asset: string } {
    return { chain: a.network.toLowerCase(), asset: a.coin.toUpperCase() };
}

/**
 * Decimals for the assets we route, so a wrong scale cannot silently move a
 * decimal point. Flashnet publishes these in /routes; this table is the
 * offline copy for the pairs we ship, and anything else must be added
 * deliberately rather than guessed at runtime.
 */
export const FLASHNET_DECIMALS: Readonly<Record<string, number>> = {
    'bitcoin:BTC': 8,
    'lightning:BTC': 8,
    'tron:USDT': 6,
};

const decimalsKey = (a: ChainAsset) => `${a.network.toLowerCase()}:${a.coin.toUpperCase()}`;

export function decimalsFor(a: ChainAsset, overrides?: Record<string, number>): number {
    const key = decimalsKey(a);
    const d = overrides?.[key] ?? FLASHNET_DECIMALS[key];
    if (d === undefined) {
        throw new VenueConfigError(ID, `no decimals known for ${key}`);
    }
    return d;
}

/**
 * Decimal amount to Flashnet's integer smallest units.
 *
 * Refuses anything that is not an exact whole number of units rather than
 * rounding, because rounding here is the user's money. A UI that offers more
 * precision than the asset has is the bug to fix, not this function.
 */
export function toSmallestUnits(amount: string, decimals: number): string {
    const n = new BigNumber(amount);
    if (!n.isFinite() || n.isNegative()) {
        throw new ChainSwapError(`Invalid amount: ${amount}`);
    }
    const raw = n.shiftedBy(decimals);
    if (!raw.isInteger()) {
        throw new ChainSwapError(`Amount ${amount} is finer than ${decimals} decimals allow`);
    }
    return raw.toFixed(0);
}

/** Flashnet's integer smallest units back to a decimal string. */
export function fromSmallestUnits(raw: string, decimals: number): string {
    const n = new BigNumber(raw);
    if (!n.isFinite()) {
        throw new ChainSwapError(`Flashnet returned an unreadable amount: ${raw}`);
    }
    return n.shiftedBy(-decimals).toFixed();
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** Flashnet's documented order statuses. */
export type FlashnetStatus =
    | 'processing'
    | 'confirming'
    | 'awaiting_approval'
    | 'swapping'
    | 'bridging'
    | 'delivering'
    | 'refunding'
    | 'completed'
    | 'refunded'
    | 'failed'
    | 'expired'
    | 'unfulfilled';

export type MappedStatus = { status: ChainSwapStatus; issue?: string };

/** Statuses that mean the deposit has been seen, so `processing` after one of these is a hold. */
const PAST_DEPOSIT: readonly ChainSwapStatus[] = ['confirming', 'processing', 'held', 'settling'];

/**
 * Map a Flashnet status onto the contract.
 *
 * `previous` is the last order we held, and it decides what `processing`
 * means. On a new order it is "waiting for the deposit". After the order has
 * moved past that, Flashnet only shows `processing` again when its internal
 * `paused` review state is masking the real one, so it becomes a hold rather
 * than a step backwards the UI would render as progress.
 *
 * `errorCode` comes from `order.error.code` and carries the reason on a
 * failure or refund, for example `slippage_exceeded`.
 */
export function mapFlashnetStatus(
    status: string,
    previous?: ChainSwapOrder,
    errorCode?: string | null,
): MappedStatus {
    const reason = errorCode || undefined;
    switch (status) {
        case 'processing':
            if (previous && PAST_DEPOSIT.includes(previous.status)) {
                return { status: 'held', issue: reason || 'held for review' };
            }
            return reason ? { status: 'awaiting_deposit', issue: reason } : { status: 'awaiting_deposit' };
        case 'confirming':
            return reason ? { status: 'confirming', issue: reason } : { status: 'confirming' };
        // A pending ZeroConf offer or an operator hold. Both need a person,
        // so neither should render as ordinary progress.
        case 'awaiting_approval':
            return { status: 'held', issue: reason || 'awaiting approval' };
        case 'swapping':
        case 'bridging':
            return { status: 'processing' };
        case 'delivering':
            return { status: 'settling' };
        case 'completed':
            return { status: 'settled' };
        case 'refunding':
            return { status: 'refunding', issue: reason || 'refund in flight' };
        case 'refunded':
            return reason ? { status: 'refunded', issue: reason } : { status: 'refunded' };
        case 'failed':
            return { status: 'failed', issue: reason || 'failed' };
        case 'expired':
            return { status: 'expired' };
        // Not terminal: the deposit was unconfirmed or replaced, and a late
        // one can still resume inside Flashnet's recovery window. Mapping it
        // to a terminal status would tell the user their money is gone while
        // it is still moving.
        case 'unfulfilled':
            return { status: 'confirming', issue: reason || 'deposit unconfirmed or replaced' };
        default:
            return { status: 'held', issue: reason || `unrecognised status: ${status}` };
    }
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Flashnet's error body: `{ error: { code, message } }`. */
export type FlashnetErrorBody = {
    error?: { code?: string; message?: string };
};

/** Our own integration is wrong: credentials, scopes, or a malformed request. */
const CONFIG_CODES = new Set([
    'unauthorized',
    'forbidden',
    'scope_required',
    'invalid_read_token',
    'client_key_fee_fields_forbidden',
    'missing_idempotency_key',
    'invalid_idempotency_key',
    'idempotency_conflict',
    'not_found',
    'invalid_query',
    'ambiguous_query',
    'unsupported_media_type',
    'payload_too_large',
    'invalid_webhook_url',
    'invalid_payout_destination',
    'invalid_payout_address',
]);

/** Venue-side and temporary: worth offering a retry. */
const RETRYABLE_CODES = new Set([
    'rate_limited',
    'internal_error',
    'flashnet_error',
    'service_unavailable',
    'spot_unavailable',
    'route_disabled',
    'route_unavailable',
    'estimate_unavailable',
    'standing_unavailable',
    'scanner_unavailable',
    'idempotency_in_progress',
]);

/**
 * Map a Flashnet error response onto a typed ChainSwapError.
 *
 * Keyed on `error.code`, which Flashnet documents per situation, rather than
 * on HTTP status: routing and amount errors all arrive as 400, while the same
 * 400 also covers requests we built wrongly, and the two need opposite
 * treatment in the UI.
 */
export function mapFlashnetError(
    httpStatus: number,
    body: FlashnetErrorBody | null | undefined,
    depositAmount?: string,
    bounds?: { min?: string; max?: string },
): ChainSwapError {
    const code = body?.error?.code ?? '';
    const message = body?.error?.message ?? '';

    // Nothing to key on. Only here does HTTP status decide.
    if (!code && !message) {
        if (httpStatus === 429 || httpStatus >= 500) {
            return new VenueUnavailableError(ID, true, 'Flashnet is not responding, try again shortly');
        }
        return new ChainSwapError(`Flashnet request failed (${httpStatus})`, body);
    }

    if (code === 'amount_too_small') {
        return new AmountOutOfRangeError(depositAmount, bounds?.min, undefined);
    }
    if (code === 'amount_too_large') {
        return new AmountOutOfRangeError(depositAmount, undefined, bounds?.max);
    }
    // Both mean the quote can no longer be funded, and both want a re-quote.
    if (code === 'quote_expired' || code === 'expired') {
        return new QuoteExpiredError();
    }
    if (code === 'refund_address_missing') {
        return new InvalidAddressError('refund', message || undefined);
    }
    if (code === 'invalid_address') {
        // The code does not say which address, so the message decides, and a
        // settle address is the safer default: it is the one the user typed.
        const field = /refund/i.test(message) ? 'refund' : 'settle';
        return new InvalidAddressError(field, message || undefined);
    }
    if (CONFIG_CODES.has(code)) {
        return new VenueConfigError(ID, message || code);
    }
    if (RETRYABLE_CODES.has(code) || httpStatus === 429) {
        return new VenueUnavailableError(ID, true, message || 'Flashnet is temporarily unavailable');
    }

    // Everything left is a request this pair cannot serve as sent: an
    // unsupported route, delivery or fee plan, or a price impact cap. Not
    // retryable without changing the request.
    return new ChainSwapError(message || `Flashnet rejected the request (${code})`, body);
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

/** POST /v1/orchestration/quote response, fields we rely on. */
export type FlashnetQuoteRaw = {
    quoteId: string;
    depositAddress: string;
    depositMemo?: string | null;
    amountIn: string;
    estimatedOut: string;
    expiresAt: string;
    feeBps?: number;
    deliveryMode?: string | null;
    lockedMinAmountOut?: string | null;
};

/** GET /v1/orchestration/status order snapshot, fields we rely on. */
export type FlashnetOrderRaw = {
    id: string;
    status: string;
    quoteId?: string | null;
    amountIn: string;
    amountOut?: string | null;
    source: { chain: string; asset: string; address?: string | null; txHash?: string | null };
    destination: { chain: string; asset: string; address?: string | null; txHash?: string | null };
    depositAddress?: string | null;
    recipientAddress?: string | null;
    refund?: { asset?: string | null; amount?: string | null; txHash?: string | null };
    error?: { code?: string | null; message?: string | null } | null;
    createdAt: string;
    updatedAt?: string | null;
};

/** A malformed timestamp becomes an error, never a silent Invalid Date. */
function parseDate(value: string | undefined | null, field: string): Date {
    const d = new Date(value ?? NaN);
    if (Number.isNaN(d.getTime())) {
        throw new ChainSwapError(`Flashnet returned an invalid ${field}`);
    }
    return d;
}

/**
 * Build a quote from Flashnet's response.
 *
 * The settle amount is `estimatedOut`, which is what the name says: Flashnet
 * prices the settlement at execution, so unless the quote came back with
 * fixed delivery the amount is not committed and the UI must show it as
 * approximate. `lockedMinAmountOut` is the floor when one exists.
 */
export function mapFlashnetQuote(
    raw: FlashnetQuoteRaw,
    deposit: ChainAsset,
    settle: ChainAsset,
    overrides?: Record<string, number>,
): ChainSwapQuote {
    const depositDecimals = decimalsFor(deposit, overrides);
    const settleDecimals = decimalsFor(settle, overrides);
    return {
        id: raw.quoteId,
        depositAsset: asset(deposit.coin, deposit.network),
        settleAsset: asset(settle.coin, settle.network),
        depositAmount: fromSmallestUnits(raw.amountIn, depositDecimals),
        settleAmount: fromSmallestUnits(raw.estimatedOut, settleDecimals),
        expiresAt: parseDate(raw.expiresAt, 'expiresAt'),
        settleAmountIsFirm: raw.deliveryMode === 'fixed',
        minSettleAmount: raw.lockedMinAmountOut
            ? fromSmallestUnits(raw.lockedMinAmountOut, settleDecimals)
            : null,
        depositAddress: raw.depositAddress,
        ...(raw.depositMemo ? { depositMemo: raw.depositMemo } : {}),
        // No independent spot reference is wired in, so by contract we show
        // nothing rather than a fabricated percentage.
        allInCostFraction: null,
    };
}

/**
 * Build an order from Flashnet's snapshot, folded into the last one we held.
 *
 * `previous` carries what Flashnet does not echo back: the refund address,
 * the deposit deadline from the quote, and the stall clock. It also decides
 * what `processing` means, as described on mapFlashnetStatus.
 */
export function mapFlashnetOrder(
    raw: FlashnetOrderRaw,
    now: Date,
    previous?: ChainSwapOrder,
    overrides?: Record<string, number>,
): ChainSwapOrder {
    // The id changes once in an order's life: until the deposit lands there is
    // no order, only the quote, so we track the quote id and Flashnet swaps in
    // the order id when it creates one. Any other change of id is a mix-up.
    const sameOrder = !previous || previous.id === raw.id || previous.id === raw.quoteId;
    if (!sameOrder) {
        throw new ChainSwapError('Flashnet returned a different order than was requested');
    }
    const depositAsset = asset(raw.source.asset, raw.source.chain);
    const settleAsset = asset(raw.destination.asset, raw.destination.chain);
    const { status, issue } = mapFlashnetStatus(raw.status, previous, raw.error?.code);

    const venueMoved =
        !!previous && previous.venueStatus !== undefined && previous.venueStatus !== raw.status;
    const progressed = !previous || previous.status !== status || venueMoved;
    const statusChangedAt = previous && !progressed ? previous.statusChangedAt : now;

    const settleAddress = raw.destination.address ?? raw.recipientAddress ?? previous?.settleAddress;
    if (!settleAddress) {
        throw new ChainSwapError('Flashnet returned an order with no destination address');
    }

    const depositTxId = raw.source.txHash ?? previous?.depositTxId;
    const settleTxId = raw.destination.txHash ?? raw.refund?.txHash ?? previous?.settleTxId;

    return {
        id: raw.id,
        status,
        venueStatus: raw.status,
        depositAddress: raw.depositAddress ?? previous?.depositAddress ?? null,
        ...(previous?.depositMemo ? { depositMemo: previous.depositMemo } : {}),
        depositAsset,
        settleAsset,
        depositAmount: fromSmallestUnits(raw.amountIn, decimalsFor(depositAsset, overrides)),
        settleAmount: raw.amountOut
            ? fromSmallestUnits(raw.amountOut, decimalsFor(settleAsset, overrides))
            : previous?.settleAmount ?? null,
        settleAddress,
        // Flashnet does not echo the refund address, so it survives only in
        // what we stored when the quote was made.
        refundAddress: previous?.refundAddress ?? null,
        ...(depositTxId ? { depositTxId } : {}),
        ...(settleTxId ? { settleTxId } : {}),
        ...(issue ? { issue } : {}),
        createdAt: parseDate(raw.createdAt, 'createdAt'),
        // An order exists only once the deposit landed, so the deposit
        // deadline is history by then. Keep the quote's if we have it.
        expiresAt: previous?.expiresAt ?? parseDate(raw.createdAt, 'createdAt'),
        statusChangedAt,
    };
}
