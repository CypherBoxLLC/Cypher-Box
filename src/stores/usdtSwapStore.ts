import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createUsdtSwapRunner, type UsdtSwapRecord } from "../services/tron/swapRun";
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

/** The app's one runner, writing to this store. */
export const usdtSwapRunner = createUsdtSwapRunner({
    get: () => useUsdtSwapStore.getState().record,
    set: (record) => useUsdtSwapStore.setState({ record }),
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
