/**
 * Quote and shift creation, which go through our backend.
 *
 * What this file protects:
 *   - The device never sends credentials. The backend adds them, so the
 *     request carries only the swap itself.
 *   - SideShift's own errors, relayed by the backend, are read exactly as if
 *     the app had called SideShift directly.
 *   - The backend's own failures are told apart from SideShift's, so a
 *     missing server setting is not shown to the user as a retryable outage.
 *   - A quote or shift that does not match the request is refused. The
 *     quote decides what the user pays and the shift holds the address they
 *     pay into, so neither may reach the user if it differs from what was
 *     asked, whatever caused it.
 */

import { createSideShiftShift, mapBackendError, requestSideShiftQuote } from '../../src/api/sideshiftAPIs';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    QuoteExpiredError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
    type ChainSwapQuote,
} from '../../src/services/chainSwap/types';

const BTC = asset('btc', 'bitcoin');
const USDT_TRON = asset('usdt', 'tron');

const ok = (status: number, body: unknown) => ({ ok: true, status, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });
const unreadable = (status: number) => ({
    ok: status < 400,
    status,
    json: async () => {
        throw new SyntaxError('Unexpected token <');
    },
});

// Placeholder values, not real addresses.
const QUOTE_RAW = {
    id: 'quote-test-0001',
    createdAt: '2026-09-11T10:00:00.000Z',
    depositCoin: 'BTC',
    settleCoin: 'USDT',
    depositNetwork: 'bitcoin',
    settleNetwork: 'tron',
    expiresAt: '2026-09-11T10:15:00.000Z',
    depositAmount: '0.00100000',
    settleAmount: '76.91',
    rate: '76910',
};

const QUOTE: ChainSwapQuote = {
    id: 'quote-test-0001',
    depositAsset: BTC,
    settleAsset: USDT_TRON,
    depositAmount: '0.001',
    settleAmount: '76.91',
    expiresAt: new Date('2026-09-11T10:15:00.000Z'),
    allInCostFraction: null,
};

const SHIFT_RAW = {
    id: 'shift-test-0001',
    createdAt: '2026-09-11T10:01:00.000Z',
    depositCoin: 'BTC',
    settleCoin: 'USDT',
    depositNetwork: 'bitcoin',
    settleNetwork: 'tron',
    depositAddress: 'bc1q-placeholder-deposit',
    settleAddress: 'T-placeholder-settle',
    refundAddress: 'bc1q-placeholder-refund',
    depositAmount: '0.001',
    settleAmount: '76.91',
    expiresAt: '2026-09-11T10:15:00.000Z',
    status: 'waiting',
};

let fetchMock: jest.Mock;
let logSpies: jest.SpyInstance[];

beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    logSpies = (['log', 'warn', 'error'] as const).map(k => jest.spyOn(console, k).mockImplementation(() => undefined));
});

afterEach(() => {
    for (const spy of logSpies) {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    }
});

const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    return { url, init, body: JSON.parse(init.body) as Record<string, unknown> };
};

describe('requestSideShiftQuote', () => {
    it('sends only the swap to the backend, never credentials', async () => {
        fetchMock.mockResolvedValue(ok(200, QUOTE_RAW));
        await requestSideShiftQuote(BTC, USDT_TRON, '0.001');
        const { url, init, body } = sent();
        expect(url).toBe('https://cypherbox-backend.onrender.com/sideshift/quote');
        expect(init.method).toBe('POST');
        expect(body).toEqual({
            depositCoin: 'BTC',
            depositNetwork: 'bitcoin',
            settleCoin: 'USDT',
            settleNetwork: 'tron',
            depositAmount: '0.001',
        });
        expect(Object.keys(init.headers).map(h => h.toLowerCase())).toEqual(['accept', 'content-type']);
    });

    it('accepts an equal amount written differently', async () => {
        fetchMock.mockResolvedValue(ok(200, QUOTE_RAW));
        const q = await requestSideShiftQuote(BTC, USDT_TRON, '0.001');
        expect(q.id).toBe('quote-test-0001');
    });

    it('refuses a quote for a different amount', async () => {
        fetchMock.mockResolvedValue(ok(200, { ...QUOTE_RAW, depositAmount: '0.002' }));
        await expect(requestSideShiftQuote(BTC, USDT_TRON, '0.001')).rejects.toThrow('does not match');
    });

    it('refuses a quote for a different pair', async () => {
        fetchMock.mockResolvedValue(ok(200, { ...QUOTE_RAW, settleNetwork: 'ethereum' }));
        await expect(requestSideShiftQuote(BTC, USDT_TRON, '0.001')).rejects.toThrow('does not match');
    });

    it('reads a relayed SideShift error as SideShift would mean it', async () => {
        fetchMock.mockResolvedValue(
            fail(500, { error: { code: 'QUOTE_UNAVAILABLE', message: 'Amount too low. Minimum deposit amount: 0.00037639' } }),
        );
        const e = await requestSideShiftQuote(BTC, USDT_TRON, '0.0001').catch((x: unknown) => x);
        expect(e).toBeInstanceOf(AmountOutOfRangeError);
        expect((e as AmountOutOfRangeError).min).toBe('0.00037639');
        expect((e as AmountOutOfRangeError).amount).toBe('0.0001');
    });

    it('treats a backend page that is not JSON as a retryable outage', async () => {
        fetchMock.mockResolvedValue(unreadable(502));
        const e = await requestSideShiftQuote(BTC, USDT_TRON, '0.001').catch((x: unknown) => x);
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect((e as VenueUnavailableError).retryable).toBe(true);
    });

    it('reports a network failure as retryable', async () => {
        fetchMock.mockRejectedValue(new TypeError('Network request failed'));
        const e = await requestSideShiftQuote(BTC, USDT_TRON, '0.001').catch((x: unknown) => x);
        expect(e).toBeInstanceOf(VenueUnavailableError);
    });
});

describe('mapBackendError tells the backend apart from SideShift', () => {
    it('a missing server setting is a config error, not an outage', () => {
        const e = mapBackendError(503, { error: 'Service unavailable', code: 'SIDESHIFT_NOT_CONFIGURED', message: 'x' });
        expect(e).toBeInstanceOf(VenueConfigError);
        expect(e).not.toBeInstanceOf(VenueUnavailableError);
    });

    it('the backend rate limit is retryable', () => {
        const e = mapBackendError(429, { error: 'Too many requests', message: 'Rate limit exceeded.' });
        expect(e).toBeInstanceOf(VenueUnavailableError);
        expect((e as VenueUnavailableError).retryable).toBe(true);
    });

    it('SideShift being unreachable or slow is retryable', () => {
        for (const [status, code] of [[502, 'SIDESHIFT_UNREACHABLE'], [504, 'SIDESHIFT_TIMEOUT'], [502, 'SIDESHIFT_BAD_RESPONSE']] as const) {
            expect(mapBackendError(status, { error: 'x', code, message: 'x' })).toBeInstanceOf(VenueUnavailableError);
        }
    });

    it('a request the backend refuses as invalid is not retryable', () => {
        const e = mapBackendError(400, { error: 'Validation failed', details: [] });
        expect(e).toBeInstanceOf(ChainSwapError);
        expect(e).not.toBeInstanceOf(VenueUnavailableError);
    });

    it('an error object is SideShift speaking, and uses the SideShift mapping', () => {
        const e = mapBackendError(403, { error: { code: 'ACCESS_DENIED', message: 'Access denied' } });
        expect(e.name).toBe('JurisdictionBlockedError');
    });
});

describe('createSideShiftShift', () => {
    it('sends the quote and both addresses, and returns the order', async () => {
        fetchMock.mockResolvedValue(ok(201, SHIFT_RAW));
        const order = await createSideShiftShift(QUOTE, 'T-placeholder-settle', 'bc1q-placeholder-refund');
        const { url, body } = sent();
        expect(url).toBe('https://cypherbox-backend.onrender.com/sideshift/shift');
        expect(body).toEqual({
            quoteId: 'quote-test-0001',
            settleAddress: 'T-placeholder-settle',
            refundAddress: 'bc1q-placeholder-refund',
        });
        expect(order.status).toBe('awaiting_deposit');
        expect(order.depositAddress).toBe('bc1q-placeholder-deposit');
    });

    it('refuses a shift that settles to another address', async () => {
        fetchMock.mockResolvedValue(ok(201, { ...SHIFT_RAW, settleAddress: 'T-someone-else' }));
        await expect(createSideShiftShift(QUOTE, 'T-placeholder-settle', 'bc1q-placeholder-refund')).rejects.toThrow(
            'does not match',
        );
    });

    it('refuses a shift that refunds to another address', async () => {
        fetchMock.mockResolvedValue(ok(201, { ...SHIFT_RAW, refundAddress: 'bc1q-someone-else' }));
        await expect(createSideShiftShift(QUOTE, 'T-placeholder-settle', 'bc1q-placeholder-refund')).rejects.toThrow(
            'does not match',
        );
    });

    it('refuses a shift for a different amount', async () => {
        fetchMock.mockResolvedValue(ok(201, { ...SHIFT_RAW, depositAmount: '0.0011' }));
        await expect(createSideShiftShift(QUOTE, 'T-placeholder-settle', 'bc1q-placeholder-refund')).rejects.toThrow(
            'does not match',
        );
    });

    it('asks for a fresh quote when the quote was already used', async () => {
        fetchMock.mockResolvedValue(
            fail(400, { error: { code: 'BAD_USER_INPUT', message: 'Quote has already been accepted. Request a new quote.' } }),
        );
        await expect(
            createSideShiftShift(QUOTE, 'T-placeholder-settle', 'bc1q-placeholder-refund'),
        ).rejects.toBeInstanceOf(QuoteExpiredError);
    });
});
