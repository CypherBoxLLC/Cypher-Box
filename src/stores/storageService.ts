import { MMKV } from "react-native-mmkv";
import * as Keychain from "react-native-keychain";
import { randomBytes } from "../../class/rng";

// Encrypted MMKV store for sensitive data (auth tokens, user state).
//
// The AES key is a device-generated random value held in the platform
// Keychain/Keystore (hardware-backed where available), NOT a compile-time
// constant. The previous implementation used the hardcoded public string
// "cypherbox-mmkv-v1", which shipped inside the binary and therefore
// offered only obfuscation: anyone with the public APK and a copy of the
// MMKV file could decrypt the custodial (CoinOS/Strike) bearer tokens
// persisted here. With a keychain-held key, offline decryption requires
// both the file AND the device's keystore.
//
// Store generations:
//   v1 'mmkv.default'        — unencrypted (legacy)
//   v2 'cypherbox-secure'    — encrypted with the hardcoded public key (legacy)
//   v3 'cypherbox-secure-v3' — encrypted with a keychain-held device key (current)
const STORE_ID_V3 = "cypherbox-secure-v3";
const KEYCHAIN_SERVICE = "cypherbox.mmkv.v3.key";
const LEGACY_V2_ID = "cypherbox-secure";
const LEGACY_V2_PUBLIC_KEY = "cypherbox-mmkv-v1";
const LEGACY_V1_ID = "mmkv.default";

let storagePromise: Promise<MMKV> | null = null;

async function getOrCreateEncryptionKey(): Promise<string> {
    const credentials = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (credentials && typeof credentials !== "boolean" && credentials.password) {
        return credentials.password;
    }
    const key = (await randomBytes(32)).toString("hex");
    await Keychain.setGenericPassword(KEYCHAIN_SERVICE, key, {
        service: KEYCHAIN_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return key;
}

function migrateInto(store: MMKV, legacy: MMKV): void {
    try {
        const legacyKeys = legacy.getAllKeys();
        if (legacyKeys.length > 0) {
            for (const key of legacyKeys) {
                const value = legacy.getString(key);
                if (value && !store.contains(key)) {
                    store.set(key, value);
                }
            }
            legacy.clearAll();
        }
    } catch (_e) {
        // Migration is best-effort: a corrupted legacy store must not break
        // startup. Worst case the user re-authenticates.
    }
}

async function createStorage(): Promise<MMKV> {
    const key = await getOrCreateEncryptionKey();
    const store = new MMKV({ id: STORE_ID_V3, encryptionKey: key });

    // v2 -> v3: read with the (public) v2 key, re-encrypt under the device key.
    migrateInto(store, new MMKV({ id: LEGACY_V2_ID, encryptionKey: LEGACY_V2_PUBLIC_KEY }));
    // v1 -> v3: belt-and-braces for installs that skipped the v2 migration.
    migrateInto(store, new MMKV({ id: LEGACY_V1_ID }));

    return store;
}

function getStorage(): Promise<MMKV> {
    if (!storagePromise) {
        storagePromise = createStorage();
    }
    return storagePromise;
}

export const getItem = async (key: string) => {
    try {
        const storage = await getStorage();
        const value = storage.getString(key);
        if (value) {
            return JSON.parse(value);
        }
        throw Error();
    } catch (e) {
        return null;
    }
};

export const setItem = async (key: string, value: string | number | boolean | object) => {
    const storage = await getStorage();
    const storeValue = JSON.stringify(value);
    return storage.set(key, storeValue);
};

export const removeItem = async (key: string) => {
    const storage = await getStorage();
    return storage.delete(key);
};

export const clearAllData = async () => {
    const storage = await getStorage();
    return storage.clearAll();
};
