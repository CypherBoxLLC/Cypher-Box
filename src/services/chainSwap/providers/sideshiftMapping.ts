/**
 * chainSwap/providers/sideshiftMapping: pure translation between the
 * chainSwap contract and SideShift's v2 wire format.
 *
 * No network and no React Native imports, so every rule here is unit-tested
 * in isolation. The transport and provider build on top of it.
 *
 * Every table below comes from SideShift's published docs:
 *   statuses and issues: docs.sideshift.ai/api-intro/deposits
 *   errors:              docs.sideshift.ai/error-codes
 * When SideShift changes a table, the matching test should fail first.
 */

import type {
    ChainAsset,
    ChainSwapOrder,
    ChainSwapPair,
    ChainSwapProviderId,
    ChainSwapQuote,
    ChainSwapStatus,
} from '../types';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    InvalidAddressError,
    JurisdictionBlockedError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
} from '../types';

const ID: ChainSwapProviderId = 'sideshift';

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

/**
 * SideShift identifies a method by coin ticker plus network. Coins are
 * case-insensitive on the wire, verified live, but the documented and
 * returned form is an upper-case ticker with a lower-case network, so we
 * send that form to keep logs and fixtures readable.
 */
export function toSideShiftMethod(a: ChainAsset): { coin: string; network: string } {
    return { coin: a.coin.toUpperCase(), network: a.network.toLowerCase() };
}

/** `BTC-bitcoin/USDT-tron`, the path segment the pair endpoint expects. */
export function pairPath(deposit: ChainAsset, settle: ChainAsset): string {
    const seg = (m: { coin: string; network: string }) =>
        `${encodeURIComponent(m.coin)}-${encodeURIComponent(m.network)}`;
    return `${seg(toSideShiftMethod(deposit))}/${seg(toSideShiftMethod(settle))}`;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** SideShift's documented shift statuses. */
export type SideShiftStatus =
    | 'waiting'
    | 'pending'
    | 'processing'
    | 'review'
    | 'settling'
    | 'settled'
    | 'refund'
    | 'refunding'
    | 'refunded'
    | 'expired'
    | 'multiple';

const STATUS_MAP: Readonly<Record<Exclude<SideShiftStatus, 'multiple'>, ChainSwapStatus>> = {
    waiting: 'awaiting_deposit',
    pending: 'confirming',
    processing: 'processing',
    review: 'held',
    settling: 'settling',
    settled: 'settled',
    // `refund` is "queued for refund", possibly still waiting on a refund
    // address. It is not terminal, so it shares `refunding` rather than
    // jumping to `refunded` and telling the user their money is back early.
    refund: 'refunding',
    refunding: 'refunding',
    refunded: 'refunded',
    expired: 'expired',
};

export type MappedStatus = { status: ChainSwapStatus; issue?: string };

/**
 * Map a SideShift status, plus its `issue` when present, onto the contract.
 *
 * `multiple` needs care. We send exactly one deposit from the wallet, so a
 * second deposit on a fixed shift means something went wrong upstream: a
 * double send, or a user paying from elsewhere. SideShift settles the first
 * valid deposit and refunds the rest. Rather than guess which leg matters to
 * the user, we surface it as `held` with an explicit issue so the UI
 * escalates to support instead of reporting a clean result.
 *
 * An unrecognised status is treated the same way. Failing loudly into a
 * hold is safer than silently mapping an unknown state to something
 * optimistic.
 */
export function mapSideShiftStatus(status: string, issue?: string | null): MappedStatus {
    const why = issue ?? undefined;
    if (status === 'multiple') {
        return { status: 'held', issue: why || 'multiple deposits' };
    }
    const mapped = (STATUS_MAP as Record<string, ChainSwapStatus | undefined>)[status];
    if (!mapped) {
        return { status: 'held', issue: why || `unrecognised status: ${status}` };
    }
    return why ? { status: mapped, issue: why } : { status: mapped };
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** Shape of SideShift's error body. */
export type SideShiftErrorBody = {
    error?: {
        message?: string;
        code?: string;
        orderId?: string;
        depositRangeMin?: string;
        depositRangeMax?: string;
    };
};

/**
 * Pull the decimal bound out of messages like
 * "Amount too low. Minimum deposit amount: 0.00037639".
 * Returns undefined rather than guessing when the shape is not recognised.
 */
export function parseRangeAmount(message: string): string | undefined {
    const m = /(?:minimum|maximum) deposit amount:\s*([0-9]+(?:\.[0-9]+)?)/i.exec(message);
    return m ? m[1] : undefined;
}

/**
 * Map a SideShift error response onto a typed ChainSwapError.
 *
 * Keyed on `code` and `message`, NEVER on HTTP status. SideShift's error
 * status and code do not line up: BAD_USER_INPUT is returned as 400, 403 and
 * 500, "Invalid network" is a 500, and a paused method is a 500. Deciding
 * retryability from HTTP status would tell a user to retry an input that
 * can never succeed.
 *
 * `depositAmount` is the amount the caller tried, used to populate the range
 * error. Pass it when mapping a quote or shift failure.
 */
export function mapSideShiftError(
    httpStatus: number,
    body: SideShiftErrorBody | null | undefined,
    depositAmount?: string,
): ChainSwapError {
    const err = body?.error;
    const code = err?.code ?? '';
    const message = err?.message ?? '';
    const lower = message.toLowerCase();

    // SideShift gave us nothing to go on. Only here does HTTP status decide:
    // a body-less 5xx is gateway or infrastructure trouble, so retryable.
    if (!code && !message) {
        if (httpStatus === 429 || httpStatus >= 500) {
            return new VenueUnavailableError(ID, true, 'SideShift is not responding, try again shortly');
        }
        return new ChainSwapError(`SideShift request failed (${httpStatus})`, body);
    }

    // Rate limiting: HTTP 429, documented with a message but no code.
    if (httpStatus === 429 || lower.includes('rate limit')) {
        return new VenueUnavailableError(ID, true, 'Too many requests, try again shortly');
    }

    if (code === 'ACCESS_DENIED') {
        return new JurisdictionBlockedError(ID);
    }

    // Our own misconfiguration: credentials, affiliate id, or a missing
    // end-user IP header. Never the user's problem, and the raw message
    // names internals, so it travels in `cause`, not the user-facing message.
    if (
        code === 'SESSION_REQUIRED' ||
        code === 'NOT_FOUND' ||
        lower.includes('affiliateid') ||
        lower.includes('x-user-ip')
    ) {
        return new VenueConfigError(ID, message);
    }

    // Amount outside the pair's range. Reported as QUOTE_UNAVAILABLE with
    // HTTP 500 and the crossed bound in the message, sometimes also as a
    // structured depositRangeMin or depositRangeMax, which we prefer.
    if (lower.includes('amount too low') || lower.includes('amount too high')) {
        const tooLow = lower.includes('amount too low');
        const parsed = parseRangeAmount(message);
        const min = tooLow ? (err?.depositRangeMin ?? parsed) : err?.depositRangeMin;
        const max = tooLow ? err?.depositRangeMax : (err?.depositRangeMax ?? parsed);
        return new AmountOutOfRangeError(depositAmount, min, max);
    }

    // An expired quote and an already-used quote have the same remedy: ask
    // for a fresh one. Reuse happens when a create call timed out after
    // SideShift had already made the shift, and the caller tried again.
    if (lower.includes('quote has already expired') || lower.includes('quote has already been accepted')) {
        return new QuoteExpiredError();
    }

    if (lower.includes('invalid receiving address') || lower.includes('settle address belongs to')) {
        return new InvalidAddressError('settle', message);
    }
    if (lower.includes('invalid refunddestination') || lower.includes('refund address belongs to')) {
        return new InvalidAddressError('refund', message);
    }

    // Too many open orders is BAD_USER_INPUT with HTTP 403. It clears as
    // orders expire, so it is retryable, and it is not a jurisdiction block.
    if (lower.includes('too many open orders')) {
        return new VenueUnavailableError(ID, true, message);
    }

    // Swapping an asset for itself is a request we should never build.
    if (lower.includes('must be different')) {
        return new ChainSwapError(message, body);
    }

    // Temporary venue-side conditions: a method paused or offline, a deposit
    // range or route quote unavailable. Retry later, or try another pair.
    if (code === 'SHIFT_UNAVAILABLE' || code === 'QUOTE_UNAVAILABLE') {
        return new VenueUnavailableError(ID, true, message);
    }

    // Everything else is input we built badly: unknown coin or network, an
    // unsupported method, a memo where none is allowed, invalid parameters.
    // Not retryable as sent.
    return new ChainSwapError(message, body);
}

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

/** GET /v2/pair response. */
export type SideShiftPairRaw = {
    min: string;
    max: string;
    rate: string;
    depositCoin: string;
    settleCoin: string;
    depositNetwork: string;
    settleNetwork: string;
};

/** POST /v2/quotes response. */
export type SideShiftQuoteRaw = {
    id: string;
    createdAt: string;
    depositCoin: string;
    settleCoin: string;
    depositNetwork: string;
    settleNetwork: string;
    expiresAt: string;
    depositAmount: string;
    settleAmount: string;
    rate: string;
    affiliateId?: string;
};

/**
 * Shift object, as returned by POST /v2/shifts/fixed and GET /v2/shifts/{id}.
 * Several fields are documented as present only in some states, so they are
 * optional here and the mapper decides what their absence means.
 */
export type SideShiftShiftRaw = {
    id: string;
    createdAt: string;
    depositCoin: string;
    settleCoin: string;
    depositNetwork: string;
    settleNetwork: string;
    depositAddress?: string | null;
    depositMemo?: string;
    settleAddress: string;
    refundAddress?: string;
    depositAmount?: string;
    settleAmount?: string;
    expiresAt: string;
    status: string;
    updatedAt?: string;
    depositHash?: string;
    settleHash?: string;
    issue?: string;
};

/**
 * Strict date parse. A malformed timestamp from the venue becomes an error,
 * never a silent Invalid Date that later breaks a countdown or stall timer.
 */
function parseDate(value: string | undefined, field: string): Date {
    const d = new Date(value ?? NaN);
    if (Number.isNaN(d.getTime())) {
        throw new ChainSwapError(`SideShift returned an invalid ${field}`);
    }
    return d;
}

export function mapSideShiftPair(raw: SideShiftPairRaw): ChainSwapPair {
    return {
        depositAsset: asset(raw.depositCoin, raw.depositNetwork),
        settleAsset: asset(raw.settleCoin, raw.settleNetwork),
        min: raw.min,
        max: raw.max,
        rate: raw.rate,
    };
}

export function mapSideShiftQuote(raw: SideShiftQuoteRaw): ChainSwapQuote {
    return {
        id: raw.id,
        depositAsset: asset(raw.depositCoin, raw.depositNetwork),
        settleAsset: asset(raw.settleCoin, raw.settleNetwork),
        depositAmount: raw.depositAmount,
        settleAmount: raw.settleAmount,
        expiresAt: parseDate(raw.expiresAt, 'expiresAt'),
        // No independent spot reference is wired in yet, so by contract we
        // show nothing rather than a fabricated percentage.
        allInCostFraction: null,
    };
}

/**
 * Build a ChainSwapOrder from a SideShift shift object.
 *
 * `previous` is the last order held for this shift, if any. Several things
 * depend on it:
 *   - statusChangedAt advances to `now` only on real progress: a change in
 *     the normalised status, or in SideShift's own status. SideShift only
 *     guarantees updatedAt once an order settles or refunds, so updatedAt
 *     cannot drive stall inference while the order is in flight.
 *   - depositAddress falls back to the previous value when SideShift returns
 *     null, which it does once an address passes its retention period. The
 *     address the user was shown must not silently disappear.
 *   - amounts and transaction ids fall back to previous values, since some
 *     are documented as present only in certain states.
 */
export function mapSideShiftShift(
    raw: SideShiftShiftRaw,
    now: Date,
    previous?: ChainSwapOrder,
): ChainSwapOrder {
    if (previous && previous.id !== raw.id) {
        throw new ChainSwapError('SideShift returned a different shift than was requested');
    }
    const { status, issue } = mapSideShiftStatus(raw.status, raw.issue);

    const depositAmount = raw.depositAmount ?? previous?.depositAmount;
    if (depositAmount === undefined) {
        throw new ChainSwapError('SideShift returned a shift without a deposit amount');
    }

    // Compare venue status only when there is one to compare against. An
    // order built without it must still keep its clock on an unchanged
    // status, or a stuck order would reset on every poll and never escalate.
    const venueMoved =
        !!previous && previous.venueStatus !== undefined && previous.venueStatus !== raw.status;
    const progressed = !previous || previous.status !== status || venueMoved;
    const statusChangedAt = previous && !progressed ? previous.statusChangedAt : now;

    const depositTxId = raw.depositHash ?? previous?.depositTxId;
    const settleTxId = raw.settleHash ?? previous?.settleTxId;

    return {
        id: raw.id,
        status,
        venueStatus: raw.status,
        depositAddress: raw.depositAddress ?? previous?.depositAddress ?? null,
        ...(raw.depositMemo ? { depositMemo: raw.depositMemo } : {}),
        depositAsset: asset(raw.depositCoin, raw.depositNetwork),
        settleAsset: asset(raw.settleCoin, raw.settleNetwork),
        depositAmount,
        settleAmount: raw.settleAmount ?? previous?.settleAmount ?? null,
        settleAddress: raw.settleAddress,
        refundAddress: raw.refundAddress ?? previous?.refundAddress ?? null,
        ...(depositTxId ? { depositTxId } : {}),
        ...(settleTxId ? { settleTxId } : {}),
        ...(issue ? { issue } : {}),
        createdAt: parseDate(raw.createdAt, 'createdAt'),
        expiresAt: parseDate(raw.expiresAt, 'expiresAt'),
        statusChangedAt,
    };
}
