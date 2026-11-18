/**
 * Scope of the un-gated background seed copy (`ark-seed-phrase-bg`).
 *
 * That entry holds the Bark mnemonic at AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
 * with NO accessControl, because a headless wake cannot answer a biometric
 * prompt. It is the one seed store in the app that a Secure Enclave ACL does
 * not stand in front of and that stays readable while the phone is locked, so
 * it should exist only while it has a job: a capsule that can expire.
 *
 * Previously it was written on opt-in and again on every wallet-open and then
 * left in place, so an emptied vault kept an un-gated mnemonic for as long as
 * the app stayed installed. These tests pin the gate that stops that, and —
 * just as importantly — pin the cases where the copy must be LEFT ALONE,
 * because every one of those is a path where deleting it would cost the user
 * an unattended refresh and therefore real funds.
 */

type StoredItem = { password: string; options: Record<string, unknown> };
const vault = new Map<string, StoredItem>();

jest.mock('react-native-keychain', () => ({
    ACCESSIBLE: {
        WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
        AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    },
    ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BIOMETRY_ANY_OR_DEVICE_PASSCODE' },
    setGenericPassword: jest.fn(
        async (_a: string, password: string, options: { service: string }) => {
            vault.set(options.service, { password, options });
            return { service: options.service };
        },
    ),
    getGenericPassword: jest.fn(async (options: { service: string }) => {
        const hit = vault.get(options.service);
        return hit ? { username: 'ark', password: hit.password, service: options.service } : false;
    }),
    resetGenericPassword: jest.fn(async (options: { service: string }) => {
        vault.delete(options.service);
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

import useAuthStore from '../../src/stores/authStore';
import {
    arkVaultHasValueToProtect,
    ensureBackgroundArkSeed,
    pruneBackgroundArkSeedIfEmpty,
    readBackgroundArkSeed,
    writeBackgroundArkSeed,
} from '../../src/services/ark/backgroundKeychain';

const BG_SERVICE = 'ark-seed-phrase-bg';
const MNEMONIC =
    'legal winner thank year wave sausage worth useful legal winner thank yellow';

const seedExists = () => vault.has(BG_SERVICE);
const plantExistingCopy = () =>
    vault.set(BG_SERVICE, { password: MNEMONIC, options: { service: BG_SERVICE } });

/** Consented wallet; vault contents are set per test. */
const setVault = (over: Partial<Record<string, unknown>>) =>
    useAuthStore.setState({
        arkWallet: { id: 'ark-1', createdAt: '2026-11-17T00:00:00.000Z', keychainSaved: true } as never,
        arkBgRefreshEnabled: true,
        arkVtxos: [],
        arkBalance: 0,
        arkBalanceDetail: null,
        ...over,
    } as never);

let hydrated: jest.SpyInstance;

beforeEach(() => {
    vault.clear();
    jest.clearAllMocks();
    hydrated = jest.spyOn(useAuthStore.persist, 'hasHydrated').mockReturnValue(true);
    setVault({});
});

afterEach(() => hydrated.mockRestore());

describe('the copy is kept while something can expire', () => {
    it('writes it for a vault holding spendable capsules', async () => {
        setVault({ arkVtxos: [{ id: 'v1' }] as never, arkBalance: 4000 });

        await writeBackgroundArkSeed(MNEMONIC);

        expect(await readBackgroundArkSeed()).toBe(MNEMONIC);
    });

    it('keeps it when value is only in a pending bucket, not spendable', async () => {
        // Mid-exit or mid-round: nothing spendable, funds very much at stake.
        setVault({ arkBalanceDetail: { spendableSats: 0, pendingExitSats: 1500 } as never });

        await writeBackgroundArkSeed(MNEMONIC);

        expect(await readBackgroundArkSeed()).toBe(MNEMONIC);
    });

    it('counts a pending bucket this build has never heard of', async () => {
        // Object.values, not a named list: a future bucket must not read as empty.
        setVault({ arkBalanceDetail: { someFutureBucketSats: 900 } as never });

        expect(arkVaultHasValueToProtect()).toBe(true);
    });

    it('keeps it when the store has not hydrated, since defaults look empty', async () => {
        hydrated.mockReturnValue(false);
        plantExistingCopy();

        expect(arkVaultHasValueToProtect()).toBe(true);
        await ensureBackgroundArkSeed(MNEMONIC);

        // This is the locked-phone background wake: the copy it just opened the
        // wallet with must survive a store that reads as all-defaults.
        expect(seedExists()).toBe(true);
    });
});

describe('the copy is dropped once nothing can expire', () => {
    it('refuses to write it for an empty vault', async () => {
        await writeBackgroundArkSeed(MNEMONIC);

        expect(await readBackgroundArkSeed()).toBeNull();
    });

    it('removes an existing copy once the vault has been emptied', async () => {
        plantExistingCopy();

        await ensureBackgroundArkSeed(MNEMONIC);

        // Gate runs BEFORE the already-exists early return, or an emptied
        // vault would keep its copy forever on the grounds one is present.
        expect(seedExists()).toBe(false);
    });

    it('treats an all-zero balance detail as empty', async () => {
        setVault({
            arkBalanceDetail: {
                totalSats: 0,
                spendableSats: 0,
                pendingInRoundSats: 0,
                pendingExitSats: 0,
            } as never,
        });

        expect(arkVaultHasValueToProtect()).toBe(false);
    });
});

describe('unattended prune inside a background wake', () => {
    it('drops the copy when the refresh left nothing spendable', async () => {
        plantExistingCopy();

        await pruneBackgroundArkSeedIfEmpty(0);

        expect(seedExists()).toBe(false);
    });

    it('leaves it alone while capsules remain', async () => {
        plantExistingCopy();

        await pruneBackgroundArkSeedIfEmpty(3);

        expect(seedExists()).toBe(true);
    });

    it('takes the count from the caller, not the store', async () => {
        // A wake runs with the store unhydrated, where arkVtxos is [] and would
        // read as empty. The live fetch said 2, so the copy stays.
        hydrated.mockReturnValue(false);
        plantExistingCopy();

        await pruneBackgroundArkSeedIfEmpty(2);

        expect(seedExists()).toBe(true);
    });
});
