/**
 * What this wallet's USDT has done: what came in, what went out, and what was
 * swapped.
 *
 * Built from two sources, because neither knows the whole story:
 *
 *   - TronGrid's index of TRC-20 transfers, which is the truth about what
 *     moved on chain and the only record that survives a reinstall;
 *   - a log of finished swaps, because the bitcoin side of a swap never
 *     touches Tron. The chain shows USDT leaving for an address; only we know
 *     it bought 224,512 sats.
 *
 * A swap's deposit is also an outgoing transfer, so the two would otherwise
 * show the same money twice. Where a log entry names the transfer that paid
 * it, the swap replaces that transfer rather than joining it.
 *
 * Pure, so the merge and the direction rules are unit-tested. Amounts stay
 * decimal strings; formatting is the screen's job.
 */

import { USDT_DECIMALS } from './constants';
import { unitsToDecimal } from './contract';
import type { TronUsdtTransfer } from '../../api/tronAPIs';

/** A swap that ended, as the store keeps it. The bitcoin side is not on Tron. */
export type UsdtSwapLogEntry = {
    /** The order's id, which is also what support would ask for. */
    readonly id: string;
    readonly atMs: number;
    /** USDT that left, as a decimal string. */
    readonly usdtAmount: string;
    /** Bitcoin that arrived, as a decimal string, when the swap settled. */
    readonly settleAmount: string | null;
    readonly settleNetwork: 'bitcoin' | 'lightning';
    readonly settleAddress: string;
    readonly status: 'settled' | 'refunded' | 'expired' | 'failed';
    /** The Tron transfer that paid the deposit, when one landed. */
    readonly depositTxId?: string;
};

export type UsdtHistoryEntry =
    | {
          readonly kind: 'received';
          readonly id: string;
          readonly atMs: number;
          /** USDT, decimal string. */
          readonly amount: string;
          /** The address it came from. */
          readonly counterparty: string;
          readonly txID: string;
      }
    | {
          readonly kind: 'sent';
          readonly id: string;
          readonly atMs: number;
          readonly amount: string;
          /** The address it went to. */
          readonly counterparty: string;
          readonly txID: string;
      }
    | {
          readonly kind: 'swap';
          readonly id: string;
          readonly atMs: number;
          /** USDT that left. */
          readonly amount: string;
          /** Bitcoin that arrived, when it did. */
          readonly settleAmount: string | null;
          readonly settleNetwork: 'bitcoin' | 'lightning';
          readonly settleAddress: string;
          readonly status: UsdtSwapLogEntry['status'];
          readonly txID?: string;
      };

const swapEntry = (log: UsdtSwapLogEntry): UsdtHistoryEntry => ({
    kind: 'swap',
    id: `swap:${log.id}`,
    atMs: log.atMs,
    amount: log.usdtAmount,
    settleAmount: log.settleAmount,
    settleNetwork: log.settleNetwork,
    settleAddress: log.settleAddress,
    status: log.status,
    ...(log.depositTxId ? { txID: log.depositTxId } : {}),
});

/**
 * Everything that happened, newest first.
 *
 * `address` decides direction: a transfer to it came in, one from it went out.
 * A transfer that is neither, which the index should never return, is dropped
 * rather than guessed at.
 *
 * Transfers are keyed by transaction id AND direction, because a transfer from
 * an address to itself is one row in the index and two things to a reader.
 */
export function buildUsdtHistory(
    address: string,
    transfers: readonly TronUsdtTransfer[],
    swaps: readonly UsdtSwapLogEntry[] = [],
): UsdtHistoryEntry[] {
    const paidBySwap = new Set(swaps.map(s => s.depositTxId).filter((id): id is string => !!id));

    const entries: UsdtHistoryEntry[] = [];
    for (const t of transfers) {
        const amount = unitsToDecimal(t.valueUnits, USDT_DECIMALS);
        if (t.to === address) {
            entries.push({
                kind: 'received',
                id: `in:${t.txID}`,
                atMs: t.atMs,
                amount,
                counterparty: t.from,
                txID: t.txID,
            });
        }
        if (t.from === address) {
            // The swap that this transfer paid for tells the whole story, so
            // the bare "sent" half of it is left out.
            if (paidBySwap.has(t.txID)) continue;
            entries.push({
                kind: 'sent',
                id: `out:${t.txID}`,
                atMs: t.atMs,
                amount,
                counterparty: t.to,
                txID: t.txID,
            });
        }
    }

    for (const log of swaps) {
        entries.push(swapEntry(log));
    }

    // Newest first, and stable for two things in the same millisecond so the
    // list does not reshuffle between reads.
    return entries.sort((a, b) => (b.atMs - a.atMs) || a.id.localeCompare(b.id));
}

/** A shortened address or id for a row. */
export function shortId(value: string): string {
    return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

/** "Today", "Yesterday", or a date, for grouping rows by day. */
export function dayLabel(atMs: number, nowMs: number = Date.now()): string {
    const day = (ms: number) => {
        const d = new Date(ms);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    };
    const diffDays = Math.round((day(nowMs) - day(atMs)) / 86_400_000);
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return new Date(atMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
