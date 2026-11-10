import { StateStorage } from "zustand/middleware";
import {
    getItem as readItem,
    setItem as writeItem,
    removeItem as deleteItem,
    getStorage,
} from "./storageService";

// Hydration-safe persistence for the auth store.
//
// The auth store holds the Strike / CoinOS sessions and the Ark exit-fee
// reserve. Its encryption key is kept in the Keychain as
// WHEN_UNLOCKED_THIS_DEVICE_ONLY (storageService.ts), so a background wake
// while the phone is locked (the app declares `fetch` + `remote-notification`
// background modes) cannot read it. storageService.getItem turns ANY failure,
// that read included, into `null`, which zustand cannot tell apart from an
// empty store: it then hydrates the store to its default (logged out, reserve
// 0) and a later write persists that default over the real state. The observed
// effects are a silent sign-out, a lost custom exit destination, and a lost
// exit-fee reserve.
//
// This adapter closes both halves of that:
//   - getItem probes the key first and THROWS on a read failure, so zustand's
//     hydrate takes its error path: it leaves the store at its default WITHOUT
//     writing anything back, and reports the failure through
//     onRehydrateStorage (see authStore).
//   - setItem / removeItem are dropped until a hydration has actually
//     succeeded, so an unhydrated default can never overwrite real state in the
//     window before the key becomes readable.
//
// authStore flips `writesEnabled` from its onRehydrateStorage success callback,
// and startAuthHydration (authHydration.ts) re-runs hydration on the next
// foreground so a process that survived a locked background wake recovers.

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
