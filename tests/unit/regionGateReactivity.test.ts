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
