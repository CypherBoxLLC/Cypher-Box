/**
 * The auth store's encryption key is WHEN_UNLOCKED_THIS_DEVICE_ONLY, so a
 * background wake while the phone is locked cannot read it. storageService
 * turns that read failure into a null, which zustand cannot tell apart from an
 * empty store, so it hydrates the auth store to its default and a later write
 * persists that default over the real state (silent sign-out, lost exit-fee
 * reserve, lost custom exit destination).
 *
 * authPersistStorage closes both halves:
 *   - getItem probes the key and THROWS on a read failure, so zustand's hydrate
 *     takes its error path and does not treat the failure as "no saved state".
 *   - setItem / removeItem are dropped until a hydration read has actually
 *     succeeded, so an unhydrated default can never overwrite real state.
 */

const mockGetStorage = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();

jest.mock('../../src/stores/storageService', () => ({
    __esModule: true,
    getStorage: (...a: unknown[]) => mockGetStorage(...a),
    getItem: (...a: unknown[]) => mockGetItem(...a),
    setItem: (...a: unknown[]) => mockSetItem(...a),
    removeItem: (...a: unknown[]) => mockRemoveItem(...a),
}));

import {
    authPersistStorage,
    enableAuthWrites,
    authWritesEnabled,
    __resetAuthWritesForTest,
} from '../../src/stores/authPersistStorage';

const SEED = `hot-vault`; // arbitrary key name
const AUTH = 'Auth';

beforeEach(() => {
    jest.clearAllMocks();
    __resetAuthWritesForTest();
});

describe('authPersistStorage getItem', () => {
    it('throws when the storage key cannot be read (does not look like empty)', async () => {
        mockGetStorage.mockRejectedValueOnce(new Error('keychain read failed'));

        await expect(authPersistStorage.getItem(AUTH)).rejects.toThrow('keychain read failed');
        // must NOT fall through to a read that returns null
        expect(mockGetItem).not.toHaveBeenCalled();
    });

    it('returns the stored value when the key is readable', async () => {
        mockGetStorage.mockResolvedValueOnce({});
        mockGetItem.mockResolvedValueOnce('STORED');

        await expect(authPersistStorage.getItem(AUTH)).resolves.toBe('STORED');
        expect(mockGetItem).toHaveBeenCalledWith(AUTH);
    });

    it('returns null for a genuinely empty store with a readable key', async () => {
        mockGetStorage.mockResolvedValueOnce({});
        mockGetItem.mockResolvedValueOnce(null);

        await expect(authPersistStorage.getItem(AUTH)).resolves.toBeNull();
    });
});

describe('authPersistStorage write gate', () => {
    it('drops setItem until writes are enabled, then delegates', async () => {
        await authPersistStorage.setItem(AUTH, 'V1');
        expect(mockSetItem).not.toHaveBeenCalled();

        enableAuthWrites();
        await authPersistStorage.setItem(AUTH, 'V2');
        expect(mockSetItem).toHaveBeenCalledWith(AUTH, 'V2');
    });

    it('drops removeItem until writes are enabled, then delegates', async () => {
        await authPersistStorage.removeItem(SEED);
        expect(mockRemoveItem).not.toHaveBeenCalled();

        enableAuthWrites();
        await authPersistStorage.removeItem(SEED);
        expect(mockRemoveItem).toHaveBeenCalledWith(SEED);
    });

    it('authWritesEnabled reflects the gate', () => {
        expect(authWritesEnabled()).toBe(false);
        enableAuthWrites();
        expect(authWritesEnabled()).toBe(true);
    });
});
