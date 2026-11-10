import { StateStorage } from "zustand/middleware";
import {
    getItem as readItem,
    setItem as writeItem,
    removeItem as deleteItem,
    getStorage,
} from "./storageService";

// Hydration-safe persistence for the auth store.
//
// The auth store's encryption key is kept in the Keychain. storageService
// getItem turns ANY failure, a key-read failure included, into `null`, which
// zustand cannot tell apart from an empty store: it then hydrates the store to
// its defaults and a later write can persist those defaults over the real
// saved state.
//
// This adapter closes both halves of that:
//   - getItem probes the key first and THROWS on a read failure, so zustand's
//     hydrate takes its error path: it leaves the store at its defaults WITHOUT
//     writing anything back, and reports the failure through
//     onRehydrateStorage (see authStore).
//   - setItem / removeItem are dropped until a hydration read has actually
//     succeeded, so defaults can never overwrite saved state in the window
//     before the key becomes readable.
//
// authStore flips `writesEnabled` from its onRehydrateStorage success callback,
// and startAuthHydration (authHydration.ts) re-runs hydration on the next
// foreground so a session that started before the key was readable recovers.

let writesEnabled = false;

/** Allow persistence writes. Called once a real hydration read has succeeded. */
export const enableAuthWrites = (): void => {
    writesEnabled = true;
};

/** True once a hydration read has succeeded and writes are allowed. */
export const authWritesEnabled = (): boolean => writesEnabled;

/** Test-only: reset the write gate between cases. */
export const __resetAuthWritesForTest = (): void => {
    writesEnabled = false;
};

export const authPersistStorage: StateStorage = {
    getItem: async (name: string) => {
        // Surface a key/storage read failure as a throw. getStorage() rejects
        // when the Keychain key cannot be read; without this probe
        // storageService.getItem would swallow it into a null and look like an
        // empty store.
        await getStorage();
        return readItem(name);
    },
    setItem: async (name: string, value: string) => {
        if (!writesEnabled) return;
        await writeItem(name, value);
    },
    removeItem: async (name: string) => {
        if (!writesEnabled) return;
        await deleteItem(name);
    },
};
