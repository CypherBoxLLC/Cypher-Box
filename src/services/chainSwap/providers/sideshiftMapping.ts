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

import type { ChainAsset, ChainSwapProviderId, ChainSwapStatus } from '../types';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    InvalidAddressError,
    JurisdictionBlockedError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
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

    if (lower.includes('quote has already expired')) {
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
