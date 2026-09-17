/**
 * The SideShift provider as the UI will see it: registered through the
 * chainSwap entry point, and returning an escalation verdict with every poll.
 * Transport and mapping rules are covered in their own files; this checks
 * the wiring between them.
 */

import { getChainSwapProvider, listChainSwapProviders } from '../../src/services/chainSwap';
import type { ChainSwapOrder } from '../../src/services/chainSwap';

const MIN = 60 * 1000;

let fetchMock: jest.Mock;
beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

const previousAt = (statusChangedAt: Date, status: ChainSwapOrder['status'], venueStatus: string): ChainSwapOrder => ({
    id: 'shift-test-0001',
    status,
    venueStatus,
    depositAddress: 'bc1q-placeholder-deposit',
    depositAsset: { coin: 'btc', network: 'bitcoin' },
    settleAsset: { coin: 'usdt', network: 'tron' },
    depositAmount: '0.001',
    settleAmount: '76.91',
    settleAddress: 'T-placeholder-settle',
    refundAddress: 'bc1q-placeholder-refund',
    createdAt: new Date(statusChangedAt.getTime() - MIN),
    expiresAt: new Date(statusChangedAt.getTime() + 15 * MIN),
    statusChangedAt,
});

const shiftBody = (status: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
        id: 'shift-test-0001',
        createdAt: '2026-09-11T10:00:00.000Z',
        depositCoin: 'BTC',
        settleCoin: 'USDT',
        depositNetwork: 'bitcoin',
        settleNetwork: 'tron',
        settleAddress: 'T-placeholder-settle',
        depositAmount: '0.001',
        expiresAt: '2026-09-11T10:15:00.000Z',
        status,
    }),
});

describe('registration', () => {
    it('is registered by importing the chainSwap entry point', () => {
        expect(listChainSwapProviders().map(p => p.id)).toContain('sideshift');
    });

    it('has a support link to show when an order is stuck', () => {
        expect(getChainSwapProvider('sideshift').supportUrl).toMatch(/^https:\/\//);
    });
});

describe('pollShift returns a verdict with the order', () => {
    it('reports stalled when processing has not moved for 50 minutes', async () => {
        fetchMock.mockResolvedValue(shiftBody('processing'));
        const since = new Date(Date.now() - 50 * MIN);
        const { order, stall } = await getChainSwapProvider('sideshift').pollShift(previousAt(since, 'processing', 'processing'));
        expect(order.statusChangedAt).toEqual(since);
        expect(stall).toBe('stalled');
    });

    it('reports held at once when SideShift puts the order under review', async () => {
        fetchMock.mockResolvedValue(shiftBody('review'));
        const { order, stall } = await getChainSwapProvider('sideshift').pollShift(previousAt(new Date(), 'processing', 'processing'));
        expect(order.status).toBe('held');
        expect(stall).toBe('held');
    });

    it('resets to none when the order moves', async () => {
        fetchMock.mockResolvedValue(shiftBody('settling'));
        const since = new Date(Date.now() - 50 * MIN);
        const { stall } = await getChainSwapProvider('sideshift').pollShift(previousAt(since, 'processing', 'processing'));
        expect(stall).toBe('none');
    });
});

describe('checkPermission', () => {
    it('fails closed when SideShift cannot be reached', async () => {
        fetchMock.mockRejectedValue(new TypeError('Network request failed'));
        const verdict = await getChainSwapProvider('sideshift').checkPermission();
        expect(verdict.allowed).toBe(false);
    });
});
