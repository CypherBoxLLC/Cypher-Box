/**
 * What this wallet's USDT has done.
 *
 * What this protects:
 *   - Direction is read from the wallet's own address, so a row is never shown
 *     as received when it was sent, which would read as money arriving that
 *     did not.
 *   - A swap and the transfer that paid its deposit are one event, not two.
 *     Showing both would double the USDT a user believes left.
 *   - A self-transfer is one chain row and two things to read, so it appears
 *     as both.
 *   - Ordering is newest first and stable, so the list does not reshuffle
 *     between reads of the same data.
 */

import type { TronUsdtTransfer } from '../../src/api/tronAPIs';
import {
    type UsdtSwapLogEntry,
    buildUsdtHistory,
    dayLabel,
    shortId,
} from '../../src/services/tron/history';

const ME = 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs';
const THEM = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb';

const transfer = (over: Partial<TronUsdtTransfer> = {}): TronUsdtTransfer => ({
    txID: 'tx1',
    from: THEM,
    to: ME,
    valueUnits: '5323000',
    atMs: 1_700_000_000_000,
    ...over,
});

const swapLog = (over: Partial<UsdtSwapLogEntry> = {}): UsdtSwapLogEntry => ({
    id: 'order-1',
    atMs: 1_700_000_100_000,
    usdtAmount: '250',
    settleAmount: '0.00224512',
    settleNetwork: 'lightning',
    settleAddress: 'lnbc1...',
    status: 'settled',
    ...over,
});

describe('direction', () => {
    it('reads a transfer to this wallet as received, with who sent it', () => {
        const [e] = buildUsdtHistory(ME, [transfer()]);
        expect(e.kind).toBe('received');
        expect(e.amount).toBe('5.323');
        expect(e.kind === 'received' && e.counterparty).toBe(THEM);
    });

    it('reads a transfer from this wallet as sent, with where it went', () => {
        const [e] = buildUsdtHistory(ME, [transfer({ from: ME, to: THEM })]);
        expect(e.kind).toBe('sent');
        expect(e.kind === 'sent' && e.counterparty).toBe(THEM);
    });

    it('shows a self transfer as both halves, since it is two things to read', () => {
        const entries = buildUsdtHistory(ME, [transfer({ from: ME, to: ME })]);
        expect(entries.map(e => e.kind).sort()).toEqual(['received', 'sent']);
    });

    it('drops a row belonging to neither side rather than guessing', () => {
        expect(buildUsdtHistory(ME, [transfer({ from: THEM, to: 'TOther' })])).toEqual([]);
    });
});

describe('swaps', () => {
    it('replaces the transfer that paid a swap, so the USDT is not counted twice', () => {
        const entries = buildUsdtHistory(
            ME,
            [transfer({ txID: 'deposit-tx', from: ME, to: 'TFlashnet' })],
            [swapLog({ depositTxId: 'deposit-tx' })],
        );
        expect(entries).toHaveLength(1);
        expect(entries[0].kind).toBe('swap');
        expect(entries[0].txID).toBe('deposit-tx');
    });

    it('keeps an unrelated outgoing transfer beside a swap', () => {
        const entries = buildUsdtHistory(
            ME,
            [
                transfer({ txID: 'deposit-tx', from: ME, to: 'TFlashnet' }),
                transfer({ txID: 'other-tx', from: ME, to: THEM, atMs: 1_700_000_050_000 }),
            ],
            [swapLog({ depositTxId: 'deposit-tx' })],
        );
        expect(entries.map(e => e.kind)).toEqual(['swap', 'sent']);
    });

    it('shows a swap whose deposit transfer is not in the page', () => {
        const [e] = buildUsdtHistory(ME, [], [swapLog({ depositTxId: 'unseen' })]);
        expect(e.kind).toBe('swap');
        expect(e.kind === 'swap' && e.settleAmount).toBe('0.00224512');
    });

    it('carries an unsettled swap with no bitcoin figure', () => {
        const [e] = buildUsdtHistory(ME, [], [swapLog({ status: 'refunded', settleAmount: null })]);
        expect(e.kind === 'swap' && e.status).toBe('refunded');
        expect(e.kind === 'swap' && e.settleAmount).toBeNull();
    });
});

describe('ordering', () => {
    it('is newest first', () => {
        const entries = buildUsdtHistory(ME, [
            transfer({ txID: 'old', atMs: 1_000 }),
            transfer({ txID: 'new', atMs: 9_000 }),
        ]);
        expect(entries.map(e => e.txID)).toEqual(['new', 'old']);
    });

    it('does not reshuffle two things in the same millisecond', () => {
        const rows = [transfer({ txID: 'b', atMs: 5 }), transfer({ txID: 'a', atMs: 5 })];
        const once = buildUsdtHistory(ME, rows).map(e => e.id);
        const twice = buildUsdtHistory(ME, [...rows].reverse()).map(e => e.id);
        expect(once).toEqual(twice);
    });
});

describe('row labels', () => {
    it('shortens only what is too long to read', () => {
        expect(shortId('short')).toBe('short');
        expect(shortId(ME)).toBe('TKHuVq1o...6fQgFs');
    });

    it('names the day in words when it is recent', () => {
        const now = new Date('2026-09-28T12:00:00Z').getTime();
        expect(dayLabel(now, now)).toBe('Today');
        expect(dayLabel(now - 86_400_000, now)).toBe('Yesterday');
        expect(dayLabel(new Date('2026-01-05T12:00:00Z').getTime(), now)).toMatch(/2026/);
    });
});
