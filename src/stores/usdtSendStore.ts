import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createUsdtSendRunner, type UsdtSendRecord } from "../services/tron/sendRun";
import { zustandStorage } from "./index";

/**
 * The plain USDT send under way, if any, kept on disk.
 *
 * One send at a time. The record is what lets a send outlive its screen and
 * the app itself: see services/tron/sendRun.ts. It holds transaction ids, the
 * amount and the two Tron addresses, and nothing secret: no phrase, key or
 * signature is ever part of it.
 *
 * Separate from the swap store on purpose. A swap's deposit and a plain
 * transfer are different sends with different rules, and one of each can be in
 * flight at once without either blocking the other.
 */
type UsdtSendState = {
    record: UsdtSendRecord | null;
};

// Whether the stored send has been read back, successfully or not. Tracked
// here rather than with persist.hasHydrated(), which stays false for good when
// reading fails, and a wait on it would never end.
let readBack = false;
const readBackListeners = new Set<() => void>();
const markReadBack = () => {
    readBack = true;
    readBackListeners.forEach((listener) => listener());
    readBackListeners.clear();
};

const useUsdtSendStore = create<UsdtSendState>()(
    persist(
        (): UsdtSendState => ({ record: null }),
        {
            name: "usdt-send-store",
            storage: createJSONStorage(() => zustandStorage),
            onRehydrateStorage: () => () => markReadBack(),
        }
    )
);

/** The app's one runner, writing to this store. */
export const usdtSendRunner = createUsdtSendRunner({
    get: () => useUsdtSendStore.getState().record,
    set: (record) => useUsdtSendStore.setState({ record }),
});

/**
 * Resolves once the stored send has been read back from disk.
 *
 * A send started before then would be overwritten by the stored state when it
 * lands, and where the Send button leads depends on the stored send, so both
 * wait on this.
 */
export function whenUsdtSendStoreReady(): Promise<void> {
    if (readBack) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        readBackListeners.add(resolve);
    });
}

export default useUsdtSendStore;
