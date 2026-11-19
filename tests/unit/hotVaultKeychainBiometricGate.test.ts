/**
 * On Android, react-native-keychain chooses the Keystore cipher at write time.
 * With no strong (Class 3) biometric enrolled it silently falls back from the
 * user-authentication-bound RSA cipher (KeystoreRSAECB) to KeystoreAESCBC,
 * which is NOT bound to any fingerprint, and the write still resolves
 * successfully. The old code treated that resolved promise as proof the seed
 * sat behind biometrics, so a mnemonic could end up readable with no prompt by
 * anyone holding the unlocked phone, while the UI recorded it as "backed up,
 * protected".
 *
 * These tests pin the fix (which mirrors saveArkSeedToKeychain): on a downgrade
 * the helper deletes the un-gated entry, reports 'no-biometric-gate', and never
 * writes the meta sidecar; on the real RSA cipher (and on iOS, where the
 * Keychain enforces the access control itself) it reports success.
 */

const mockSetGenericPassword = jest.fn();
const mockResetGenericPassword = jest.fn();

const mockPlatform = { OS: 'android' as 'ios' | 'android' };

jest.mock('react-native', () => ({
    __esModule: true,
    get Platform() {
        return mockPlatform;
    },
}));

jest.mock('react-native-keychain', () => ({
    __esModule: true,
    setGenericPassword: mockSetGenericPassword,
    getGenericPassword: jest.fn(),
    resetGenericPassword: mockResetGenericPassword,
    getAllGenericPasswordServices: jest.fn(async () => []),
    STORAGE_TYPE: { RSA: 'KeystoreRSAECB' },
    ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'bio' },
    ACCESSIBLE: { WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'whenPasscodeSet' },
}));

import {
    backupHotVaultSeed,
    backupHotVaultSeedWithMeta,
} from '../../src/services/hotVaultKeychain';

const WALLET_ID = 'a'.repeat(64);
const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED_SERVICE = `hot-vault-seed-phrase:${WALLET_ID}`;

beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'android';
});

describe('hot-vault keychain Android biometric gate', () => {
    it('rejects and deletes an un-gated (AES) entry on Android', async () => {
        mockSetGenericPassword.mockResolvedValueOnce({ storage: 'KeystoreAESCBC' });

        const result = await backupHotVaultSeed(WALLET_ID, MNEMONIC);

        expect(result).toEqual({
            ok: false,
            kind: 'no-biometric-gate',
            storage: 'KeystoreAESCBC',
        });
        // the un-gated entry must be removed, not left readable on disk
        expect(mockResetGenericPassword).toHaveBeenCalledWith({
            service: SEED_SERVICE,
        });
    });

    it('accepts the user-auth-bound RSA cipher on Android', async () => {
        mockSetGenericPassword.mockResolvedValueOnce({ storage: 'KeystoreRSAECB' });

        const result = await backupHotVaultSeed(WALLET_ID, MNEMONIC);

        expect(result).toEqual({ ok: true });
        expect(mockResetGenericPassword).not.toHaveBeenCalled();
    });

    it('does not apply the downgrade check on iOS', async () => {
        mockPlatform.OS = 'ios';
        // iOS reports storage 'keychain'; the OS enforces the access control.
        mockSetGenericPassword.mockResolvedValueOnce({ storage: 'keychain' });

        const result = await backupHotVaultSeed(WALLET_ID, MNEMONIC);

        expect(result).toEqual({ ok: true });
        expect(mockResetGenericPassword).not.toHaveBeenCalled();
    });

    it('never writes the meta sidecar when the seed save is rejected', async () => {
        // First setGenericPassword call = the seed write (downgraded). The meta
        // sidecar would be a second call; it must never happen.
        mockSetGenericPassword.mockResolvedValueOnce({ storage: 'KeystoreAESCBC' });

        const result = await backupHotVaultSeedWithMeta(WALLET_ID, MNEMONIC, {
            createdAt: 123,
        });

        expect(result).toEqual({
            ok: false,
            kind: 'no-biometric-gate',
            storage: 'KeystoreAESCBC',
        });
        expect(mockSetGenericPassword).toHaveBeenCalledTimes(1);
    });
});
