/**
 * Region-gate reactivity.
 *
 * isStrikeAllowed()/isCoinosAllowed() read the App Store storefront, which
 * can be unavailable for a moment after launch and is filled in by
 * refreshStorefrontCountry(). A component that read a gate at mount would
 * otherwise stay on the first (fail-closed) answer. subscribeRegionGate /
 * getRegionGateVersion back the useRegionGate hook that re-renders those
 * components when the storefront actually resolves. These tests pin that a
 * change notifies subscribers exactly once, and that a no-op refresh does
 * not.
 */

export {};

const DEV_BEFORE = (global as any).__DEV__;

type Setup = {
    os: 'ios' | 'android';
    storefront?: string | null;   // module constant; undefined = module absent
    refreshed?: string | null;    // what getCountryCode() resolves to
};

function loadGate({ os, storefront, refreshed }: Setup) {
    jest.resetModules();
    const CypherStorefront = storefront === undefined
        ? undefined
        : { countryCode: storefront, getCountryCode: async () => refreshed ?? storefront };
    jest.doMock('react-native', () => ({
        Platform: { OS: os },
        NativeModules: { CypherStorefront },
    }));
    jest.doMock('react-native-localize', () => ({
        getCountry: () => null,
        getLocales: () => [],
    }));
    return require('../../src/services/featureFlags');
}

beforeEach(() => {
    (global as any).__DEV__ = false;
});

afterEach(() => {
    (global as any).__DEV__ = DEV_BEFORE;
    jest.resetModules();
});

describe('region-gate reactivity', () => {
    it('starts at version 0', () => {
        const gate = loadGate({ os: 'ios', storefront: null });
        expect(gate.getRegionGateVersion()).toBe(0);
    });

    it('notifies subscribers and bumps the version when the storefront resolves', async () => {
        const gate = loadGate({ os: 'ios', storefront: null, refreshed: 'USA' });
        let calls = 0;
        gate.subscribeRegionGate(() => { calls += 1; });
        await gate.refreshStorefrontCountry();
        expect(calls).toBe(1);
        expect(gate.getRegionGateVersion()).toBe(1);
    });

    it('does not notify when the refreshed value is unchanged', async () => {
        const gate = loadGate({ os: 'ios', storefront: null, refreshed: 'USA' });
        let calls = 0;
        gate.subscribeRegionGate(() => { calls += 1; });
        await gate.refreshStorefrontCountry(); // null -> USA: one notification
        await gate.refreshStorefrontCountry(); // USA -> USA: no-op
        expect(calls).toBe(1);
        expect(gate.getRegionGateVersion()).toBe(1);
    });

    it('does not notify when the storefront stays unavailable', async () => {
        const gate = loadGate({ os: 'ios', storefront: null, refreshed: null });
        let calls = 0;
        gate.subscribeRegionGate(() => { calls += 1; });
        await gate.refreshStorefrontCountry();
        expect(calls).toBe(0);
        expect(gate.getRegionGateVersion()).toBe(0);
    });

    it('stops calling a listener after it unsubscribes', async () => {
        const gate = loadGate({ os: 'ios', storefront: null, refreshed: 'USA' });
        let calls = 0;
        const unsubscribe = gate.subscribeRegionGate(() => { calls += 1; });
        unsubscribe();
        await gate.refreshStorefrontCountry();
        expect(calls).toBe(0);
        // The value still changed, so the shared version advances for anyone
        // who subscribes later.
        expect(gate.getRegionGateVersion()).toBe(1);
    });

    it('never fires on Android, which has no storefront to refresh', async () => {
        const gate = loadGate({ os: 'android', storefront: 'USA', refreshed: 'USA' });
        let calls = 0;
        gate.subscribeRegionGate(() => { calls += 1; });
        await gate.refreshStorefrontCountry();
        expect(calls).toBe(0);
        expect(gate.getRegionGateVersion()).toBe(0);
    });
});

/*
 * The launch read can come back empty: offline, a background launch from a
 * silent push, StoreKit not ready yet. watchStorefrontCountry() reads again
 * on every return to the foreground and, while the storefront is unknown,
 * after 1, 3, 10 and 30 seconds. Each test starts like index.js: the launch
 * read, then the watch.
 */
describe('keeping the iOS storefront current after launch', () => {
    /** `answerMs` delays each getCountryCode() answer, for StoreKit being slow. */
    type Phone = { storefront: string | null; locked: boolean; answerMs: number };

    function launch({ os = 'ios', storefront = null, answerMs = 0 }: { os?: 'ios' | 'android'; storefront?: string | null; answerMs?: number } = {}) {
        jest.resetModules();
        // `storefront` is the module constant, read once; getCountryCode()
        // answers with whatever the phone has when it answers.
        const phone: Phone = { storefront, locked: false, answerMs };
        const getCountryCode = jest.fn(() => new Promise<string | null>(resolve => {
            if (phone.answerMs > 0) setTimeout(() => resolve(phone.storefront), phone.answerMs);
            else resolve(phone.storefront);
        }));
        const listeners: Array<(state: string) => void> = [];
        const addEventListener = jest.fn((_type: string, listener: (state: string) => void) => {
            listeners.push(listener);
            return { remove: () => undefined };
        });
        jest.doMock('react-native', () => ({
            Platform: { OS: os },
            NativeModules: { CypherStorefront: { countryCode: storefront, getCountryCode } },
            AppState: { addEventListener },
        }));
        jest.doMock('react-native-localize', () => ({
            getCountry: () => null,
            getLocales: () => [],
        }));
        const gate = require('../../src/services/featureFlags');
        const { watchStorefrontCountry } = require('../../src/services/storefrontWatch');
        let wakes = 0;
        gate.subscribeRegionGate(() => { wakes += 1; });
        void gate.refreshStorefrontCountry();
        const watch = () => watchStorefrontCountry(() => phone.locked);
        watch();
        return {
            gate,
            phone,
            getCountryCode,
            addEventListener,
            watch,
            wakes: () => wakes,
            appState: async (state: string) => {
                listeners.forEach(listener => listener(state));
                await jest.advanceTimersByTimeAsync(0);
            },
            wait: (ms: number) => jest.advanceTimersByTimeAsync(ms),
        };
    }

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('picks up a storefront that was empty at launch on a later retry', async () => {
        const app = launch();
        await app.wait(0);
        expect(app.getCountryCode).toHaveBeenCalledTimes(1);
        expect(app.gate.isStrikeAllowed()).toBe(false);

        await app.wait(1_000);
        expect(app.getCountryCode).toHaveBeenCalledTimes(2); // still empty

        app.phone.storefront = 'USA';
        await app.wait(2_999);
        expect(app.getCountryCode).toHaveBeenCalledTimes(2); // the next wait is 3 s
        await app.wait(1);
        expect(app.getCountryCode).toHaveBeenCalledTimes(3);
        expect(app.gate.isStrikeAllowed()).toBe(true);
        expect(app.wakes()).toBe(1);

        // It stops once the storefront answers.
        expect(jest.getTimerCount()).toBe(0);
        await app.wait(120_000);
        expect(app.getCountryCode).toHaveBeenCalledTimes(3);
    });

    it('picks up a storefront that was empty at launch on the return to the foreground', async () => {
        const app = launch();
        await app.wait(1_000 + 3_000 + 10_000 + 30_000);
        expect(app.getCountryCode).toHaveBeenCalledTimes(5); // the launch read and four retries
        expect(jest.getTimerCount()).toBe(0); // then it waits for the foreground
        expect(app.gate.isStrikeAllowed()).toBe(false);

        app.phone.storefront = 'USA';
        await app.appState('background');
        expect(app.getCountryCode).toHaveBeenCalledTimes(5);
        await app.appState('active');
        expect(app.getCountryCode).toHaveBeenCalledTimes(6);
        expect(app.gate.isStrikeAllowed()).toBe(true);
        expect(app.wakes()).toBe(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps at most one retry waiting, and a return to the foreground starts the waits over', async () => {
        const app = launch();
        await app.wait(1_000);
        expect(jest.getTimerCount()).toBe(1); // the 3 s wait

        await app.appState('active');
        await app.appState('inactive');
        await app.appState('active');
        expect(app.getCountryCode).toHaveBeenCalledTimes(4);
        expect(jest.getTimerCount()).toBe(1);

        await app.wait(1_000); // back to the 1 s wait
        expect(app.getCountryCode).toHaveBeenCalledTimes(5);
        expect(jest.getTimerCount()).toBe(1);
        expect(app.wakes()).toBe(0);
    });

    it('keeps one retry waiting when a foreground read overlaps a retry', async () => {
        const app = launch({ answerMs: 500 });
        await app.wait(1_000); // the retry's read is now waiting on StoreKit
        await app.wait(200);
        await app.appState('active'); // and so is this one
        await app.wait(600); // both have answered, still empty
        expect(app.getCountryCode).toHaveBeenCalledTimes(3);
        expect(jest.getTimerCount()).toBe(1);
    });

    it('drops the pending retry when a slow launch read answers', async () => {
        const app = launch({ answerMs: 500 });
        app.phone.storefront = 'USA';
        await app.wait(500);
        expect(app.gate.isStrikeAllowed()).toBe(true);
        expect(app.wakes()).toBe(1);
        await app.wait(60_000);
        expect(app.getCountryCode).toHaveBeenCalledTimes(1); // the retry found it answered
        expect(jest.getTimerCount()).toBe(0);
    });

    it('listens for the foreground once, however often it is started', () => {
        const app = launch();
        app.watch();
        app.watch();
        expect(app.addEventListener).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(1);
    });

    it('re-reads a known storefront in the foreground and wakes subscribers only when it changes', async () => {
        const app = launch({ storefront: 'USA' });
        await app.wait(0);
        expect(jest.getTimerCount()).toBe(0); // nothing to retry
        expect(app.gate.isStrikeAllowed()).toBe(true);

        await app.appState('active');
        expect(app.getCountryCode).toHaveBeenCalledTimes(2);
        expect(app.wakes()).toBe(0);

        app.phone.storefront = 'DEU';
        await app.appState('active');
        expect(app.gate.isStrikeAllowed()).toBe(false);
        expect(app.wakes()).toBe(1);
    });

    it('stops reading once the app becomes a seed-signer', async () => {
        const app = launch();
        await app.wait(0);
        app.phone.locked = true;
        app.phone.storefront = 'USA';
        await app.wait(60_000);
        await app.appState('active');
        expect(app.getCountryCode).toHaveBeenCalledTimes(1); // the launch read only
        expect(jest.getTimerCount()).toBe(0);
        expect(app.gate.isStrikeAllowed()).toBe(false);
    });

    it('does nothing on Android', async () => {
        const app = launch({ os: 'android' });
        await app.wait(60_000);
        expect(app.addEventListener).not.toHaveBeenCalled();
        expect(app.getCountryCode).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });
});
