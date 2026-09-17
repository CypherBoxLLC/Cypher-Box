/**
 * sideshiftAPIs: every SideShift v2 call the app makes, in two halves.
 *
 * Public calls go straight from the device: pair, permissions and shift
 * status. They need no account secret, and calling them from the device is
 * what keeps the jurisdiction check honest, since SideShift sees the user's
 * own address.
 *
 * Quote and shift creation need `x-sideshift-secret`, which cannot ship in an
 * app bundle, so they go through our backend. It adds the credentials and the
 * user's address, and relays SideShift's answer unchanged, so both halves are
 * read with the same mapping rules.
 *
 * Nothing here logs. A shift id is a bearer capability, since SideShift's
 * order page opens by id alone, so it must not end up in device logs.
 */

import type {
    SideShiftErrorBody,
    SideShiftPairRaw,
    SideShiftQuoteRaw,
    SideShiftShiftRaw,
} from '../services/chainSwap/providers/sideshiftMapping';
import {
    mapSideShiftError,
    mapSideShiftPair,
    mapSideShiftQuote,
    mapSideShiftShift,
    pairPath,
    toSideShiftMethod,
} from '../services/chainSwap/providers/sideshiftMapping';
import type {
    ChainAsset,
    ChainSwapOrder,
    ChainSwapPair,
    ChainSwapPermission,
    ChainSwapQuote,
} from '../services/chainSwap/types';
import {
    ChainSwapError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
} from '../services/chainSwap/types';
import BigNumber from 'bignumber.js';

const BASE_URL = 'https://sideshift.ai/api/v2';
const BACKEND_URL = 'https://cypherbox-backend.onrender.com/sideshift';
const DEFAULT_TIMEOUT_MS = 15_000;
// Longer for the backend: an idle instance on its host can take most of a
// minute to wake, and a request cut short while creating a shift leaves its
// outcome unknown.
const BACKEND_TIMEOUT_MS = 60_000;

export type SideShiftRequestOptions = { timeoutMs?: number };

/**
 * GET a JSON resource with a hard timeout, mapping every failure to a typed
 * chainSwap error. These are reads, so a timeout never risks duplicating
 * anything on SideShift's side and is always safe to retry.
 */
async function getJson<T>(path: string, opts: SideShiftRequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetch(`${BASE_URL}${path}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        }).catch((err: unknown) => {
            throw new VenueUnavailableError('sideshift', true, 'Could not reach SideShift', err);
        });

        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        if (!response.ok) {
            throw mapSideShiftError(response.status, body as SideShiftErrorBody | null);
        }
        if (body === null || typeof body !== 'object') {
            throw new VenueUnavailableError('sideshift', true, 'SideShift returned an unreadable response');
        }
        return body as T;
    } finally {
        clearTimeout(timeoutId);
    }
}

/** Indicative limits and rate. Pass an amount to get the rate at that size. */
export async function getSideShiftPair(
    deposit: ChainAsset,
    settle: ChainAsset,
    depositAmount?: string,
    opts?: SideShiftRequestOptions,
): Promise<ChainSwapPair> {
    const query = depositAmount ? `?amount=${encodeURIComponent(depositAmount)}` : '';
    const raw = await getJson<SideShiftPairRaw>(`/pair/${pairPath(deposit, settle)}${query}`, opts);
    return mapSideShiftPair(raw);
}

/**
 * Jurisdiction pre-flight for this device's own address.
 *
 * Fails closed, as the provider contract requires: any failure, including a
 * network error or a malformed body, reports `allowed: false`. A wrong "no"
 * costs a retry. A wrong "yes" costs a rejected order after the user has
 * committed.
 */
export async function getSideShiftPermission(
    opts?: SideShiftRequestOptions,
): Promise<ChainSwapPermission> {
    try {
        const raw = await getJson<{ createShift?: unknown }>('/permissions', opts);
        return raw.createShift === true
            ? { allowed: true }
            : { allowed: false, reason: 'Not available in your region' };
    } catch {
        return { allowed: false, reason: 'Could not confirm availability' };
    }
}

/**
 * Fetch a shift and fold it into the last order held for it. See
 * mapSideShiftShift for why the previous order is required.
 */
export async function getSideShiftShift(
    previous: ChainSwapOrder,
    now: Date = new Date(),
    opts?: SideShiftRequestOptions,
): Promise<ChainSwapOrder> {
    const raw = await getJson<SideShiftShiftRaw>(`/shifts/${encodeURIComponent(previous.id)}`, opts);
    return mapSideShiftShift(raw, now, previous);
}

/* ------------------------------------------------------------------ */
/* Through the backend                                                 */
/* ------------------------------------------------------------------ */

/**
 * Map a backend response that is not SideShift's own answer.
 *
 * The backend relays SideShift's errors unchanged, and those carry an
 * `error` object. Its own failures, and its rate limiter and validator, use a
 * flat `error` string instead, which is how the two are told apart.
 */
export function mapBackendError(httpStatus: number, body: unknown, depositAmount?: string): ChainSwapError {
    const flat = body as { error?: unknown; code?: unknown } | null;
    if (!flat || typeof flat.error !== 'string') {
        return mapSideShiftError(httpStatus, body as SideShiftErrorBody | null, depositAmount);
    }
    const code = typeof flat.code === 'string' ? flat.code : '';
    if (code === 'SIDESHIFT_NOT_CONFIGURED' || code === 'CLIENT_IP_UNAVAILABLE') {
        return new VenueConfigError('sideshift', code);
    }
    if (httpStatus === 429 || httpStatus >= 500) {
        return new VenueUnavailableError('sideshift', true, 'SideShift is not responding, try again shortly');
    }
    // A 400 from our own validator means the app built a request the backend
    // refuses. Retrying the same input cannot help.
    return new ChainSwapError(`Swap request was rejected (${httpStatus})`);
}

async function postBackend<T>(
    path: '/quote' | '/shift',
    payload: Record<string, string | undefined>,
    depositAmount: string,
    opts: SideShiftRequestOptions = {},
): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? BACKEND_TIMEOUT_MS);
    try {
        const response = await fetch(`${BACKEND_URL}${path}`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        }).catch((err: unknown) => {
            throw new VenueUnavailableError('sideshift', true, 'Could not reach the swap service', err);
        });

        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        if (!response.ok) {
            throw mapBackendError(response.status, body, depositAmount);
        }
        if (body === null || typeof body !== 'object') {
            throw new VenueUnavailableError('sideshift', true, 'The swap service returned an unreadable response');
        }
        return body as T;
    } finally {
        clearTimeout(timeoutId);
    }
}

const sameAsset = (a: ChainAsset, b: ChainAsset) => a.coin === b.coin && a.network === b.network;
const sameAmount = (a: string | undefined, b: string) => {
    try {
        return a !== undefined && new BigNumber(a).isEqualTo(b);
    } catch {
        return false;
    }
};

/**
 * Bookable quote for an exact deposit amount, via the backend.
 *
 * The answer is checked against the request. The quote decides what the user
 * pays, so a quote for another pair or amount must never reach the confirm
 * screen, whatever caused it.
 */
export async function requestSideShiftQuote(
    deposit: ChainAsset,
    settle: ChainAsset,
    depositAmount: string,
    opts?: SideShiftRequestOptions,
): Promise<ChainSwapQuote> {
    const d = toSideShiftMethod(deposit);
    const s = toSideShiftMethod(settle);
    const raw = await postBackend<SideShiftQuoteRaw>(
        '/quote',
        { depositCoin: d.coin, depositNetwork: d.network, settleCoin: s.coin, settleNetwork: s.network, depositAmount },
        depositAmount,
        opts,
    );
    const quote = mapSideShiftQuote(raw);
    if (
        !sameAsset(quote.depositAsset, asset(deposit.coin, deposit.network)) ||
        !sameAsset(quote.settleAsset, asset(settle.coin, settle.network)) ||
        !sameAmount(quote.depositAmount, depositAmount)
    ) {
        throw new ChainSwapError('SideShift returned a quote that does not match the request');
    }
    return quote;
}

/**
 * Create a fixed shift from a quote, via the backend.
 *
 * Checked against the request for the same reason as the quote: the returned
 * order holds the deposit address the user pays, so a shift settling
 * somewhere else, or for a different amount, is refused.
 *
 * A timeout leaves the outcome unknown. Retrying with the same quote is safe:
 * SideShift refuses a used quote, which maps to QuoteExpiredError so the
 * caller re-quotes, and an unpaid duplicate simply expires.
 */
export async function createSideShiftShift(
    quote: ChainSwapQuote,
    settleAddress: string,
    refundAddress: string,
    externalId?: string,
    now: Date = new Date(),
    opts?: SideShiftRequestOptions,
): Promise<ChainSwapOrder> {
    const raw = await postBackend<SideShiftShiftRaw>(
        '/shift',
        { quoteId: quote.id, settleAddress, refundAddress, externalId },
        quote.depositAmount,
        opts,
    );
    const order = mapSideShiftShift(raw, now);
    if (
        order.settleAddress !== settleAddress ||
        (order.refundAddress !== null && order.refundAddress !== refundAddress) ||
        !sameAsset(order.depositAsset, quote.depositAsset) ||
        !sameAsset(order.settleAsset, quote.settleAsset) ||
        !sameAmount(order.depositAmount, quote.depositAmount)
    ) {
        throw new ChainSwapError('SideShift returned a shift that does not match the request');
    }
    return order;
}
