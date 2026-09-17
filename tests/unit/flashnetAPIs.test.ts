/**
 * Flashnet transport: public pricing from the device, quoting through the
 * backend.
 *
 * What this protects:
 *   - The device never sends credentials. The backend adds them.
 *   - Bounds and decimals come from Flashnet's own route data, not from our
 *     assumptions, and a pair it is not serving fails as unavailable rather
 *     than as a price of zero.
 *   - A quote is checked against the request before it can reach a confirm
 *     screen, because it decides what the user pays.
 *   - Before the deposit lands there is no order, and that is not a failure.
 *   - Nothing is logged: an order id is enough to look an order up.
 */

import BigNumber from 'bignumber.js';

import { getFlashnetOrder, getFlashnetPair, requestFlashnetQuote } from '../../src/api/flashnetAPIs';
import {
    AmountOutOfRangeError,
    ChainSwapError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
    type ChainSwapOrder,
} from '../../src/services/chainSwap/types';

const BTC = asset('btc', 'bitcoin');
const USDT_TRON = asset('usdt', 'tron');

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

const limitsBody = (over: Record<string, unknown> = {}) => ({
    generatedAt: '2026-09-17T00:00:00.000Z',
    routes: [
        {
            source: { decimals: 8 },
            destination: { decimals: 6 },
            limits: {
                exactIn: {
                    supported: true,
                    requestAmount: {
                        minAmountSmallest: '6188',
                        maxAmountSmallest: null,
                        maxUsdCents: '8740000',
                        ...over,
                    },
                },
            },
        },
    ],
});

let fetchMock: jest.Mock;
let logSpies: jest.SpyInstance[];

beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    logSpies = (['log', 'warn', 'error'] as const).map(k =>
        jest.spyOn(console, k).mockImplementation(() => undefined),
    );
});

afterEach(() => {
    for (const spy of logSpies) {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    }
});

const urls = () => fetchMock.mock.calls.map(c => c[0] as string);

describe('getFlashnetPair', () => {
    it('reads bounds from limits and the price from estimate', async () => {
        fetchMock
            .mockResolvedValueOnce(ok(limitsBody()))
            .mockResolvedValueOnce(ok({ estimatedOut: '99870000', feeBps: 11 }));

        const pair = await getFlashnetPair(BTC, USDT_TRON, '0.0013');

        expect(urls()[0]).toBe(
            'https://orchestration.flashnet.xyz/v1/orchestration/limits?sourceChain=bitcoin&sourceAsset=BTC&destinationChain=tron&destinationAsset=USDT',
        );
        expect(urls()[1]).toContain('/estimate?');
        expect(urls()[1]).toContain('amount=130000');
        expect(pair.min).toBe('0.00006188');
        expect(pair.rate.startsWith('76823.07')).toBe(true);
        expect(pair.settleAsset).toEqual({ coin: 'usdt', network: 'tron' });
    });

    it('prices at the route minimum when the user has typed nothing yet', async () => {
        fetchMock
            .mockResolvedValueOnce(ok(limitsBody()))
            .mockResolvedValueOnce(ok({ estimatedOut: '4000000' }));
        await getFlashnetPair(BTC, USDT_TRON);
        expect(urls()[1]).toContain('amount=6188');
    });

    it('derives the ceiling through the rate when Flashnet gives only a dollar cap', async () => {
        fetchMock
            .mockResolvedValueOnce(ok(limitsBody()))
            .mockResolvedValueOnce(ok({ estimatedOut: '99870000' }));
        const pair = await getFlashnetPair(BTC, USDT_TRON, '0.0013');
        const max = new BigNumber(pair.max);
        expect(max.isGreaterThan(1.1)).toBe(true);
        expect(max.isLessThan(1.2)).toBe(true);
        expect(max.decimalPlaces()).toBeLessThanOrEqual(8);
    });

    it('uses the dollar cap directly when the deposit asset is a dollar', async () => {
        fetchMock
            .mockResolvedValueOnce(ok(limitsBody({ minAmountSmallest: '800000' })))
            .mockResolvedValueOnce(ok({ estimatedOut: '1050' }));
        const pair = await getFlashnetPair(USDT_TRON, BTC, '100');
        expect(pair.max).toBe('87400');
    });

    it('treats a pair Flashnet is not serving as unavailable', async () => {
        fetchMock.mockResolvedValueOnce(
            ok({ routes: [{ limits: { exactIn: { supported: false, requestAmount: null } } }] }),
        );
        await expect(getFlashnetPair(BTC, USDT_TRON)).rejects.toBeInstanceOf(VenueUnavailableError);
    });

    it('maps a Flashnet error by its code', async () => {
        fetchMock.mockResolvedValueOnce(fail(400, { error: { code: 'unsupported_route', message: 'no' } }));
        const e = await getFlashnetPair(BTC, USDT_TRON).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(ChainSwapError);
        expect(e).not.toBeInstanceOf(VenueUnavailableError);
    });
});

describe('requestFlashnetQuote', () => {
    const quoteRaw = {
        quoteId: 'q_test',
        depositAddress: 'T-placeholder-deposit',
        amountIn: '100000000',
        estimatedOut: '129534',
        expiresAt: '2026-09-17T12:02:00.000Z',
        feeBps: 10,
    };

    it('sends the swap and both addresses to the backend, and no credentials', async () => {
        fetchMock.mockResolvedValue(ok(quoteRaw));
        const quote = await requestFlashnetQuote(USDT_TRON, BTC, '100', {
            settleAddress: 'bc1q-placeholder-settle',
            refundAddress: 'T-placeholder-refund',
        });
        const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
        expect(url).toBe('https://cypherbox-backend.onrender.com/flashnet/quote');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            sourceChain: 'tron',
            sourceAsset: 'USDT',
            destinationChain: 'bitcoin',
            destinationAsset: 'BTC',
            amount: '100000000',
            recipientAddress: 'bc1q-placeholder-settle',
            refundAddress: 'T-placeholder-refund',
        });
        expect(Object.keys(init.headers).map(h => h.toLowerCase())).toEqual(['accept', 'content-type']);
        expect(quote.depositAddress).toBe('T-placeholder-deposit');
        expect(quote.settleAmountIsFirm).toBe(false);
    });

    it('refuses a quote for a different amount', async () => {
        fetchMock.mockResolvedValue(ok({ ...quoteRaw, amountIn: '200000000' }));
        await expect(
            requestFlashnetQuote(USDT_TRON, BTC, '100', {
                settleAddress: 'bc1q-placeholder-settle',
                refundAddress: 'T-placeholder-refund',
            }),
        ).rejects.toThrow('does not match');
    });

    it('reads a missing server setting as our problem, not an outage', async () => {
        fetchMock.mockResolvedValue(
            fail(503, { error: 'Service unavailable', code: 'FLASHNET_NOT_CONFIGURED', message: 'x' }),
        );
        const e = await requestFlashnetQuote(USDT_TRON, BTC, '100', {
            settleAddress: 'bc1q-placeholder-settle',
            refundAddress: 'T-placeholder-refund',
        }).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(VenueConfigError);
    });

    it('reads a relayed Flashnet error as Flashnet meant it', async () => {
        fetchMock.mockResolvedValue(fail(400, { error: { code: 'amount_too_small', message: 'too small' } }));
        const e = await requestFlashnetQuote(USDT_TRON, BTC, '0.5', {
            settleAddress: 'bc1q-placeholder-settle',
            refundAddress: 'T-placeholder-refund',
        }).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(AmountOutOfRangeError);
    });
});

describe('getFlashnetOrder', () => {
    const previous: ChainSwapOrder = {
        id: 'q_test',
        status: 'awaiting_deposit',
        depositAddress: 'T-placeholder-deposit',
        depositAsset: USDT_TRON,
        settleAsset: BTC,
        depositAmount: '100',
        settleAmount: '0.00129534',
        settleAddress: 'bc1q-placeholder-settle',
        refundAddress: 'T-placeholder-refund',
        createdAt: new Date('2026-09-17T12:00:00.000Z'),
        expiresAt: new Date('2026-09-17T12:02:00.000Z'),
        statusChangedAt: new Date('2026-09-17T12:00:00.000Z'),
    };

    it('asks the backend by the id it holds', async () => {
        fetchMock.mockResolvedValue(ok({ quote: {}, order: null }));
        await getFlashnetOrder(previous);
        expect(urls()[0]).toBe('https://cypherbox-backend.onrender.com/flashnet/order?id=q_test');
    });

    it('leaves the order untouched while the deposit has not been detected', async () => {
        fetchMock.mockResolvedValue(ok({ quote: {}, order: null }));
        const next = await getFlashnetOrder(previous, new Date('2026-09-17T12:01:00.000Z'));
        expect(next).toEqual(previous);
    });

    it('accepts the order id replacing the quote id once the deposit lands', async () => {
        fetchMock.mockResolvedValue(
            ok({
                order: {
                    id: 'ord_test',
                    status: 'confirming',
                    quoteId: 'q_test',
                    amountIn: '100000000',
                    source: { chain: 'tron', asset: 'USDT', txHash: 'tron-tx' },
                    destination: { chain: 'bitcoin', asset: 'BTC', address: 'bc1q-placeholder-settle' },
                    depositAddress: 'T-placeholder-deposit',
                    createdAt: '2026-09-17T12:00:30.000Z',
                },
            }),
        );
        const next = await getFlashnetOrder(previous, new Date('2026-09-17T12:01:00.000Z'));
        expect(next.id).toBe('ord_test');
        expect(next.status).toBe('confirming');
        expect(next.depositTxId).toBe('tron-tx');
        // Flashnet never echoes it, so it survives only through us.
        expect(next.refundAddress).toBe('T-placeholder-refund');
    });
});

describe('requestFlashnetQuote, exact-out', () => {
    const rawOut = {
        quoteId: 'q_out',
        depositAddress: 'T-placeholder-deposit',
        expiresAt: '2026-09-18T12:02:00.000Z',
        amountMode: 'exact_out',
        targetAmountOut: '100000',
        requiredAmountIn: '77991861',
        maxAcceptedAmountIn: '77991861',
    };
    const addresses = { settleAddress: 'lnbc1-placeholder-invoice', refundAddress: 'T-placeholder-refund' };

    it('scales the amount in settle units and asks for exact_out', async () => {
        fetchMock.mockResolvedValue(ok(rawOut));
        const quote = await requestFlashnetQuote(USDT_TRON, BTC, '0.001', addresses, 'exact_out');
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
        // 0.001 BTC is the target, so it scales by the settle asset's decimals.
        expect(body.amount).toBe('100000');
        expect(body.amountMode).toBe('exact_out');
        expect(quote.depositAmount).toBe('77.991861');
        expect(quote.maxDepositAmount).toBe('77.991861');
    });

    it('checks the side the user fixed, not the derived one', async () => {
        fetchMock.mockResolvedValue(ok({ ...rawOut, targetAmountOut: '90000' }));
        await expect(
            requestFlashnetQuote(USDT_TRON, BTC, '0.001', addresses, 'exact_out'),
        ).rejects.toThrow('does not match');
    });

    it('still sends no amountMode on an ordinary exact-in quote', async () => {
        fetchMock.mockResolvedValue(
            ok({ quoteId: 'q_in', depositAddress: 'T-d', amountIn: '100000000', estimatedOut: '129534', expiresAt: '2026-09-18T12:02:00.000Z' }),
        );
        await requestFlashnetQuote(USDT_TRON, BTC, '100', addresses);
        expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).amountMode).toBeUndefined();
    });
});
