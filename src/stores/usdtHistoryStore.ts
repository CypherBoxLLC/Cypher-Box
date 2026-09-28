import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { UsdtSwapLogEntry } from "../services/tron/history";
import { zustandStorage } from "./index";

/**
 * Swaps that ended, kept so history can show them.
 *
 * The chain is the record for everything else: a send and a receive are TRC-20
 * transfers TronGrid indexes, and they survive a reinstall without our help. A
 * swap does not. Its bitcoin side never touches Tron, so the chain shows only
 * USDT leaving for an address, and what it bought is ours to remember or lose.
 *
 * Separate from usdtSwapStore, which holds the ONE swap under way and deletes
 * it on dismiss. That is working state; this is the receipt.
 *
 * Nothing secret is kept: order ids, amounts, a destination and a transaction
 * id, all of which are on chain or at the venue already.
 */

/** Enough to look back over, small enough to keep on disk without thought. */
const MAX_ENTRIES = 100;

type UsdtHistoryState = {
    swaps: UsdtSwapLogEntry[];
};

const useUsdtHistoryStore = create<UsdtHistoryState>()(
    persist(
        (): UsdtHistoryState => ({ swaps: [] }),
        {
            name: "usdt-history-store",
            storage: createJSONStorage(() => zustandStorage),
        }
    )
);

/**
 * Write down a swap that ended.
 *
 * Keyed by order id and idempotent, because the runner can settle the same
 * swap more than once: a resume after a restart re-reads an order that was
 * already terminal. A later reading replaces an earlier one, since a swap can
 * go from settled to refunded but not back.
 */
export function recordFinishedSwap(entry: UsdtSwapLogEntry): void {
    const { swaps } = useUsdtHistoryStore.getState();
    const without = swaps.filter((s) => s.id !== entry.id);
    useUsdtHistoryStore.setState({
        swaps: [entry, ...without].sort((a, b) => b.atMs - a.atMs).slice(0, MAX_ENTRIES),
    });
}

export default useUsdtHistoryStore;
