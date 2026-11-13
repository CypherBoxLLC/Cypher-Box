/**
 * The background-readable Ark seed copy, before the auth store has loaded.
 *
 * A background wake on a locked iPhone (a silent push, a background fetch)
 * opens the Bark wallet from this copy while the auth store is still at its
 * defaults: the store's encryption key cannot be read until the phone is
 * unlocked. At the defaults arkWallet is null, which reads as "no consent to
 * keep the seed on this device", and the wallet-open self-heal deleted the
 * copy, so no later wake could refresh capsules before they expired. Nothing
 * may be deleted on default values; once the store has loaded, the consent
 * rules apply as before.
 */

import { ensureBackgroundArkSeed, writeBackgroundArkSeed } from '../../src/services/ark/backgroundKeychain';
import { registerArkNotificationTapHandler } from '../../src/services/ark/notificationHandler';

const BG_SERVICE = 'ark-seed-phrase-bg';
const SEED = 'test seed words for the background copy';

const mockVault = new Map<string, string>();

jest.mock('react-native-keychain', () => ({
    ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' },
    getGenericPassword: async ({ service }: { service: string }) =>
        mockVault.has(service) ? { username: 'ark', password: mockVault.get(service), service } : false,
    setGenericPassword: async (_account: string, password: string, { service }: { service: string }) => {
        mockVault.set(service, password);
        return { service };
    },
    resetGenericPassword: async ({ service }: { service: string }) => {
        mockVault.delete(service);
        return true;
    },
}));

type MockAuthState = { arkBgRefreshEnabled: boolean; arkWallet: { keychainSaved?: boolean } | null };

/** The auth store's defaults: what a store that has not loaded reports. */
const DEFAULTS: MockAuthState = { arkBgRefreshEnabled: true, arkWallet: null };

const mockAuth = {
    state: { ...DEFAULTS },
    hydrated: false,
    onLoad: new Set<() => void>(),
};

jest.mock('@Cypher/stores/authStore', () => ({
    __esModule: true,
    default: {
        getState: () => mockAuth.state,
        persist: {
            hasHydrated: () => mockAuth.hydrated,
            onFinishHydration: (listener: () => void) => {
                mockAuth.onLoad.add(listener);
                return () => mockAuth.onLoad.delete(listener);
            },
        },
    },
}));

// notificationHandler's own imports, none of which these tests exercise.
jest.mock('react-native-push-notification', () => ({ __esModule: true, default: { configure: jest.fn() } }));
jest.mock('react-native-simple-toast', () => ({ show: jest.fn(), LONG: 1 }));
jest.mock('../../NavigationService', () => ({ navigationRef: { isReady: () => false, current: null } }));
jest.mock('../../src/services/ark/backgroundNotifications', () => ({
    isArkCapsuleTapSource: () => false,
    isArkExpiryWarningSource: () => false,
    isArkStuckSwapSource: () => false,
}));

/** The auth store finishing its load with `saved`. */
function load(saved: Partial<MockAuthState>): void {
    mockAuth.state = { ...DEFAULTS, ...saved };
    mockAuth.hydrated = true;
    [...mockAuth.onLoad].forEach(listener => listener());
}

const settle = () => new Promise(resolve => setImmediate(resolve));

let warn: jest.SpyInstance;

beforeEach(() => {
    mockVault.clear();
    mockAuth.state = { ...DEFAULTS };
    mockAuth.hydrated = false;
    mockAuth.onLoad.clear();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    warn.mockRestore();
});

describe('before the auth store has loaded', () => {
    it('keeps the copy a background wake opened the wallet with', async () => {
        mockVault.set(BG_SERVICE, SEED);
        await ensureBackgroundArkSeed(SEED);
        expect(mockVault.get(BG_SERVICE)).toBe(SEED);
    });

    it('neither deletes nor writes the copy when asked to mirror the seed', async () => {
        mockVault.set(BG_SERVICE, SEED);
        await writeBackgroundArkSeed('other words');
        expect(mockVault.get(BG_SERVICE)).toBe(SEED);
    });
});

describe('once the auth store has loaded', () => {
    beforeEach(() => {
        mockAuth.hydrated = true;
    });

    it('still removes a copy the user never agreed to keep', async () => {
        mockVault.set(BG_SERVICE, SEED);
        mockAuth.state = { arkBgRefreshEnabled: true, arkWallet: { keychainSaved: false } };
        await ensureBackgroundArkSeed(SEED);
        expect(mockVault.has(BG_SERVICE)).toBe(false);
    });

    it('still refuses to mirror the seed without consent, and cleans up', async () => {
        mockVault.set(BG_SERVICE, SEED);
        mockAuth.state = { arkBgRefreshEnabled: true, arkWallet: {} };
        await writeBackgroundArkSeed(SEED);
        expect(mockVault.has(BG_SERVICE)).toBe(false);
    });

    it('writes a missing copy for a user who agreed', async () => {
        mockAuth.state = { arkBgRefreshEnabled: true, arkWallet: { keychainSaved: true } };
        await ensureBackgroundArkSeed(SEED);
        expect(mockVault.get(BG_SERVICE)).toBe(SEED);
    });
});

describe('the boot-time clean-up of the copy', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    async function boot(): Promise<void> {
        registerArkNotificationTapHandler();
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        await settle();
    }

    it('waits for the store to load, then deletes the copy if background refresh is off', async () => {
        mockVault.set(BG_SERVICE, SEED);
        await boot();
        expect(mockVault.get(BG_SERVICE)).toBe(SEED); // the default says on; it must not decide on that

        load({ arkBgRefreshEnabled: false });
        await settle();
        expect(mockVault.has(BG_SERVICE)).toBe(false);
        expect(mockAuth.onLoad.size).toBe(0); // it stops listening after deciding
    });

    it('keeps the copy when the saved setting is on', async () => {
        mockVault.set(BG_SERVICE, SEED);
        await boot();
        load({ arkBgRefreshEnabled: true });
        await settle();
        expect(mockVault.get(BG_SERVICE)).toBe(SEED);
    });

    it('decides at once when the store loaded first', async () => {
        mockVault.set(BG_SERVICE, SEED);
        load({ arkBgRefreshEnabled: false });
        await boot();
        expect(mockVault.has(BG_SERVICE)).toBe(false);
        expect(mockAuth.onLoad.size).toBe(0);
    });
});
