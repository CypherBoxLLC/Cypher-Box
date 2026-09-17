/**
 * Folding SideShift's shift object into the order the wallet holds.
 *
 * The rules that matter are the ones a user would notice if they broke:
 *   - A stall must be measured from the last real progress. SideShift only
 *     guarantees updatedAt once an order settles or refunds, so the wallet
 *     tracks progress itself. An unchanged status must not reset the clock, or
 *     a stuck order would never escalate. A real change must reset it, even
 *     when two SideShift states normalise to the same status.
 *   - The deposit address the user was shown must not vanish when SideShift
 *     unassigns it after its retention period.
 *   - A malformed response fails loudly instead of producing an Invalid Date
 *     that silently breaks a countdown.
 */

import {
    mapSideShiftPair,
    mapSideShiftQuote,
    mapSideShiftShift,
    type SideShiftShiftRaw,
} from '../../src/services/chainSwap/providers/sideshiftMapping';
import { ChainSwapError, evaluateStall } from '../../src/services/chainSwap/types';

const MIN = 60 * 1000;
const T0 = new Date('2026-09-11T10:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

// Placeholder values throughout, not real addresses or hashes.
const raw = (over: Partial<SideShiftShiftRaw> = {}): SideShiftShiftRaw => ({
    id: 'shift-test-0001',
    createdAt: '2026-09-11T09:59:00.000Z',
    depositCoin: 'BTC',
    settleCoin: 'USDT',
    depositNetwork: 'bitcoin',
    settleNetwork: 'tron',
    depositAddress: 'bc1q-placeholder-deposit',
    settleAddress: 'T-placeholder-settle',
    refundAddress: 'bc1q-placeholder-refund',
    depositAmount: '0.00129534',
    settleAmount: '99.87',
    expiresAt: '2026-09-11T10:04:47.000Z',
    status: 'waiting',
    ...over,
});

describe('pair and quote', () => {
    it('maps a pair, lower-casing assets and keeping amounts as strings', () => {
        expect(
            mapSideShiftPair({
                min: '0.00037639',
                max: '0.78089118',
                rate: '72950.072',
                depositCoin: 'BTC',
                settleCoin: 'USDT',
                depositNetwork: 'bitcoin',
                settleNetwork: 'tron',
            }),
        ).toEqual({
            depositAsset: { coin: 'btc', network: 'bitcoin' },
            settleAsset: { coin: 'usdt', network: 'tron' },
            min: '0.00037639',
            max: '0.78089118',
            rate: '72950.072',
        });
    });

    it('maps a quote with no fabricated cost percentage', () => {
        const q = mapSideShiftQuote({
            id: 'quote-test-0001',
            createdAt: '2026-09-11T10:00:00.000Z',
            depositCoin: 'BTC',
            settleCoin: 'USDT',
            depositNetwork: 'bitcoin',
            settleNetwork: 'tron',
            expiresAt: '2026-09-11T10:15:00.000Z',
            depositAmount: '0.00129534',
            settleAmount: '99.87',
            rate: '77101.3',
        });
        expect(q.allInCostFraction).toBeNull();
        expect(q.expiresAt.toISOString()).toBe('2026-09-11T10:15:00.000Z');
        expect(q.depositAmount).toBe('0.00129534');
    });

    it('rejects a quote with a malformed expiry rather than an Invalid Date', () => {
        expect(() =>
            mapSideShiftQuote({
                id: 'q',
                createdAt: '2026-09-11T10:00:00.000Z',
                depositCoin: 'BTC',
                settleCoin: 'USDT',
                depositNetwork: 'bitcoin',
                settleNetwork: 'tron',
                expiresAt: 'not-a-date',
                depositAmount: '1',
                settleAmount: '1',
                rate: '1',
            }),
        ).toThrow(ChainSwapError);
    });
});

describe('first sighting of a shift', () => {
    it('starts the status clock at now and records the venue status', () => {
        const o = mapSideShiftShift(raw(), T0);
        expect(o.status).toBe('awaiting_deposit');
        expect(o.venueStatus).toBe('waiting');
        expect(o.statusChangedAt).toEqual(T0);
        expect(o.depositAddress).toBe('bc1q-placeholder-deposit');
        expect(o.depositAmount).toBe('0.00129534');
    });
});

describe('the stall clock moves only on real progress', () => {
    it('keeps statusChangedAt when nothing changed', () => {
        const first = mapSideShiftShift(raw({ status: 'processing' }), T0);
        const again = mapSideShiftShift(raw({ status: 'processing' }), later(30 * MIN), first);
        expect(again.statusChangedAt).toEqual(T0);
    });

    it('advances statusChangedAt when the status changes', () => {
        const first = mapSideShiftShift(raw({ status: 'pending' }), T0);
        const moved = mapSideShiftShift(raw({ status: 'processing' }), later(5 * MIN), first);
        expect(moved.statusChangedAt).toEqual(later(5 * MIN));
    });

    it('treats a venue state change as progress even when statuses normalise alike', () => {
        // `refund` (queued) and `refunding` (transaction created) both normalise
        // to refunding, but the second is real progress. Without resetting, a
        // refund waiting on a confirmation could read as stalled from the
        // moment it was first queued.
        const first = mapSideShiftShift(raw({ status: 'refund' }), T0);
        const next = mapSideShiftShift(raw({ status: 'refunding' }), later(10 * MIN), first);
        expect(next.status).toBe('refunding');
        expect(next.statusChangedAt).toEqual(later(10 * MIN));
    });

    it('keeps the clock when the previous order has no venue status to compare', () => {
        const first = mapSideShiftShift(raw({ status: 'processing' }), T0);
        const withoutVenue = { ...first, venueStatus: undefined };
        const again = mapSideShiftShift(raw({ status: 'processing' }), later(20 * MIN), withoutVenue);
        expect(again.statusChangedAt).toEqual(T0);
    });

    it('lets a stuck order escalate across polls, end to end', () => {
        // The reason for client tracking. Resetting the clock on every poll
        // would keep a stuck order looking healthy forever.
        const first = mapSideShiftShift(raw({ status: 'processing' }), T0);
        const now = later(50 * MIN);
        const polled = mapSideShiftShift(raw({ status: 'processing' }), now, first);
        expect(evaluateStall(polled.status, polled.statusChangedAt, now)).toBe('stalled');
    });
});

describe('the deposit address survives unassignment', () => {
    it('falls back to the previous address when SideShift returns null', () => {
        const first = mapSideShiftShift(raw({ status: 'settled' }), T0);
        const aged = mapSideShiftShift(
            raw({ status: 'settled', depositAddress: null }),
            later(61 * 24 * 60 * MIN),
            first,
        );
        expect(aged.depositAddress).toBe('bc1q-placeholder-deposit');
    });

    it('reports null when there is no previous address to keep', () => {
        expect(mapSideShiftShift(raw({ depositAddress: null }), T0).depositAddress).toBeNull();
    });
});

describe('holds and reasons', () => {
    it('maps review to held with the reason', () => {
        const o = mapSideShiftShift(raw({ status: 'review', issue: 'incorrect amount' }), T0);
        expect(o.status).toBe('held');
        expect(o.issue).toBe('incorrect amount');
    });

    it('clears the reason once the order leaves the hold', () => {
        const held = mapSideShiftShift(raw({ status: 'review', issue: 'rate drift' }), T0);
        const settled = mapSideShiftShift(raw({ status: 'settled' }), later(20 * MIN), held);
        expect(settled.issue).toBeUndefined();
    });
});

describe('receipts', () => {
    it('carries deposit and settle transaction ids once known', () => {
        const o = mapSideShiftShift(raw({ status: 'settled', depositHash: 'dep-hash', settleHash: 'set-hash' }), T0);
        expect(o.depositTxId).toBe('dep-hash');
        expect(o.settleTxId).toBe('set-hash');
    });

    it('keeps a known transaction id if a later poll omits it', () => {
        const first = mapSideShiftShift(raw({ status: 'settled', settleHash: 'set-hash' }), T0);
        const again = mapSideShiftShift(raw({ status: 'settled' }), later(MIN), first);
        expect(again.settleTxId).toBe('set-hash');
    });
});

describe('malformed responses fail loudly', () => {
    it('refuses a different shift id than the one polled', () => {
        const first = mapSideShiftShift(raw(), T0);
        expect(() => mapSideShiftShift(raw({ id: 'shift-other' }), later(MIN), first)).toThrow(ChainSwapError);
    });

    it('refuses a shift with no deposit amount and nothing to fall back on', () => {
        expect(() => mapSideShiftShift(raw({ depositAmount: undefined }), T0)).toThrow(ChainSwapError);
    });

    it('refuses an invalid timestamp', () => {
        expect(() => mapSideShiftShift(raw({ expiresAt: 'soon' }), T0)).toThrow(ChainSwapError);
    });
});
