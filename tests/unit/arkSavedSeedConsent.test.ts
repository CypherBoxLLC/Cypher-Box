/**
 * Seed-on-device consent for Bark vaults made on the create screen.
 *
 * Until 0.1.13, ArkSeedPhraseScreen recorded `keychainSaved: false` for every
 * vault made there, even when the seed was saved, because it read its save
 * status from React state that had not updated yet. The background copy
 * requires that consent, so background refresh never ran for those vaults.
 *
 * The record is now corrected when the vault's saved seed opens it. These
 * tests pin when that happens, and the opens that must not do it: a typed,
 * cached or background seed proves nothing about what the user saved.
 */

import RNFS from 'react-native-fs';

import useAuthStore from '../../src/stores/authStore';
import {
    ensureBackgroundArkSeed,
    readBackgroundArkSeed,
    recordSavedSeedConsent,
} from '../../src/services/ark/backgroundKeychain';
import {
    openArkWalletWithRotation,
    reopenArkWalletFromCache,
    restoreArkWalletFromDisk,
} from '../../src/services/ark/restore';
import { getCachedArkMnemonic, openArkWallet } from '../../src/services/ark/walletHandle';

const mockVault = new Map<string, string>();

jest.mock('react-native-keychain', () => ({
    ACCESSIBLE: {
        WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
        AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    },
    ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BIOMETRY_ANY_OR_DEVICE_PASSCODE' },
    setGenericPassword: jest.fn(async (_a: string, password: string, options: { service: string }) => {
        mockVault.set(options.service, password);
        return { service: options.service };
    }),
    getGenericPassword: jest.fn(async (options: { service: string }) =>
        mockVault.has(options.service)
            ? { username: 'ark', password: mockVault.get(options.service), service: options.service }
            : false,
    ),
    resetGenericPassword: jest.fn(async (options: { service: string }) => {
        mockVault.delete(options.service);
        return true;
    }),
}));

jest.mock('../../src/stores/index', () => ({
    __esModule: true,
    zustandStorage: {
        getItem: jest.fn().mockResolvedValue(null),
        setItem: jest.fn().mockResolvedValue(undefined),
        removeItem: jest.fn().mockResolvedValue(undefined),
    },
}));

jest.mock('@secondts/bark-react-native', () => ({
    __esModule: true,
    Network: { Bitcoin: 'bitcoin' },
    Config: { create: jest.fn((o: unknown) => o) },
}));

jest.mock('../../src/services/ark/walletHandle', () => ({
    __esModule: true,
    getArkWalletHandle: jest.fn(() => null),
    getCachedArkMnemonic: jest.fn(() => null),
    cacheArkMnemonicForReopen: jest.fn(),
    openArkWallet: jest.fn(async () => undefined),
}));

const SAVED_SEED_SERVICE = 'ark-seed-phrase';
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** A vault made on the create screen before the fix: saved, but recorded as not saved. */
const setCreatedVault = (over: Partial<Record<string, unknown>>) =>
    useAuthStore.setState({
        arkWallet: {
            id: 'ark-1',
            createdAt: '2026-11-01T00:00:00.000Z',
            useHotVaultSeed: false,
            keychainSaved: false,
            backupDestination: 'icloud',
        } as never,
        arkBgRefreshEnabled: true,
        arkVtxos: [{ id: 'v1' }] as never,
        arkBalance: 7480,
        arkBalanceDetail: null,
        ...over,
    } as never);

let hydrated: jest.SpyInstance;

beforeEach(() => {
    mockVault.clear();
    jest.clearAllMocks();
    hydrated = jest.spyOn(useAuthStore.persist, 'hasHydrated').mockReturnValue(true);
    setCreatedVault({});
});

afterEach(() => hydrated.mockRestore());

describe('correcting the record once the saved seed opened the vault', () => {
    it('lets a funded created vault get its background copy', async () => {
        // The bug: a consent record of false refuses the copy.
        await ensureBackgroundArkSeed(MNEMONIC);
        expect(await readBackgroundArkSeed()).toBeFalsy();

        recordSavedSeedConsent();
        await ensureBackgroundArkSeed(MNEMONIC);

        expect(useAuthStore.getState().arkWallet.keychainSaved).toBe(true);
        expect(await readBackgroundArkSeed()).toBe(MNEMONIC);
    });

    it('changes nothing else in the vault record', () => {
        recordSavedSeedConsent();

        expect(useAuthStore.getState().arkWallet).toEqual({
            id: 'ark-1',
            createdAt: '2026-11-01T00:00:00.000Z',
            useHotVaultSeed: false,
            keychainSaved: true,
            backupDestination: 'icloud',
        });
    });

    it('still writes no copy for an empty vault', async () => {
        // The consent fix must not undo the empty-vault rule.
        setCreatedVault({ arkVtxos: [], arkBalance: 0 });

        recordSavedSeedConsent();
        await ensureBackgroundArkSeed(MNEMONIC);

        expect(await readBackgroundArkSeed()).toBeFalsy();
    });

    it('leaves a record that already says saved as it is', () => {
        setCreatedVault({
            arkWallet: { id: 'ark-2', createdAt: 'x', keychainSaved: true } as never,
        });
        const before = useAuthStore.getState().arkWallet;

        recordSavedSeedConsent();

        expect(useAuthStore.getState().arkWallet).toBe(before);
    });

    it('does nothing before the store has loaded', () => {
        hydrated.mockReturnValue(false);

        recordSavedSeedConsent();

        expect(useAuthStore.getState().arkWallet.keychainSaved).toBe(false);
    });

    it('does nothing when there is no vault record', () => {
        setCreatedVault({ arkWallet: null });

        recordSavedSeedConsent();

        expect(useAuthStore.getState().arkWallet).toBeNull();
    });
});

describe('only the open from the saved seed may correct it', () => {
    beforeEach(() => {
        (RNFS.exists as jest.Mock).mockResolvedValue(true);
    });

    it('the boot open reads the saved entry and says so', async () => {
        mockVault.set(SAVED_SEED_SERVICE, MNEMONIC);

        const result = await restoreArkWalletFromDisk();

        expect(result.restored).toBe(true);
        expect(openArkWallet).toHaveBeenCalledWith(MNEMONIC, expect.objectContaining({ fromSavedSeed: true }));
    });

    it('an open with a seed handed in (typed or from a backup file) does not', async () => {
        await openArkWalletWithRotation(MNEMONIC);

        expect(openArkWallet).toHaveBeenCalledWith(MNEMONIC, expect.objectContaining({ fromSavedSeed: false }));
    });

    it('the reopen from the cached seed does not', async () => {
        (getCachedArkMnemonic as jest.Mock).mockReturnValue(MNEMONIC);

        await reopenArkWalletFromCache();

        expect(openArkWallet).toHaveBeenCalledWith(MNEMONIC, expect.objectContaining({ fromSavedSeed: false }));
    });
});
