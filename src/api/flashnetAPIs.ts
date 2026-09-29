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
    ChainSwapAmountMode,
    ChainSwapError as ChainSwapErrorType,
    ChainSwapOrder,
    ChainSwapPair,
    ChainSwapQuote,
} from '../services/chainSwap/types';
import {
    AmountOutOfRangeError,
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

/**
 * What a conversion from USDT on Tron costs before Flashnet's rate applies.
 *
 * Two things the public estimate never shows. Relay's charge on the deposit:
 * Flashnet reaches Tron through Relay, which sweeps every single-use deposit
 * address itself (an account creation, an approve and a depository call, about
 * 192k energy), and a quote carries that cost with no fee field for it. And
 * our own fee, which the quote applies as an affiliate rate: a flat part that
 * recovers the deposit's energy, and a share of the amount.
 *
 * Our backend measures the charge live and publishes the fee terms, since both
 * move. These are the fallbacks for when it cannot answer in time: the top of
 * what the charge measured on 2026-09-19 (2.08 to 2.46 USDT) and the pricing
 * set the same day (1% margin, $1.10 of energy, Flashnet keeping 20%). They
 * err towards showing less than the quote will deliver.
 */
export type TronConversionTerms = {
    /** Relay's charge on the deposit, in USDT. */
    readonly charge: string;
    /** The flat part of our fee, in USDT. */
    readonly flatFee: string;
    /** The proportional part of our fee, as a fraction of the amount. */
    readonly rateFee: string;
    /** The smallest conversion the backend will quote, in USDT. */
    readonly minimum: string;
};

const TRON_FALLBACK_TERMS: TronConversionTerms = {
    charge: '2.5',
    flatFee: '1.375',
    rateFee: '0.0125',
    minimum: '100',
};

/** Terms are reused this long, and waited for at most this long. */
const TERMS_REUSE_MS = 10 * 60_000;
const TERMS_TIMEOUT_MS = 8_000;

/** No charge above this is believed, whoever reports it. */
const CHARGE_MAX_USDT = 20;

let measuredTerms: { terms: TronConversionTerms; atMs: number } | null = null;

/** Forget the measured terms, so the next pair reads them again. */
export function forgetTronDepositCharge(): void {
    measuredTerms = null;
}

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
                minUsdCents?: string | null;
                maxUsdCents?: string | null;
            } | null;
        };
    };
};

/**
 * The deposit floor, in deposit units. Flashnet gives it in smallest units on
 * bitcoin routes but only as a dollar notional on Tron ones (minUsdCents, with
 * minAmountSmallest null, read 2026-09-19), which a dollar deposit reads
 * directly. A route with neither is not one we can serve.
 */
function minDepositAmount(
    bounds: { minAmountSmallest?: string | null; minUsdCents?: string | null },
    depositDecimals: number,
    deposit: ChainAsset,
): string {
    if (bounds.minAmountSmallest) {
        return fromSmallestUnits(bounds.minAmountSmallest, depositDecimals);
    }
    const usd = bounds.minUsdCents ? new BigNumber(bounds.minUsdCents).dividedBy(100) : null;
    if (usd?.isFinite() && usd.isGreaterThan(0) && DOLLAR_COINS.has(deposit.coin.toLowerCase())) {
        return usd.decimalPlaces(depositDecimals, BigNumber.ROUND_UP).toFixed();
    }
    throw new VenueUnavailableError('flashnet', true, 'Flashnet is not serving this pair right now');
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

type TronTermsBody = {
    chargeUsdt?: unknown;
    fee?: { marginBps?: unknown; recoveryUsd?: unknown; partnerCutBps?: unknown; minUsdt?: unknown };
};

const finite = (value: unknown): BigNumber | null => {
    const n = new BigNumber(typeof value === 'number' || typeof value === 'string' ? value : NaN);
    return n.isFinite() && n.isGreaterThanOrEqualTo(0) ? n : null;
};

/** The backend's answer as terms, or null when any part of it reads wrong. */
function readTronTerms(body: TronTermsBody): TronConversionTerms | null {
    const charge = finite(body.chargeUsdt);
    // A backend too old to publish terms is also too old to charge a fee.
    if (charge && body.fee === undefined) {
        return charge.isGreaterThan(CHARGE_MAX_USDT)
            ? null
            : { charge: charge.toFixed(), flatFee: '0', rateFee: '0', minimum: TRON_FALLBACK_TERMS.minimum };
    }
    const margin = finite(body.fee?.marginBps);
    const recovery = finite(body.fee?.recoveryUsd);
    const cut = finite(body.fee?.partnerCutBps);
    const minimum = finite(body.fee?.minUsdt);
    if (!charge || !margin || !recovery || !cut || !minimum) {
        return null;
    }
    if (charge.isGreaterThan(CHARGE_MAX_USDT) || cut.isGreaterThanOrEqualTo(10_000)) {
        return null;
    }
    // Flashnet keeps a share of the fee, so what reaches us is grossed up.
    const share = new BigNumber(10_000).minus(cut).dividedBy(10_000);
    return {
        charge: charge.toFixed(),
        flatFee: recovery.dividedBy(share).decimalPlaces(6, BigNumber.ROUND_UP).toFixed(),
        rateFee: margin.dividedBy(10_000).dividedBy(share).decimalPlaces(8, BigNumber.ROUND_UP).toFixed(),
        minimum: minimum.toFixed(),
    };
}

/**
 * What a tron:USDT conversion costs beyond Flashnet's rate, from our backend,
 * reused for 10 minutes. Falls back to TRON_FALLBACK_TERMS when the backend
 * cannot answer in time: the amount screen must not wait on a waking server,
 * and the quote the user confirms is the price either way. Never throws.
 */
export async function getTronConversionTerms(): Promise<TronConversionTerms> {
    const now = Date.now();
    if (measuredTerms && now - measuredTerms.atMs < TERMS_REUSE_MS) {
        return measuredTerms.terms;
    }
    try {
        const body = await request<TronTermsBody>(
            `${BACKEND_URL}/tron-deposit-charge`,
            { method: 'GET', headers: { Accept: 'application/json' } },
            TERMS_TIMEOUT_MS,
            () => new VenueUnavailableError('flashnet', true, 'The Tron conversion terms are unavailable'),
        );
        const terms = readTronTerms(body);
        if (terms) {
            measuredTerms = { terms, atMs: now };
            return terms;
        }
    } catch {
        // The fallback below is the answer.
    }
    return TRON_FALLBACK_TERMS;
}

/** The terms for this deposit asset, or undefined where we know of none. */
async function depositTerms(deposit: ChainAsset): Promise<TronConversionTerms | undefined> {
    const tronUsdt = deposit.network.toLowerCase() === 'tron' && deposit.coin.toLowerCase() === 'usdt';
    return tronUsdt ? getTronConversionTerms() : undefined;
}

/**
 * Bounds and an indicative rate for a pair.
 *
 * Two calls, because Flashnet splits them: /limits carries the amount bounds
 * and the authoritative decimals, /estimate carries the price. Pass the
 * user's amount when there is one: the rate at the route minimum is far worse
 * than the rate at a real size, since the network cost is fixed.
 *
 * A deposit that carries a flat charge the estimate leaves out (a Tron one)
 * gets it as `fixedCost`, and its minimum is raised by it, since what is left
 * after the charge must still clear Flashnet's own minimum.
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

    // Alongside /limits, so a slow answer costs no extra wait.
    const terms = depositTerms(deposit);
    const limits = await request<{ routes?: LimitsRoute[] }>(
        `${BASE_URL}/limits?${query}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        timeout,
        onError,
    );
    const route = limits.routes?.[0];
    const exactIn = route?.limits?.exactIn;
    const bounds = exactIn?.requestAmount;
    if (!route || exactIn?.supported !== true || !bounds) {
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

    // What the deposit loses before the rate applies: Relay's charge and the
    // flat part of our fee. The rest of our fee comes off the rate below.
    const conversion = await terms;
    const fixedCost = conversion
        ? new BigNumber(conversion.charge).plus(conversion.flatFee).decimalPlaces(depositDecimals, BigNumber.ROUND_UP).toFixed()
        : undefined;
    const venueMin = minDepositAmount(bounds, depositDecimals, deposit);
    // The smallest the ROUTE will take, which is Flashnet's own floor plus
    // whatever the deposit is charged before the rate applies. Deliberately not
    // raised to our published minimum: that is the size we recommend, not the
    // size we allow, and conflating the two meant the app refused amounts the
    // venue would happily quote.
    const min = (fixedCost ? new BigNumber(venueMin).plus(fixedCost) : new BigNumber(venueMin)).toFixed();
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
    // Our fee is taken from the conversion, so the rate a user should expect is
    // the venue's less our share of it.
    const rate = out.dividedBy(probe).multipliedBy(new BigNumber(1).minus(conversion?.rateFee ?? 0));

    return {
        depositAsset: { coin: deposit.coin.toLowerCase(), network: deposit.network.toLowerCase() },
        settleAsset: { coin: settle.coin.toLowerCase(), network: settle.network.toLowerCase() },
        min,
        max: maxDepositAmount(bounds, depositDecimals, deposit, settle, rate),
        rate: rate.toFixed(),
        ...(fixedCost ? { fixedCost } : {}),
    };
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
    // The backend refuses a conversion too small to be worth its charges. It
    // knows the minimum; the terms we hold say what to show for it.
    if (code === 'BELOW_MINIMUM') {
        return new AmountOutOfRangeError(
            depositAmount,
            (measuredTerms?.terms ?? TRON_FALLBACK_TERMS).minimum,
            undefined,
        );
    }
    if (httpStatus === 429 || httpStatus >= 500) {
        return new VenueUnavailableError('flashnet', true, 'Flashnet is not responding, try again shortly');
    }
    return new ChainSwapError(`Swap request was rejected (${httpStatus})`);
}

async function postBackend<T>(
    path: '/quote',
    payload: Record<string, string>,
    depositAmount: string | undefined,
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
    /** The amount the user fixed: a deposit amount, or a settle amount on exact_out. */
    amount: string,
    addresses: { settleAddress: string; refundAddress: string },
    mode: ChainSwapAmountMode = 'exact_in',
    opts?: FlashnetRequestOptions,
): Promise<ChainSwapQuote> {
    const from = toFlashnetRoute(deposit);
    const to = toFlashnetRoute(settle);
    const exactOut = mode === 'exact_out';
    // On exact_out the amount is what arrives, so it is scaled in settle units.
    const amountAsset = exactOut ? settle : deposit;
    const raw = await postBackend<FlashnetQuoteRaw>(
        '/quote',
        {
            sourceChain: from.chain,
            sourceAsset: from.asset,
            destinationChain: to.chain,
            destinationAsset: to.asset,
            amount: toSmallestUnits(amount, decimalsFor(amountAsset)),
            recipientAddress: addresses.settleAddress,
            refundAddress: addresses.refundAddress,
            ...(exactOut ? { amountMode: 'exact_out' } : {}),
        },
        exactOut ? undefined : amount,
        opts,
    );
    const quote = mapFlashnetQuote(raw, deposit, settle);
    // Check the side the user fixed: on exact_out the deposit is derived and
    // will not equal what they typed, but the settle amount must.
    const fixedSide = exactOut ? quote.settleAmount : quote.depositAmount;
    if (
        !new BigNumber(fixedSide).isEqualTo(amount) ||
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
