import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createUsdtSwapRunner, type UsdtSwapRecord } from "../services/tron/swapRun";
import { recordFinishedSwap } from "./usdtHistoryStore";
import { zustandStorage } from "./index";

/**
 * The USDT swap under way, if any, kept on disk.
 *
 * One swap at a time. The record is what lets a swap outlive its screens and
 * the app itself: see services/tron/swapRun.ts. It holds order and transaction
 * ids, amounts, the destination and the Tron address, and nothing secret: no
 * phrase, key or signature is ever part of it.
 */
type UsdtSwapState = {
    record: UsdtSwapRecord | null;
};

// Whether the stored swap has been read back, successfully or not. Tracked
// here rather than with persist.hasHydrated(), which stays false for good when
// reading fails, and a wait on it would never end.
let readBack = false;
const readBackListeners = new Set<() => void>();
const markReadBack = () => {
    readBack = true;
    readBackListeners.forEach((listener) => listener());
    readBackListeners.clear();
};

const useUsdtSwapStore = create<UsdtSwapState>()(
    persist(
        (): UsdtSwapState => ({ record: null }),
        {
            name: "usdt-swap-store",
            storage: createJSONStorage(() => zustandStorage),
            onRehydrateStorage: () => () => markReadBack(),
        }
    )
);

/**
 * Copy a swap that just ended into history.
 *
 * Done here rather than inside the runner because it is a consequence of the
 * record changing, not a step of running a swap, and the runner is tested
 * against a plain object that has no history to write to.
 *
 * Only a swap that reached the venue is kept. One that never sent anything is
 * an attempt, not an event.
 */
function logIfFinished(previous: UsdtSwapRecord | null, next: UsdtSwapRecord | null): void {
    if (!next || next.phase !== 'finished') return;
    // The runner can settle the same swap twice, when a resume re-reads an
    // order that was already terminal. Re-logging an unchanged one is noise.
    if (previous && previous.phase === 'finished' && previous.order.status === next.order.status) return;
    const { order, quote } = next;
    const status =
        order.status === 'settled' || order.status === 'refunded' || order.status === 'expired'
            ? order.status
            : 'failed';
    recordFinishedSwap({
        id: order.id,
        atMs: next.updatedAtMs,
        usdtAmount: quote.depositAmount,
        settleAmount: status === 'settled' ? order.settleAmount ?? quote.settleAmount : null,
        settleNetwork: order.settleAsset.network === 'bitcoin' ? 'bitcoin' : 'lightning',
        settleAddress: order.settleAddress,
        status,
        ...(order.depositTxId ? { depositTxId: order.depositTxId } : {}),
    });
}

/** The app's one runner, writing to this store. */
export const usdtSwapRunner = createUsdtSwapRunner({
    get: () => useUsdtSwapStore.getState().record,
    set: (record) => {
        const previous = useUsdtSwapStore.getState().record;
        useUsdtSwapStore.setState({ record });
        logIfFinished(previous, record);
    },
});

/**
 * Resolves once the stored swap has been read back from disk.
 *
 * A swap started before then would be overwritten by the stored state when it
 * lands, and where the Swap button leads depends on the stored swap, so both
 * wait on this.
 */
export function whenUsdtSwapStoreReady(): Promise<void> {
    if (readBack) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        readBackListeners.add(resolve);
    });
}

export default useUsdtSwapStore;
