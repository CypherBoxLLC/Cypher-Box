/**
 * Translating Flashnet's Orchestra API into the chainSwap contract.
 *
 * The rules worth protecting here are the ones that would move money or
 * mislead a user if they broke:
 *   - Amounts cross this boundary as integer smallest units. A wrong scale is
 *     a decimal point in the wrong place, so conversion is exact or it throws.
 *   - `processing` means two different things, and only the previous order
 *     tells them apart. Read wrongly, a hold renders as healthy progress.
 *   - `unfulfilled` is not terminal. Read as terminal, the user is told their
 *     money is gone while it is still moving.
 *   - Errors key on the documented code, never on HTTP status, since 400
 *     covers both "this route cannot serve you" and "we built it wrong".
 */

import {
    FLASHNET_DECIMALS,
    decimalsFor,
    fromSmallestUnits,
    mapFlashnetError,
    mapFlashnetOrder,
    mapFlashnetQuote,
    mapFlashnetStatus,
    toFlashnetRoute,
    toSmallestUnits,
    type FlashnetOrderRaw,
} from '../../src/services/chainSwap/providers/flashnetMapping';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    InvalidAddressError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
    isTerminal,
    type ChainSwapOrder,
} from '../../src/services/chainSwap/types';

const BTC = asset('btc', 'bitcoin');
const USDT_TRON = asset('usdt', 'tron');
const T0 = new Date('2026-09-17T12:00:00.000Z');
const MIN = 60 * 1000;
const later = (ms: number) => new Date(T0.getTime() + ms);

describe('route and decimals', () => {
    it('names a route the way Flashnet does', () => {
        expect(toFlashnetRoute(USDT_TRON)).toEqual({ chain: 'tron', asset: 'USDT' });
        expect(toFlashnetRoute(asset('BTC', 'Lightning'))).toEqual({ chain: 'lightning', asset: 'BTC' });
    });

    it('knows the assets we route', () => {
        expect(decimalsFor(BTC)).toBe(8);
        expect(decimalsFor(USDT_TRON)).toBe(6);
        expect(FLASHNET_DECIMALS['lightning:BTC']).toBe(8);
    });

    it('refuses an asset it has no scale for, rather than guessing', () => {
        expect(() => decimalsFor(asset('usdc', 'solana'))).toThrow(VenueConfigError);
    });

    it('accepts decimals read from the live route list', () => {
        expect(decimalsFor(asset('usdc', 'solana'), { 'solana:USDC': 6 })).toBe(6);
    });
});

describe('amount conversion is exact', () => {
    it('converts both ways without drift', () => {
        expect(toSmallestUnits('0.00129534', 8)).toBe('129534');
        expect(toSmallestUnits('100', 6)).toBe('100000000');
        expect(fromSmallestUnits('129534', 8)).toBe('0.00129534');
        expect(fromSmallestUnits('100000000', 6)).toBe('100');
    });

    it('survives the amounts that break floating point', () => {
        expect(toSmallestUnits('0.1', 8)).toBe('10000000');
        expect(fromSmallestUnits('1', 8)).toBe('0.00000001');
        expect(fromSmallestUnits('123456789012345', 6)).toBe('123456789.012345');
    });

    it('refuses more precision than the asset has', () => {
        expect(() => toSmallestUnits('0.0000001', 6)).toThrow(/finer than/);
    });

    it('refuses nonsense instead of coercing it', () => {
        expect(() => toSmallestUnits('-1', 8)).toThrow(ChainSwapError);
        expect(() => toSmallestUnits('abc', 8)).toThrow(ChainSwapError);
        expect(() => fromSmallestUnits('not-a-number', 8)).toThrow(ChainSwapError);
    });
});

describe('the documented status table', () => {
    it.each([
        ['confirming', 'confirming'],
        ['swapping', 'processing'],
        ['bridging', 'processing'],
        ['delivering', 'settling'],
        ['completed', 'settled'],
        ['refunding', 'refunding'],
        ['refunded', 'refunded'],
        ['failed', 'failed'],
        ['expired', 'expired'],
    ])('%s maps to %s', (venue, expected) => {
        expect(mapFlashnetStatus(venue).status).toBe(expected);
    });

    it('treats an unrecognised status as a hold, not as progress', () => {
        const m = mapFlashnetStatus('teleporting');
        expect(m.status).toBe('held');
        expect(m.issue).toContain('teleporting');
    });

    it('keeps unfulfilled in flight, because a late deposit can still resume', () => {
        const m = mapFlashnetStatus('unfulfilled');
        expect(m.status).toBe('confirming');
        expect(isTerminal(m.status)).toBe(false);
        expect(m.issue).toMatch(/unconfirmed|replaced/);
    });

    it('carries the failure reason', () => {
        expect(mapFlashnetStatus('failed', undefined, 'slippage_exceeded').issue).toBe('slippage_exceeded');
        expect(mapFlashnetStatus('refunding', undefined, 'slippage_exceeded').issue).toBe('slippage_exceeded');
    });
});

describe('processing means two different things', () => {
    const at = (status: ChainSwapOrder['status'], venueStatus: string): ChainSwapOrder => ({
        id: 'ord_test',
        status,
        venueStatus,
        depositAddress: 'T-placeholder-deposit',
        depositAsset: USDT_TRON,
        settleAsset: BTC,
        depositAmount: '100',
        settleAmount: null,
        settleAddress: 'bc1q-placeholder-settle',
        refundAddress: 'T-placeholder-refund',
        createdAt: T0,
        expiresAt: later(2 * MIN),
        statusChangedAt: T0,
    });

    it('is waiting for the deposit on a new order', () => {
        expect(mapFlashnetStatus('processing').status).toBe('awaiting_deposit');
    });

    it('is a hold once the order has moved past the deposit', () => {
        for (const prev of ['confirming', 'processing', 'settling'] as const) {
            const m = mapFlashnetStatus('processing', at(prev, prev === 'processing' ? 'swapping' : prev));
            expect(m.status).toBe('held');
            expect(m.issue).toBe('held for review');
        }
    });

    it('stays held once held', () => {
        expect(mapFlashnetStatus('processing', at('held', 'processing')).status).toBe('held');
    });

    it('does not turn an unpaid order into a hold on a repeat poll', () => {
        expect(mapFlashnetStatus('processing', at('awaiting_deposit', 'processing')).status).toBe(
            'awaiting_deposit',
        );
    });
});

describe('errors key on the code, not the status', () => {
    const err = (code: string, message = '', status = 400) =>
        mapFlashnetError(status, { error: { code, message } });

    it('reports an amount outside the route bounds, with the bound we know', () => {
        const e = mapFlashnetError(400, { error: { code: 'amount_too_small' } }, '5', { min: '10' });
        expect(e).toBeInstanceOf(AmountOutOfRangeError);
        expect((e as AmountOutOfRangeError).min).toBe('10');
        expect((e as AmountOutOfRangeError).amount).toBe('5');
    });

    it('asks for a fresh quote when this one died', () => {
        expect(err('quote_expired', '', 409)).toBeInstanceOf(QuoteExpiredError);
        expect(err('expired', '', 409)).toBeInstanceOf(QuoteExpiredError);
    });

    it('points at the right address field', () => {
        expect((err('invalid_address', 'refundAddress invalid for chain') as InvalidAddressError).field).toBe(
            'refund',
        );
        expect((err('invalid_address', 'recipient invalid for chain') as InvalidAddressError).field).toBe(
            'settle',
        );
        expect((err('refund_address_missing') as InvalidAddressError).field).toBe('refund');
    });

    it('treats our own misconfiguration as ours, not as the user problem', () => {
        for (const code of ['forbidden', 'scope_required', 'missing_idempotency_key', 'not_found']) {
            expect(err(code, '', 403)).toBeInstanceOf(VenueConfigError);
        }
    });

    it('offers a retry only where retrying can work', () => {
        for (const code of ['rate_limited', 'route_unavailable', 'service_unavailable', 'flashnet_error']) {
            const e = err(code, '', 503);
            expect(e).toBeInstanceOf(VenueUnavailableError);
            expect((e as VenueUnavailableError).retryable).toBe(true);
        }
        const hard = err('unsupported_route', 'destination outside route.to');
        expect(hard).toBeInstanceOf(ChainSwapError);
        expect(hard).not.toBeInstanceOf(VenueUnavailableError);
    });

    it('falls back to HTTP status only when there is nothing to key on', () => {
        expect(mapFlashnetError(500, null)).toBeInstanceOf(VenueUnavailableError);
        expect(mapFlashnetError(429, null)).toBeInstanceOf(VenueUnavailableError);
        const e = mapFlashnetError(400, null);
        expect(e).toBeInstanceOf(ChainSwapError);
        expect(e).not.toBeInstanceOf(VenueUnavailableError);
    });
});

describe('quote', () => {
    const raw = {
        quoteId: 'q_test',
        depositAddress: 'T-placeholder-deposit',
        amountIn: '100000000',
        estimatedOut: '129534',
        expiresAt: '2026-09-17T12:02:00.000Z',
        feeBps: 10,
    };

    it('converts amounts and carries the deposit instructions', () => {
        const q = mapFlashnetQuote(raw, USDT_TRON, BTC);
        expect(q.id).toBe('q_test');
        expect(q.depositAmount).toBe('100');
        expect(q.settleAmount).toBe('0.00129534');
        expect(q.depositAddress).toBe('T-placeholder-deposit');
        expect(q.expiresAt.toISOString()).toBe('2026-09-17T12:02:00.000Z');
        expect(q.allInCostFraction).toBeNull();
    });

    it('says the settle amount is not committed unless delivery is fixed', () => {
        expect(mapFlashnetQuote(raw, USDT_TRON, BTC).settleAmountIsFirm).toBe(false);
        expect(
            mapFlashnetQuote({ ...raw, deliveryMode: 'fixed' }, USDT_TRON, BTC).settleAmountIsFirm,
        ).toBe(true);
    });

    it('reports the floor when Flashnet locks one', () => {
        const q = mapFlashnetQuote({ ...raw, lockedMinAmountOut: '128000' }, USDT_TRON, BTC);
        expect(q.minSettleAmount).toBe('0.00128');
    });

    it('refuses a malformed expiry rather than an Invalid Date', () => {
        expect(() => mapFlashnetQuote({ ...raw, expiresAt: 'soon' }, USDT_TRON, BTC)).toThrow(ChainSwapError);
    });
});

describe('order', () => {
    const raw = (over: Partial<FlashnetOrderRaw> = {}): FlashnetOrderRaw => ({
        id: 'ord_test',
        status: 'confirming',
        quoteId: 'q_test',
        amountIn: '100000000',
        source: { chain: 'tron', asset: 'USDT', address: 'T-sender', txHash: 'tron-tx' },
        destination: { chain: 'bitcoin', asset: 'BTC', address: 'bc1q-placeholder-settle', txHash: null },
        depositAddress: 'T-placeholder-deposit',
        recipientAddress: 'bc1q-placeholder-settle',
        refund: { asset: null, amount: null, txHash: null },
        error: null,
        createdAt: '2026-09-17T11:59:00.000Z',
        ...over,
    });

    const previous: ChainSwapOrder = {
        id: 'ord_test',
        status: 'awaiting_deposit',
        venueStatus: 'processing',
        depositAddress: 'T-placeholder-deposit',
        depositAsset: USDT_TRON,
        settleAsset: BTC,
        depositAmount: '100',
        settleAmount: null,
        settleAddress: 'bc1q-placeholder-settle',
        refundAddress: 'T-placeholder-refund',
        createdAt: new Date('2026-09-17T11:59:00.000Z'),
        expiresAt: new Date('2026-09-17T12:01:00.000Z'),
        statusChangedAt: T0,
    };

    it('folds the snapshot into the order we held', () => {
        const o = mapFlashnetOrder(raw(), later(MIN), previous);
        expect(o.status).toBe('confirming');
        expect(o.depositAmount).toBe('100');
        expect(o.depositTxId).toBe('tron-tx');
        expect(o.settleAddress).toBe('bc1q-placeholder-settle');
        // Flashnet never echoes the refund address, so it can only come from us.
        expect(o.refundAddress).toBe('T-placeholder-refund');
        expect(o.expiresAt).toEqual(previous.expiresAt);
        expect(o.statusChangedAt).toEqual(later(MIN));
    });

    it('keeps the stall clock when nothing moved', () => {
        const first = mapFlashnetOrder(raw(), T0, previous);
        const again = mapFlashnetOrder(raw(), later(30 * MIN), first);
        expect(again.statusChangedAt).toEqual(T0);
    });

    it('treats a venue-side step as progress even within one contract status', () => {
        const swapping = mapFlashnetOrder(raw({ status: 'swapping' }), T0, previous);
        const bridging = mapFlashnetOrder(raw({ status: 'bridging' }), later(5 * MIN), swapping);
        expect(bridging.status).toBe('processing');
        expect(bridging.statusChangedAt).toEqual(later(5 * MIN));
    });

    it('converts the settle amount once Flashnet commits to one', () => {
        const o = mapFlashnetOrder(raw({ status: 'completed', amountOut: '129534' }), T0, previous);
        expect(o.settleAmount).toBe('0.00129534');
        expect(o.status).toBe('settled');
    });

    it('records the refund transaction so a returned payment has a receipt', () => {
        const o = mapFlashnetOrder(
            raw({ status: 'refunded', refund: { asset: 'USDT', amount: '99000000', txHash: 'refund-tx' } }),
            T0,
            previous,
        );
        expect(o.status).toBe('refunded');
        expect(o.settleTxId).toBe('refund-tx');
    });

    it('refuses a snapshot for a different order', () => {
        expect(() => mapFlashnetOrder(raw({ id: 'ord_other' }), T0, previous)).toThrow(ChainSwapError);
    });

    it('refuses a snapshot with no destination address', () => {
        expect(() =>
            mapFlashnetOrder(
                raw({ destination: { chain: 'bitcoin', asset: 'BTC' }, recipientAddress: null }),
                T0,
            ),
        ).toThrow(ChainSwapError);
    });
});
