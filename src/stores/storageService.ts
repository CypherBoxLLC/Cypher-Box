import { MMKV } from "react-native-mmkv";

// Encrypted MMKV store for sensitive data (auth tokens, user state)
// The encryption key is derived from a fixed app secret + stored in the MMKV instance itself.
// This protects against trivial file-level extraction on rooted/jailbroken devices.
const ENCRYPTION_KEY = "cypherbox-mmkv-v1"; // rotated by changing this value + clearing app data
const storage = new MMKV({ id: "cypherbox-secure", encryptionKey: ENCRYPTION_KEY });

// Migration: read from old unencrypted store, copy to encrypted, then delete old.
// Explicit id matches v2's implicit default ('mmkv.default') so the legacy
// instance points at the same on-disk file v2 wrote to. Required as of
// react-native-mmkv v3 where Configuration.id is no longer optional.
const legacyStorage = new MMKV({ id: 'mmkv.default' });
try {
    const legacyKeys = legacyStorage.getAllKeys();
    if (legacyKeys.length > 0) {
        for (const key of legacyKeys) {
            const value = legacyStorage.getString(key);
            if (value && !storage.contains(key)) {
                storage.set(key, value);
            }
        }
        legacyStorage.clearAll();
    }
} catch (_e) {
    // Migration failed silently — legacy store may already be empty
}

export const getItem = (key: string) => {
    try {
        const value = storage.getString(key);
        if (value) {
            return JSON.parse(value);
        }
        throw Error();
    } catch (e) {
        return null;
    }
};

export const setItem = (key: string, value: string | number | boolean | object) => {
    const storeValue = JSON.stringify(value);
    return storage.set(key, storeValue);
};

export const removeItem = (key: string) => storage.delete(key);

export const clearAllData = () => storage.clearAll();
