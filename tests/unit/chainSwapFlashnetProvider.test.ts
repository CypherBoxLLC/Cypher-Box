/**
 * The Flashnet provider as the UI sees it: registered through the chainSwap
 * entry point, quoting only once it has somewhere to settle and refund, and
 * returning an escalation verdict with every poll.
 */

import { asset, getChainSwapProvider, listChainSwapProviders } from '../../src/services/chainSwap';
import type { ChainSwapOrder, ChainSwapQuote } from '../../src/services/chainSwap';

const MIN = 60 * 1000;
const BTC = asset('btc', 'bitcoin');
const USDT_TRON = asset('usdt', 'tron');
const flashnet = () => getChainSwapProvider('flashnet');

let fetchMock: jest.Mock;
beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

const quote: ChainSwapQuote = {
    id: 'q_test',
    depositAsset: USDT_TRON,
    settleAsset: BTC,
    depositAmount: '100',
    settleAmount: '0.00129534',
    expiresAt: new Date(Date.now() + 2 * MIN),
    settleAmountIsFirm: false,
    depositAddress: 'T-placeholder-deposit',
    allInCostFraction: null,
};

const orderAt = (statusChangedAt: Date, status: ChainSwapOrder['status'], venueStatus?: string): ChainSwapOrder => ({
    id: 'ord_test',
    status,
    ...(venueStatus ? { venueStatus } : {}),
    depositAddress: 'T-placeholder-deposit',
    depositAsset: USDT_TRON,
    settleAsset: BTC,
    depositAmount: '100',
    settleAmount: null,
    settleAddress: 'bc1q-placeholder-settle',
    refundAddress: 'T-placeholder-refund',
    createdAt: statusChangedAt,
    expiresAt: new Date(statusChangedAt.getTime() + 2 * MIN),
    statusChangedAt,
});

const snapshot = (status: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
        order: {
            id: 'ord_test',
            status,
            quoteId: 'q_test',
            amountIn: '100000000',
            source: { chain: 'tron', asset: 'USDT' },
            destination: { chain: 'bitcoin', asset: 'BTC', address: 'bc1q-placeholder-settle' },
            createdAt: '2026-09-17T12:00:00.000Z',
        },
    }),
});

describe('registration', () => {
    it('is registered by importing the chainSwap entry point', () => {
        expect(listChainSwapProviders().map(p => p.id)).toEqual(expect.arrayContaining(['sideshift', 'flashnet']));
    });

    it('declares that a quote needs addresses, which the UI must honour', () => {
        expect(flashnet().quoteNeedsAddresses).toBe(true);
        expect(flashnet().supportUrl).toMatch(/^https:\/\//);
    });
});

describe('requestQuote', () => {
    it('refuses to quote without somewhere to settle and refund', async () => {
        await expect(flashnet().requestQuote(USDT_TRON, BTC, '100')).rejects.toThrow(/addresses/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('createShift', () => {
    it('builds the order from the quote without another call', async () => {
        const order = await flashnet().createShift(quote, 'bc1q-placeholder-settle', 'T-placeholder-refund');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(order.id).toBe('q_test');
        expect(order.status).toBe('awaiting_deposit');
        expect(order.depositAddress).toBe('T-placeholder-deposit');
        expect(order.expiresAt).toEqual(quote.expiresAt);
        expect(order.refundAddress).toBe('T-placeholder-refund');
    });

    it('refuses a quote with no deposit address', async () => {
        const noAddress = { ...quote, depositAddress: null };
        await expect(
            flashnet().createShift(noAddress, 'bc1q-placeholder-settle', 'T-placeholder-refund'),
        ).rejects.toThrow(/deposit address/);
    });
});

describe('pollShift returns a verdict with the order', () => {
    it('escalates a hold that Flashnet reports as ordinary progress', async () => {
        fetchMock.mockResolvedValue(snapshot('processing'));
        const { order, stall } = await flashnet().pollShift(orderAt(new Date(), 'confirming', 'confirming'));
        expect(order.status).toBe('held');
        expect(stall).toBe('held');
    });

    it('reports stalled when nothing has moved for 50 minutes', async () => {
        fetchMock.mockResolvedValue(snapshot('swapping'));
        const since = new Date(Date.now() - 50 * MIN);
        const { stall } = await flashnet().pollShift(orderAt(since, 'processing', 'swapping'));
        expect(stall).toBe('stalled');
    });

    it('is quiet while the swap is progressing', async () => {
        fetchMock.mockResolvedValue(snapshot('delivering'));
        const { order, stall } = await flashnet().pollShift(orderAt(new Date(), 'processing', 'swapping'));
        expect(order.status).toBe('settling');
        expect(stall).toBe('none');
    });

    it('escalates a deposit we know is on chain that Flashnet has not picked up', async () => {
        // No order yet: the backend answers with the quote only.
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ order: null, quote: { id: 'q_test' } }) });
        const paid = (minutesAgo: number) => ({
            ...orderAt(new Date(Date.now() - minutesAgo * MIN), 'awaiting_deposit'),
            depositTxId: 'ab'.repeat(32),
        });

        expect((await flashnet().pollShift(paid(1))).stall).toBe('none');
        expect((await flashnet().pollShift(paid(20))).stall).toBe('slow');
        expect((await flashnet().pollShift(paid(50))).stall).toBe('stalled');
        // Without our own deposit it is the user who has not paid, which is not a stall.
        const unpaid = orderAt(new Date(Date.now() - 50 * MIN), 'awaiting_deposit');
        expect((await flashnet().pollShift(unpaid)).stall).toBe('none');
    });
});

describe('exact-out capability', () => {
    it('declares it, so the UI can offer "I want this many sats"', () => {
        expect(flashnet().supportsExactOut).toBe(true);
    });

    it('passes the mode through to the quote', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                quoteId: 'q_out',
                depositAddress: 'T-placeholder-deposit',
                expiresAt: new Date(Date.now() + 2 * MIN).toISOString(),
                amountMode: 'exact_out',
                targetAmountOut: '100000',
                requiredAmountIn: '77991861',
                maxAcceptedAmountIn: '77991861',
            }),
        });
        const quote = await flashnet().requestQuote(
            USDT_TRON,
            BTC,
            '0.001',
            { settleAddress: 'lnbc1-placeholder-invoice', refundAddress: 'T-placeholder-refund' },
            'exact_out',
        );
        expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body).amountMode).toBe('exact_out');
        expect(quote.settleAmount).toBe('0.001');
    });
});
