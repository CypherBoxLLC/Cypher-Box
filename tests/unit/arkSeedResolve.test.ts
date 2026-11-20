/**
 * The Ark seed's only persistent on-device copies are two Keychain entries:
 * a biometry-gated primary (seedKeychain.ts, WHEN_PASSCODE_SET_THIS_DEVICE_ONLY)
 * and a non-gated background-refresh copy (backgroundKeychain.ts,
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY). The primary is deleted by the OS when
 * the passcode is removed, never migrates to a new device, and throws on a
 * keystore/TEE fault. resolveArkSeedForRestore prefers the primary and falls
 * back to the background copy so a lost primary reopens the wallet instead of
 * routing the user to a destructive Reset while a readable copy still exists.
 */

jest.mock('react-native-keychain', () => ({ getGenericPassword: jest.fn() }));
jest.mock('../../src/services/ark/backgroundKeychain', () => ({ readBackgroundArkSeed: jest.fn() }));

import * as Keychain from 'react-native-keychain';
import { readBackgroundArkSeed } from '../../src/services/ark/backgroundKeychain';
import { ARK_SEED_KEYCHAIN_SERVICE, resolveArkSeedForRestore } from '../../src/services/ark/seedResolve';

const getGenericPassword = Keychain.getGenericPassword as unknown as jest.Mock;
const readBg = readBackgroundArkSeed as unknown as jest.Mock;

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeEach(() => {
    getGenericPassword.mockReset();
    readBg.mockReset();
});

describe('resolveArkSeedForRestore', () => {
    it('returns the primary seed and never touches the background copy when the primary is readable', async () => {
        getGenericPassword.mockResolvedValue({ password: SEED });

        const result = await resolveArkSeedForRestore();

        expect(result).toEqual({ seed: SEED, recoveredFromBackup: false });
        expect(getGenericPassword).toHaveBeenCalledWith({ service: ARK_SEED_KEYCHAIN_SERVICE });
        expect(readBg).not.toHaveBeenCalled();
    });

    it('falls back to the background copy when the primary entry is absent (passcode removed / migrated)', async () => {
        getGenericPassword.mockResolvedValue(false);
        readBg.mockResolvedValue(SEED);

        const result = await resolveArkSeedForRestore();

        expect(result).toEqual({ seed: SEED, recoveredFromBackup: true, primaryError: undefined });
        expect(readBg).toHaveBeenCalledTimes(1);
    });

    it('falls back to the background copy when the primary read throws (keystore/TEE fault)', async () => {
        const boom = new Error('KeyStoreException');
        getGenericPassword.mockRejectedValue(boom);
        readBg.mockResolvedValue(SEED);

        const result = await resolveArkSeedForRestore();

        expect(result).toEqual({ seed: SEED, recoveredFromBackup: true, primaryError: boom });
    });

    it('treats an empty primary password as no seed and falls back', async () => {
        getGenericPassword.mockResolvedValue({ password: '' });
        readBg.mockResolvedValue(SEED);

        const result = await resolveArkSeedForRestore();

        expect(result.seed).toBe(SEED);
        expect(result.recoveredFromBackup).toBe(true);
    });

    it('returns null (no seed) when neither entry yields one, preserving the primary error', async () => {
        const boom = new Error('KeyStoreException');
        getGenericPassword.mockRejectedValue(boom);
        readBg.mockResolvedValue(null);

        const result = await resolveArkSeedForRestore();

        expect(result).toEqual({ seed: null, recoveredFromBackup: false, primaryError: boom });
    });

    it('does not crash when the background read itself throws', async () => {
        getGenericPassword.mockResolvedValue(false);
        readBg.mockRejectedValue(new Error('bg read failed'));

        const result = await resolveArkSeedForRestore();

        expect(result.seed).toBeNull();
        expect(result.recoveredFromBackup).toBe(false);
    });
});
