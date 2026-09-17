/**
 * flashnetAPIs: every Flashnet Orchestra call the app makes, in two halves.
 *
 * Public calls go straight from the device: routes, limits and estimates are
 * unauthenticated and cheap, which is what the amount screen needs.
 *
 * A quote needs a partner key, and reading an order needs one too (status and
 * order both answer 401 without it), so those go through our backend. It adds
 * the key and the affiliate fee and relays Flashnet's answer unchanged, so
 * both halves are read with the same mapping rules.
 *
 * Nothing here logs. An order id is enough to look an order up.
 */

import BigNumber from 'bignumber.js';

import type {
    FlashnetErrorBody,
    FlashnetOrderRaw,
    FlashnetQuoteRaw,
} from '../services/chainSwap/providers/flashnetMapping';
import {
    decimalsFor,
    fromSmallestUnits,
    mapFlashnetError,
    mapFlashnetOrder,
    mapFlashnetQuote,
    toFlashnetRoute,
    toSmallestUnits,
} from '../services/chainSwap/providers/flashnetMapping';
import type {
    ChainAsset,
    ChainSwapError as ChainSwapErrorType,
    ChainSwapOrder,
    ChainSwapPair,
    ChainSwapQuote,
} from '../services/chainSwap/types';
import {
    ChainSwapError,
    VenueConfigError,
    VenueUnavailableError,
} from '../services/chainSwap/types';

const BASE_URL = 'https://orchestration.flashnet.xyz/v1/orchestration';
const BACKEND_URL = 'https://cypherbox-backend.onrender.com/flashnet';
const DEFAULT_TIMEOUT_MS = 15_000;
// Longer for the backend: an idle instance on its host can take most of a
// minute to wake, and a quote cut short leaves the user with no address.
const BACKEND_TIMEOUT_MS = 60_000;

/** Assets whose unit is a dollar, used only to read USD-denominated bounds. */
const DOLLAR_COINS = new Set(['usdt', 'usdc', 'usdb']);

export type FlashnetRequestOptions = { timeoutMs?: number };

type Json = Record<string, unknown>;

async function request<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    onError: (status: number, body: unknown) => ChainSwapErrorType,
): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal }).catch((err: unknown) => {
            throw new VenueUnavailableError('flashnet', true, 'Could not reach Flashnet', err);
        });

        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        if (!response.ok) {
            throw onError(response.status, body);
        }
        if (body === null || typeof body !== 'object') {
            throw new VenueUnavailableError('flashnet', true, 'Flashnet returned an unreadable response');
        }
        return body as T;
    } finally {
        clearTimeout(timeoutId);
    }
}

const routeQuery = (deposit: ChainAsset, settle: ChainAsset) => {
    const from = toFlashnetRoute(deposit);
    const to = toFlashnetRoute(settle);
    return (
        `sourceChain=${encodeURIComponent(from.chain)}&sourceAsset=${encodeURIComponent(from.asset)}` +
        `&destinationChain=${encodeURIComponent(to.chain)}&destinationAsset=${encodeURIComponent(to.asset)}`
    );
};

/* ------------------------------------------------------------------ */
/* Public, straight from the device                                    */
/* ------------------------------------------------------------------ */

type LimitsRoute = {
    source?: { decimals?: number };
    destination?: { decimals?: number };
    limits?: {
        exactIn?: {
            supported?: boolean;
            requestAmount?: {
                minAmountSmallest?: string | null;
                maxAmountSmallest?: string | null;
                maxUsdCents?: string | null;
            } | null;
        };
    };
};

/**
 * Bounds and an indicative rate for a pair.
 *
 * Two calls, because Flashnet splits them: /limits carries the amount bounds
 * and the authoritative decimals, /estimate carries the price. Pass the
 * user's amount when there is one: the rate at the route minimum is far worse
 * than the rate at a real size, since the network cost is fixed.
 */
export async function getFlashnetPair(
    deposit: ChainAsset,
    settle: ChainAsset,
    depositAmount?: string,
    opts: FlashnetRequestOptions = {},
): Promise<ChainSwapPair> {
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const query = routeQuery(deposit, settle);
    const onError = (status: number, body: unknown) =>
        mapFlashnetError(status, body as FlashnetErrorBody | null, depositAmount);

    const limits = await request<{ routes?: LimitsRoute[] }>(
        `${BASE_URL}/limits?${query}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        timeout,
        onError,
    );
    const route = limits.routes?.[0];
    const exactIn = route?.limits?.exactIn;
    const bounds = exactIn?.requestAmount;
    if (!route || exactIn?.supported !== true || !bounds?.minAmountSmallest) {
        throw new VenueUnavailableError('flashnet', true, 'Flashnet is not serving this pair right now');
    }

    // Prefer the decimals Flashnet reports for this route over our own table.
    const overrides = {
        [`${deposit.network}:${deposit.coin.toUpperCase()}`]: route.source?.decimals,
        [`${settle.network}:${settle.coin.toUpperCase()}`]: route.destination?.decimals,
    };
    const known: Record<string, number> = {};
    for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === 'number') known[k] = v;
    }
    const depositDecimals = decimalsFor(deposit, known);
    const settleDecimals = decimalsFor(settle, known);

    const min = fromSmallestUnits(bounds.minAmountSmallest, depositDecimals);
    const probe = depositAmount && new BigNumber(depositAmount).isGreaterThan(min) ? depositAmount : min;

    const estimate = await request<Json>(
        `${BASE_URL}/estimate?${query}&amount=${encodeURIComponent(toSmallestUnits(probe, depositDecimals))}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        timeout,
        onError,
    );
    const estimatedOut = estimate.estimatedOut;
    if (typeof estimatedOut !== 'string') {
        throw new VenueUnavailableError('flashnet', true, 'Flashnet did not price this pair');
    }
    const out = new BigNumber(fromSmallestUnits(estimatedOut, settleDecimals));
    const rate = out.dividedBy(probe);

    return {
        depositAsset: { coin: deposit.coin.toLowerCase(), network: deposit.network.toLowerCase() },
        settleAsset: { coin: settle.coin.toLowerCase(), network: settle.network.toLowerCase() },
        min,
        max: maxDepositAmount(bounds, depositDecimals, deposit, settle, rate),
        rate: rate.toFixed(),
    };
}

/**
 * The deposit ceiling, in deposit units.
 *
 * Flashnet gives a ceiling in smallest units on some routes and only a USD
 * notional on others, so where the unit ceiling is missing it is derived: from
 * the dollar amount directly when the deposit asset is a dollar, and otherwise
 * through the rate when the settle asset is. A route with neither gets no
 * ceiling we can state honestly, so the UI keeps validating against /estimate.
 */
function maxDepositAmount(
    bounds: { maxAmountSmallest?: string | null; maxUsdCents?: string | null },
    depositDecimals: number,
    deposit: ChainAsset,
    settle: ChainAsset,
    rate: BigNumber,
): string {
    if (bounds.maxAmountSmallest) {
        return fromSmallestUnits(bounds.maxAmountSmallest, depositDecimals);
    }
    const usd = bounds.maxUsdCents ? new BigNumber(bounds.maxUsdCents).dividedBy(100) : null;
    if (usd?.isFinite()) {
        if (DOLLAR_COINS.has(deposit.coin.toLowerCase())) {
            return usd.toFixed();
        }
        if (DOLLAR_COINS.has(settle.coin.toLowerCase()) && rate.isGreaterThan(0)) {
            return usd.dividedBy(rate).decimalPlaces(depositDecimals, BigNumber.ROUND_DOWN).toFixed();
        }
    }
    throw new VenueUnavailableError('flashnet', true, 'Flashnet did not report a maximum for this pair');
}

/* ------------------------------------------------------------------ */
/* Through the backend                                                 */
/* ------------------------------------------------------------------ */

/**
 * Map a backend response that is not Flashnet's own answer.
 *
 * The backend relays Flashnet's errors unchanged, and those carry an `error`
 * object. Its own failures, and its rate limiter and validator, use a flat
 * `error` string instead, which is how the two are told apart.
 */
export function mapFlashnetBackendError(
    httpStatus: number,
    body: unknown,
    depositAmount?: string,
): ChainSwapErrorType {
    const flat = body as { error?: unknown; code?: unknown } | null;
    if (!flat || typeof flat.error !== 'string') {
        return mapFlashnetError(httpStatus, body as FlashnetErrorBody | null, depositAmount);
    }
    const code = typeof flat.code === 'string' ? flat.code : '';
    if (code === 'FLASHNET_NOT_CONFIGURED' || code === 'CLIENT_IP_UNAVAILABLE') {
        return new VenueConfigError('flashnet', code);
    }
    if (httpStatus === 429 || httpStatus >= 500) {
        return new VenueUnavailableError('flashnet', true, 'Flashnet is not responding, try again shortly');
    }
    return new ChainSwapError(`Swap request was rejected (${httpStatus})`);
}

async function postBackend<T>(
    path: '/quote',
    payload: Record<string, string>,
    depositAmount: string,
    opts: FlashnetRequestOptions = {},
): Promise<T> {
    return request<T>(
        `${BACKEND_URL}${path}`,
        {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        },
        opts.timeoutMs ?? BACKEND_TIMEOUT_MS,
        (status, body) => mapFlashnetBackendError(status, body, depositAmount),
    );
}

/**
 * Book a quote, which is also what allocates the deposit address.
 *
 * Flashnet binds the settle and refund addresses here rather than at creation,
 * and the price holds for two minutes whether or not the user pays, so this
 * must be called when the user commits and not while they are still typing.
 *
 * The answer is checked against the request. A quote decides what the user
 * pays, so one for another pair or amount must never reach the confirm screen.
 */
export async function requestFlashnetQuote(
    deposit: ChainAsset,
    settle: ChainAsset,
    depositAmount: string,
    addresses: { settleAddress: string; refundAddress: string },
    opts?: FlashnetRequestOptions,
): Promise<ChainSwapQuote> {
    const from = toFlashnetRoute(deposit);
    const to = toFlashnetRoute(settle);
    const raw = await postBackend<FlashnetQuoteRaw>(
        '/quote',
        {
            sourceChain: from.chain,
            sourceAsset: from.asset,
            destinationChain: to.chain,
            destinationAsset: to.asset,
            amount: toSmallestUnits(depositAmount, decimalsFor(deposit)),
            recipientAddress: addresses.settleAddress,
            refundAddress: addresses.refundAddress,
        },
        depositAmount,
        opts,
    );
    const quote = mapFlashnetQuote(raw, deposit, settle);
    if (
        !new BigNumber(quote.depositAmount).isEqualTo(depositAmount) ||
        quote.depositAsset.coin !== deposit.coin.toLowerCase() ||
        quote.settleAsset.coin !== settle.coin.toLowerCase() ||
        !quote.depositAddress
    ) {
        throw new ChainSwapError('Flashnet returned a quote that does not match the request');
    }
    return quote;
}

/**
 * Read an order, or the quote that has not become one yet.
 *
 * Until the deposit lands there is no order, only the quote, so the backend
 * looks up whichever the id refers to and the mapper folds the answer into the
 * order we already hold.
 */
export async function getFlashnetOrder(
    previous: ChainSwapOrder,
    now: Date = new Date(),
    opts: FlashnetRequestOptions = {},
): Promise<ChainSwapOrder> {
    const body = await request<{ order?: FlashnetOrderRaw | null; quote?: Json | null }>(
        `${BACKEND_URL}/order?id=${encodeURIComponent(previous.id)}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        opts.timeoutMs ?? BACKEND_TIMEOUT_MS,
        (status, b) => mapFlashnetBackendError(status, b, previous.depositAmount),
    );

    // No order yet means the deposit has not been detected. The quote is still
    // live until it expires, so the order we hold is unchanged rather than
    // failed, and expiry is judged from the quote's own deadline.
    const raw = body.order ?? null;
    if (!raw) {
        return previous;
    }
    return mapFlashnetOrder(raw, now, previous);
}
