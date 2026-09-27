/**
 * CoinOS region gate.
 *
 * This boolean is the whole of our MiCA position for the CoinOS rail,
 * so it gets a test rather than a code read. The cases that matter are
 * the two that changed in 0.1.12: the EFTA members of the EEA (Norway,
 * Iceland, Liechtenstein) are now blocked, where the previous EU-only
 * list let them through, and an unreadable region now fails CLOSED,
 * where the previous code defaulted to 'US' and let it through.
 */

const DEV_BEFORE = (global as any).__DEV__;

function loadGate(country: string | null, localeCountry?: string | null) {
    jest.resetModules();
    jest.doMock('react-native-localize', () => ({
        getCountry: () => {
            if (country === null) throw new Error('bridge unavailable');
            return country;
        },
        getLocales: () => {
            if (localeCountry === null || localeCountry === undefined) {
                throw new Error('bridge unavailable');
            }
            return [{ countryCode: localeCountry }];
        },
    }));
    return require('../../src/services/featureFlags');
}

afterEach(() => {
    (global as any).__DEV__ = DEV_BEFORE;
    jest.resetModules();
});

describe('isCoinosAllowed', () => {
    it('bypasses the gate in dev builds so testers are not geo-blocked', () => {
        (global as any).__DEV__ = true;
        expect(loadGate('DE').isCoinosAllowed()).toBe(true);
    });

    it('blocks EU member states in release builds', () => {
        (global as any).__DEV__ = false;
        for (const country of ['DE', 'FR', 'IE', 'MT', 'ES']) {
            expect(loadGate(country).isCoinosAllowed()).toBe(false);
        }
    });

    it('blocks the EFTA members of the EEA, which the EU-only list missed', () => {
        (global as any).__DEV__ = false;
        for (const country of ['NO', 'IS', 'LI']) {
            expect(loadGate(country).isCoinosAllowed()).toBe(false);
        }
    });

    it('allows non-EEA regions', () => {
        (global as any).__DEV__ = false;
        for (const country of ['US', 'GB', 'CH', 'CA', 'SV', 'NG']) {
            expect(loadGate(country).isCoinosAllowed()).toBe(true);
        }
    });

    it('is case-insensitive about the region code', () => {
        (global as any).__DEV__ = false;
        expect(loadGate('de').isCoinosAllowed()).toBe(false);
        expect(loadGate('us').isCoinosAllowed()).toBe(true);
    });

    it('falls back to the locale country when getCountry throws', () => {
        (global as any).__DEV__ = false;
        expect(loadGate(null, 'US').isCoinosAllowed()).toBe(true);
        expect(loadGate(null, 'DE').isCoinosAllowed()).toBe(false);
    });

    it('fails closed when the region cannot be read at all', () => {
        (global as any).__DEV__ = false;
        expect(loadGate(null, null).isCoinosAllowed()).toBe(false);
        expect(loadGate(null, null).isEeaRegion()).toBe(true);
    });
});
