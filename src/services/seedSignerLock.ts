import DefaultPreference from "react-native-default-preference";
import { MMKV } from "react-native-mmkv";

/**
 * Offline Seed-Signer mode is one-way: once turned on, this install of Cypher Box is a seed-signer and nothing else,
 * until the app is deleted and installed again. The lock lives in the app's own storage, never in the Keychain, so
 * deleting the app clears it (on iOS the Keychain outlives the app). It's read synchronously, so start-up can take the
 * signer's quiet path before anything connects. There is deliberately no way to unlock it.
 */
const store = new MMKV({ id: 'seed-signer-lock' });
const KEY = 'locked';

// Native start-up runs before this store can be read, so the lock is also noted in the app's shared preferences
// (also cleared by deleting the app), where MainApplication.java and AppDelegate.mm look before starting crash reports.
const NATIVE_STORE = 'group.io.cypherbox.btc';
const NATIVE_KEY = 'seedsigner';

export function isSeedSignerLocked(): boolean {
    try {
        return store.getBoolean(KEY) === true;
    } catch (_) {
        return false;
    }
}

/** Called on locking and again on every locked start, in case an earlier write didn't land. */
export function noteLockForNativeStartUp(): void {
    DefaultPreference.setName(NATIVE_STORE)
        .then(() => DefaultPreference.set(NATIVE_KEY, '1'))
        .catch(() => {});
}

export function lockSeedSigner(): void {
    store.set(KEY, true);
    noteLockForNativeStartUp();
}
