/**
 * Hot Vault seed copies that older builds saved on Android without the fingerprint (cipher KeystoreAESCBC, readable
 * with no prompt) are removed at launch for vaults still in the app, their "saved" flags cleared, and the user told
 * once. Copies of vaults no longer in the app stay (they can be the only copy of that seed on the phone), as do copies
 * bound to the fingerprint (KeystoreRSAECB) and copies whose cipher can't be read; iOS does nothing.
 */

const mockPlatform = { OS: 'android' as 'ios' | 'android' };
const mockAlert = jest.fn();
jest.mock('react-native', () => ({
    __esModule: true,
    get Platform() {
        return mockPlatform;
    },
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

const SEED = 'hot-vault-seed-phrase';
const META = 'hot-vault-meta';
const mockCiphers: Record<string, string | Error> = {};
const mockReset = jest.fn(async (_options?: unknown) => true);
const mockBiometry = jest.fn(async (): Promise<string | null> => 'Fingerprint');
jest.mock('react-native-keychain', () => ({
    __esModule: true,
    getAllGenericPasswordServices: jest.fn(async () => Object.keys(mockCiphers)),
    hasInternetCredentials: jest.fn(async (service: string) => {
        const cipher = mockCiphers[service];
        if (cipher instanceof Error) throw cipher;
        return cipher ? { service, storage: cipher } : false;
    }),
    resetGenericPassword: (...args: unknown[]) => mockReset(...(args as [])),
    getSupportedBiometryType: () => mockBiometry(),
    STORAGE_TYPE: { RSA: 'KeystoreRSAECB' },
}));

const mockSetFlag = jest.fn();
const mockStore = { signingMode: false, hydrated: true };
jest.mock('../../src/stores/authStore', () => ({
    __esModule: true,
    default: {
        getState: () => ({ setHotVaultKeychainBackup: mockSetFlag, signingMode: mockStore.signingMode }),
        persist: { hasHydrated: () => mockStore.hydrated, onFinishHydration: jest.fn(() => () => {}) },
    },
}));

import loc from '../../loc';
import { dropUnprotectedHotVaultBackups } from '../../src/services/hotVaultKeychain';
import { startHotVaultKeychainCheck } from '../../src/services/hotVaultKeychainUpgrade';

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

beforeEach(() => {
    for (const key of Object.keys(mockCiphers)) delete mockCiphers[key];
    jest.clearAllMocks();
    mockPlatform.OS = 'android';
    mockStore.signingMode = false;
    mockStore.hydrated = true;
    mockBiometry.mockResolvedValue('Fingerprint');
});

describe('dropUnprotectedHotVaultBackups', () => {
    it('removes copies that open without the fingerprint, seed and sidecar, and keeps protected ones', async () => {
        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        mockCiphers[`${SEED}:strong`] = 'KeystoreRSAECB';
        mockCiphers[`${META}:weak`] = 'KeystoreAESCBC'; // the sidecar isn't a seed and isn't listed as one

        expect(await dropUnprotectedHotVaultBackups(['weak', 'strong'])).toEqual(['weak']);
        const services = mockReset.mock.calls.map(([options]: any) => options.service).sort();
        expect(services).toEqual([`${META}:weak`, `${SEED}:weak`]);
    });

    it('leaves a copy whose cipher it cannot read', async () => {
        mockCiphers[`${SEED}:unknown`] = new Error('prefs unreadable');
        expect(await dropUnprotectedHotVaultBackups(['unknown'])).toEqual([]);
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('leaves the copy of a vault no longer in the app, which can be the only copy of its seed', async () => {
        mockCiphers[`${SEED}:deleted`] = 'KeystoreAESCBC';
        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        expect(await dropUnprotectedHotVaultBackups(['weak'])).toEqual(['weak']);
        const services = mockReset.mock.calls.map(([options]: any) => options.service);
        expect(services).not.toContain(`${SEED}:deleted`);
        expect(services).not.toContain(`${META}:deleted`);
    });

    it('reports a removed seed copy even when its sidecar could not be removed', async () => {
        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        mockReset.mockImplementation(async (options: any) => !String(options?.service).startsWith(META));
        expect(await dropUnprotectedHotVaultBackups(['weak'])).toEqual(['weak']);
        mockReset.mockImplementation(async () => true);
    });

    it('does nothing on iOS', async () => {
        mockPlatform.OS = 'ios';
        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        expect(await dropUnprotectedHotVaultBackups(['weak'])).toEqual([]);
        expect(mockReset).not.toHaveBeenCalled();
    });
});

describe('startHotVaultKeychainCheck', () => {
    it('clears the removed copies\' flags and says so once, for a phone that has a fingerprint now', async () => {
        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        startHotVaultKeychainCheck(['weak', 'strong']);
        await flush();
        expect(mockSetFlag).toHaveBeenCalledWith('weak', false);
        expect(mockAlert).toHaveBeenCalledTimes(1);
        expect(mockAlert.mock.calls[0][1]).toBe(loc.cypherbox.vault.storage_vault.settings.keychain_unprotected_removed);
    });

    it('uses the no-fingerprint message on a phone that still has none', async () => {
        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        mockBiometry.mockResolvedValue(null);
        startHotVaultKeychainCheck(['weak', 'strong']);
        await flush();
        expect(mockAlert.mock.calls[0][1]).toBe(loc.cypherbox.vault.storage_vault.settings.keychain_no_fingerprint);
    });

    it('says nothing when there is nothing to remove, or on a signing phone', async () => {
        mockCiphers[`${SEED}:strong`] = 'KeystoreRSAECB';
        startHotVaultKeychainCheck(['weak', 'strong']);
        await flush();
        expect(mockAlert).not.toHaveBeenCalled();

        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        mockStore.signingMode = true;
        startHotVaultKeychainCheck(['weak', 'strong']);
        await flush();
        expect(mockSetFlag).toHaveBeenCalledWith('weak', false);
        expect(mockAlert).not.toHaveBeenCalled();
    });

    it('does nothing for a vault no longer in the app', async () => {
        mockCiphers[`${SEED}:deleted`] = 'KeystoreAESCBC';
        startHotVaultKeychainCheck(['other']);
        await flush();
        expect(mockReset).not.toHaveBeenCalled();
        expect(mockAlert).not.toHaveBeenCalled();
    });

    it('waits for the auth store to load before touching the flags', async () => {
        mockStore.hydrated = false;
        mockCiphers[`${SEED}:weak`] = 'KeystoreAESCBC';
        startHotVaultKeychainCheck(['weak', 'strong']);
        await flush();
        expect(mockReset).not.toHaveBeenCalled();
        expect(mockSetFlag).not.toHaveBeenCalled();
    });
});
