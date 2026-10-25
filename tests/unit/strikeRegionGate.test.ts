/**
 * Strike region gate, and the storefront path of the CoinOS gate.
 *
 * Strike appears only in the countries on Strike's published list, never
 * in the EEA or the UK. On iOS the App Store storefront decides, with an
 * EEA or UK device region as an extra veto; Android has no storefront and
 * uses the device region. Both gates fail CLOSED when nothing can be read.
 */

export {};

const DEV_BEFORE = (global as any).__DEV__;

type Setup = {
    os: 'ios' | 'android';
    storefront?: string | null;      // module constant; undefined = module absent
    refreshed?: string | null;       // what getCountryCode() resolves to
    region?: string | null;          // device region; null = unreadable
};

function loadGate({ os, storefront, refreshed, region = null }: Setup) {
    jest.resetModules();
    const CypherStorefront = storefront === undefined
        ? undefined
        : { countryCode: storefront, getCountryCode: async () => refreshed ?? storefront };
    jest.doMock('react-native', () => ({
        Platform: { OS: os },
        NativeModules: { CypherStorefront },
    }));
    jest.doMock('react-native-localize', () => ({
        getCountry: () => {
            if (region === null) throw new Error('bridge unavailable');
            return region;
        },
        getLocales: () => {
            throw new Error('bridge unavailable');
        },
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

describe('isStrikeAllowed on iOS', () => {
    it('shows Strike when the storefront is on Strike\'s list', () => {
        for (const storefront of ['USA', 'SLV', 'ARG', 'NGA', 'ARE']) {
            expect(loadGate({ os: 'ios', storefront, region: 'US' }).isStrikeAllowed()).toBe(true);
        }
    });

    it('hides Strike in EEA and UK storefronts', () => {
        for (const storefront of ['DEU', 'FRA', 'NOR', 'GBR']) {
            expect(loadGate({ os: 'ios', storefront, region: 'US' }).isStrikeAllowed()).toBe(false);
        }
    });

    it('hides Strike where Strike does not operate', () => {
        for (const storefront of ['CAN', 'AUS', 'SAU', 'EGY', 'TUR', 'CHE', 'HUN']) {
            expect(loadGate({ os: 'ios', storefront, region: 'US' }).isStrikeAllowed()).toBe(false);
        }
    });

    it('lets an EEA or UK device region veto an allowed storefront', () => {
        expect(loadGate({ os: 'ios', storefront: 'USA', region: 'DE' }).isStrikeAllowed()).toBe(false);
        expect(loadGate({ os: 'ios', storefront: 'USA', region: 'GB' }).isStrikeAllowed()).toBe(false);
    });

    it('ignores a non-EEA device region when the storefront is allowed', () => {
        expect(loadGate({ os: 'ios', storefront: 'USA', region: 'CA' }).isStrikeAllowed()).toBe(true);
        expect(loadGate({ os: 'ios', storefront: 'USA', region: null }).isStrikeAllowed()).toBe(true);
    });

    it('fails closed with no storefront, whatever the region says', () => {
        expect(loadGate({ os: 'ios', storefront: null, region: 'US' }).isStrikeAllowed()).toBe(false);
        expect(loadGate({ os: 'ios', region: 'US' }).isStrikeAllowed()).toBe(false);
    });

    it('rejects malformed storefront codes', () => {
        expect(loadGate({ os: 'ios', storefront: 'US', region: 'US' }).isStrikeAllowed()).toBe(false);
        expect(loadGate({ os: 'ios', storefront: '', region: 'US' }).isStrikeAllowed()).toBe(false);
    });

    it('picks up a storefront that only becomes available after launch', async () => {
        const gate = loadGate({ os: 'ios', storefront: null, refreshed: 'USA', region: 'US' });
        expect(gate.isStrikeAllowed()).toBe(false);
        await gate.refreshStorefrontCountry();
        expect(gate.isStrikeAllowed()).toBe(true);
    });

    it('keeps the previous storefront when a refresh comes back empty', async () => {
        const gate = loadGate({ os: 'ios', storefront: 'USA', refreshed: null, region: 'US' });
        await gate.refreshStorefrontCountry();
        expect(gate.isStrikeAllowed()).toBe(true);
    });

    it('bypasses the gate in dev builds', () => {
        (global as any).__DEV__ = true;
        expect(loadGate({ os: 'ios', storefront: 'GBR', region: 'GB' }).isStrikeAllowed()).toBe(true);
    });
});

describe('isStrikeAllowed on Android', () => {
    it('follows the device region', () => {
        expect(loadGate({ os: 'android', region: 'US' }).isStrikeAllowed()).toBe(true);
        expect(loadGate({ os: 'android', region: 'sv' }).isStrikeAllowed()).toBe(true);
        expect(loadGate({ os: 'android', region: 'DE' }).isStrikeAllowed()).toBe(false);
        expect(loadGate({ os: 'android', region: 'GB' }).isStrikeAllowed()).toBe(false);
        expect(loadGate({ os: 'android', region: 'CA' }).isStrikeAllowed()).toBe(false);
    });

    it('never reads a storefront, even if one is present', () => {
        expect(loadGate({ os: 'android', storefront: 'USA', region: 'GB' }).isStrikeAllowed()).toBe(false);
    });

    it('fails closed when the region cannot be read', () => {
        expect(loadGate({ os: 'android', region: null }).isStrikeAllowed()).toBe(false);
    });
});

describe('isCoinosAllowed with a storefront', () => {
    it('hides CoinOS in EEA and UK storefronts even with a non-EEA region', () => {
        expect(loadGate({ os: 'ios', storefront: 'GBR', region: 'US' }).isCoinosAllowed()).toBe(false);
        expect(loadGate({ os: 'ios', storefront: 'DEU', region: 'US' }).isCoinosAllowed()).toBe(false);
    });

    it('hides CoinOS for an EEA or UK region even with an allowed storefront', () => {
        expect(loadGate({ os: 'ios', storefront: 'USA', region: 'GB' }).isCoinosAllowed()).toBe(false);
    });

    it('keeps CoinOS outside the EEA and the UK, including where Strike is absent', () => {
        for (const storefront of ['USA', 'CAN', 'SAU', 'EGY']) {
            expect(loadGate({ os: 'ios', storefront, region: null }).isCoinosAllowed()).toBe(true);
        }
    });

    it('fails closed when neither signal can be read', () => {
        expect(loadGate({ os: 'ios', storefront: null, region: null }).isCoinosAllowed()).toBe(false);
    });
});

describe('STRIKE_COUNTRIES', () => {
    it('never includes an EEA or UK country', () => {
        const { STRIKE_COUNTRIES } = loadGate({ os: 'ios' });
        const blocked = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
            'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
            'IS', 'NO', 'LI', 'GB'];
        for (const [a2] of STRIKE_COUNTRIES) {
            expect(blocked).not.toContain(a2);
        }
    });

    it('pairs every entry with well-formed, unique codes', () => {
        const { STRIKE_COUNTRIES } = loadGate({ os: 'ios' });
        const a2s = new Set<string>();
        const a3s = new Set<string>();
        for (const [a2, a3] of STRIKE_COUNTRIES) {
            expect(a2).toMatch(/^[A-Z]{2}$/);
            expect(a3).toMatch(/^[A-Z]{3}$/);
            a2s.add(a2);
            a3s.add(a3);
        }
        expect(a2s.size).toBe(STRIKE_COUNTRIES.length);
        expect(a3s.size).toBe(STRIKE_COUNTRIES.length);
    });
});
