/**
 * Android region gate.
 *
 * Android has no App Store storefront, so the gates combine the country
 * signals the CypherRegionSignals native module reads from the phone: the
 * SIM provider's country, the mobile network country (reported even with
 * no SIM), Xiaomi's region setting and the first language's country. The
 * language counts only when none of the others is known. CoinOS hides when
 * any country is in the EEA or the UK. Strike shows only when every one is
 * on Strike's list. With nothing known, including a build without the
 * native module, both rails hide.
 *
 * react-native-localize is mocked to answer "US" throughout, as it does on
 * Android when the language names no country: the Android gates must not
 * listen to it.
 *
 * The SIM and network country of the last reading that had one are
 * remembered in MMKV with the time it was taken, and used for up to 30
 * days by a reading with neither. Each loadGate() call is a fresh app
 * start; `disk` stands in for MMKV's files and survives between them
 * within a test.
 */

export {};

const DEV_BEFORE = (global as any).__DEV__;

/** MMKV's files: store id -> key -> value. Cleared before every test. */
const disk = new Map<string, Map<string, string>>();

type Signals = { language?: unknown; vendorRegion?: unknown; sim?: unknown; network?: unknown };

type Options = {
    os?: 'ios' | 'android';
    storefront?: string;
    localize?: string;
};

/**
 * Loads featureFlags against a fake phone. `constants` is what the native
 * module reports when JS first touches it (null = module missing);
 * getSignals() answers with `phone.now`, which a test can change.
 */
function loadGate(constants: Signals | null, { os = 'android', storefront, localize = 'US' }: Options = {}) {
    jest.resetModules();
    const phone: { now: Signals | Error } = { now: constants ?? {} };
    const getSignals = jest.fn(async () => {
        if (phone.now instanceof Error) throw phone.now;
        return phone.now;
    });
    const getCountryCode = jest.fn(async () => storefront ?? null);
    const appStateListeners: Array<(state: string) => void> = [];
    jest.doMock('react-native', () => ({
        Platform: { OS: os },
        NativeModules: {
            CypherRegionSignals: constants === null ? undefined : { getConstants: () => constants, getSignals },
            CypherStorefront: storefront === undefined ? undefined : { countryCode: storefront, getCountryCode },
        },
        AppState: {
            addEventListener: (_type: string, listener: (state: string) => void) => {
                appStateListeners.push(listener);
                return { remove: () => undefined };
            },
        },
    }));
    jest.doMock('react-native-localize', () => ({
        getCountry: () => localize,
        getLocales: () => [{ countryCode: localize }],
    }));
    jest.doMock('react-native-mmkv', () => ({
        MMKV: class {
            private readonly files: Map<string, string>;

            constructor({ id }: { id: string }) {
                if (!disk.has(id)) disk.set(id, new Map());
                this.files = disk.get(id) as Map<string, string>;
            }

            getString(key: string) { return this.files.get(key); }

            set(key: string, value: string) { this.files.set(key, value); }
        },
    }));
    const gate = require('../../src/services/featureFlags');
    return {
        gate,
        phone,
        getSignals,
        getCountryCode,
        appStateListeners,
        shows: () => ({ strike: gate.isStrikeAllowed(), coinos: gate.isCoinosAllowed() }),
        appState: (state: string) => appStateListeners.forEach(listener => listener(state)),
    };
}

/** Lets a refresh that nobody awaits (the foreground listener's) finish. */
const settle = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
    (global as any).__DEV__ = false;
    disk.clear();
});

afterEach(() => {
    (global as any).__DEV__ = DEV_BEFORE;
    jest.restoreAllMocks();
    jest.resetModules();
});

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sets the clock the gate reads (Date.now). */
const setNow = (ms: number) => jest.spyOn(Date, 'now').mockReturnValue(ms);
const NOV_1 = Date.UTC(2026, 10, 1);

describe('Android region gate: signal combinations', () => {
    const BOTH = { strike: true, coinos: true };
    const NEITHER = { strike: false, coinos: false };
    const COINOS_ONLY = { strike: false, coinos: true };

    it.each([
        // The Galaxy A14 in Germany: no SIM, English (United States), on a German network.
        ['no SIM, English (US), German network', { language: 'US', sim: null, network: ['de'] }, NEITHER],
        ['US language, SIM and network', { language: 'US', sim: 'us', network: ['us'] }, BOTH],
        ['US language only (Wi-Fi tablet)', { language: 'US', sim: null, network: [] }, BOTH],
        ['US SIM only, language without a country', { language: null, sim: 'us', network: [] }, BOTH],
        ['network only, on Strike\'s list', { network: ['ng'] }, BOTH],
        ['Mexico throughout', { language: 'MX', sim: 'mx', network: ['mx'] }, BOTH],
        ['German SIM, English (US) language', { language: 'US', sim: 'de', network: ['de'] }, NEITHER],
        ['German SIM roaming in the US', { language: 'US', sim: 'de', network: ['us'] }, NEITHER],
        ['US SIM roaming in Germany', { language: 'US', sim: 'us', network: ['de'] }, NEITHER],
        ['German language on a US SIM and network', { language: 'DE', sim: 'us', network: ['us'] }, BOTH],
        ['English (UK) on a Kenyan SIM and network', { language: 'GB', sim: 'ke', network: ['ke'] }, BOTH],
        ['English (UK) on a Nigerian SIM and network', { language: 'GB', sim: 'ng', network: ['ng'] }, BOTH],
        ['French (France) in Benin', { language: 'FR', sim: 'bj', network: ['bj'] }, BOTH],
        ['Portuguese (Portugal) in Mozambique', { language: 'PT', sim: 'mz', network: ['mz'] }, BOTH],
        ['Spanish (Spain) in Mexico', { language: 'ES', sim: 'mx', network: ['mx'] }, BOTH],
        ['Arabic (Egypt) on a UAE SIM and network', { language: 'EG', sim: 'ae', network: ['ae'] }, BOTH],
        ['Arabic (Saudi Arabia) on a UAE SIM in airplane mode', { language: 'SA', sim: 'ae', network: [] }, BOTH],
        ['English (UK) on a Wi-Fi-only tablet', { language: 'GB', sim: null, network: [] }, NEITHER],
        ['German language, Xiaomi region US, nothing else', { language: 'DE', vendorRegion: 'US' }, BOTH],
        ['English (US), Xiaomi region Germany, nothing else', { language: 'US', vendorRegion: 'DE' }, NEITHER],
        ['UK SIM and network', { language: 'US', sim: 'gb', network: ['gb'] }, NEITHER],
        ['Norwegian network (EFTA member of the EEA)', { language: 'US', sim: 'us', network: ['no'] }, NEITHER],
        ['network only, in the EEA', { network: ['fr'] }, NEITHER],
        ['dual modem seeing the US and Germany', { language: 'US', sim: 'us', network: ['us', 'de'] }, NEITHER],
        ['Xiaomi region Germany, US otherwise', { language: 'US', vendorRegion: 'DE', sim: 'us', network: ['us'] }, NEITHER],
        ['Xiaomi region US, US otherwise', { language: 'US', vendorRegion: 'US', sim: 'us', network: ['us'] }, BOTH],
        ['Canadian SIM, English (US)', { language: 'US', sim: 'ca', network: ['ca'] }, COINOS_ONLY],
        ['US SIM roaming in Canada', { language: 'US', sim: 'us', network: ['ca'] }, COINOS_ONLY],
        ['Egyptian SIM, English (US)', { language: 'US', sim: 'eg', network: ['eg'] }, COINOS_ONLY],
        ['India, which Strike lists but we leave out', { language: 'IN', sim: 'in', network: ['in'] }, COINOS_ONLY],
        ['South Korea, which Strike lists but we leave out', { language: 'KR', sim: 'kr', network: ['kr'] }, COINOS_ONLY],
    ])('%s', (_name, signals, expected) => {
        expect(loadGate(signals).shows()).toEqual(expected);
    });

    it('fails closed when the language names no country and nothing else is known', () => {
        // react-native-localize says "US" here; the gate must not take it.
        expect(loadGate({ language: null, vendorRegion: null, sim: null, network: [] }).shows()).toEqual(NEITHER);
        expect(loadGate({}).shows()).toEqual(NEITHER);
    });

    it('fails closed on a build without the native module', () => {
        expect(loadGate(null).shows()).toEqual(NEITHER);
        expect(loadGate(null, { localize: 'MX' }).shows()).toEqual(NEITHER);
    });

    it('treats malformed codes as unknown', () => {
        const malformed = { language: '419', vendorRegion: 'GLOBAL', sim: '', network: ['', 'DEU', 7, null] };
        expect(loadGate(malformed).shows()).toEqual(NEITHER);
        expect(loadGate({ ...malformed, sim: 'us' }).shows()).toEqual(BOTH);
        expect(loadGate({ language: 'US', network: 'de' }).shows()).toEqual(BOTH); // not an array
    });

    it('accepts upper- and lower-case codes alike', () => {
        expect(loadGate({ sim: 'GB' }).shows()).toEqual(NEITHER);
        expect(loadGate({ sim: 'gb' }).shows()).toEqual(NEITHER);
        expect(loadGate({ sim: 'Us', network: ['uS'] }).shows()).toEqual(BOTH);
    });

    it('never reads a storefront on Android, even if one is present', () => {
        expect(loadGate({ language: 'GB' }, { storefront: 'USA' }).shows()).toEqual(NEITHER);
        expect(loadGate({ language: 'US' }, { storefront: 'GBR' }).shows()).toEqual(BOTH);
    });

    it('ignores the Android signals on iOS', () => {
        const { shows, getSignals } = loadGate({ network: ['de'] }, { os: 'ios', storefront: 'USA', localize: 'US' });
        expect(shows()).toEqual(BOTH);
        expect(getSignals).not.toHaveBeenCalled();
    });

    it('bypasses the gate in dev builds', () => {
        (global as any).__DEV__ = true;
        expect(loadGate({ language: 'US', sim: null, network: ['de'] }).shows()).toEqual(BOTH);
        expect(loadGate(null).shows()).toEqual(BOTH);
    });
});

describe('isEeaRegion on Android', () => {
    it('is true when any country that places the phone is in the EEA', () => {
        expect(loadGate({ language: 'US', sim: null, network: ['de'] }).gate.isEeaRegion()).toBe(true);
        expect(loadGate({ language: 'US', vendorRegion: 'NO' }).gate.isEeaRegion()).toBe(true);
    });

    it('takes the language only when nothing else places the phone', () => {
        expect(loadGate({ language: 'DE', sim: 'us', network: ['us'] }).gate.isEeaRegion()).toBe(false);
        disk.clear();
        expect(loadGate({ language: 'DE', sim: null, network: [] }).gate.isEeaRegion()).toBe(true);
    });

    it('is false when every signal is outside the EEA', () => {
        expect(loadGate({ language: 'US', sim: 'us', network: ['us'] }).gate.isEeaRegion()).toBe(false);
        // The UK left the EEA; isEeaRegion() asks only about the EEA.
        expect(loadGate({ sim: 'gb' }).gate.isEeaRegion()).toBe(false);
    });

    it('is true when nothing is known', () => {
        expect(loadGate({}).gate.isEeaRegion()).toBe(true);
        expect(loadGate(null).gate.isEeaRegion()).toBe(true);
    });
});

describe('refreshing the Android signals', () => {
    it('picks up a network country that arrives after launch and wakes subscribers', async () => {
        const { gate, phone, shows } = loadGate({ language: 'US', sim: null, network: [] });
        let calls = 0;
        gate.subscribeRegionGate(() => { calls += 1; });
        expect(shows()).toEqual({ strike: true, coinos: true });

        phone.now = { language: 'US', sim: null, network: ['de'] };
        await gate.refreshRegionSignals();
        expect(shows()).toEqual({ strike: false, coinos: false });
        expect(calls).toBe(1);
        expect(gate.getRegionGateVersion()).toBe(1);
    });

    it('does not wake subscribers when the countries are unchanged', async () => {
        const { gate, phone } = loadGate({ language: 'US', sim: 'us', network: [] });
        let calls = 0;
        gate.subscribeRegionGate(() => { calls += 1; });
        phone.now = { language: 'US', sim: 'us', network: ['us'] }; // more signals, same country
        await gate.refreshRegionSignals();
        await gate.refreshRegionSignals();
        expect(calls).toBe(0);
        expect(gate.getRegionGateVersion()).toBe(0);
    });

    it('keeps a network country that drops out, such as in airplane mode', async () => {
        const { gate, phone, shows } = loadGate({ language: 'US', sim: null, network: ['de'] });
        phone.now = { language: 'US', sim: null, network: [] };
        await gate.refreshRegionSignals();
        expect(shows()).toEqual({ strike: false, coinos: false });
        expect(gate.getRegionGateVersion()).toBe(0);
    });

    it('keeps the last SIM country while the phone reads neither a SIM nor a network', async () => {
        const { gate, phone, shows } = loadGate({ language: 'US', sim: 'gb', network: [] });
        phone.now = { language: 'US', sim: null, network: [] };
        await gate.refreshRegionSignals();
        expect(shows()).toEqual({ strike: false, coinos: false });
    });

    it('drops a SIM country that is gone once the phone reads a network', async () => {
        // A German SIM taken out of a phone now on a US network.
        const { gate, phone, shows } = loadGate({ language: 'US', sim: 'de', network: ['de'] });
        expect(shows()).toEqual({ strike: false, coinos: false });
        phone.now = { language: 'US', sim: null, network: ['us'] };
        await gate.refreshRegionSignals();
        expect(shows()).toEqual({ strike: true, coinos: true });
        expect(gate.getRegionGateVersion()).toBe(1);
    });

    it('replaces a network country when the phone sees a new one', async () => {
        const { gate, phone, shows } = loadGate({ language: 'US', sim: 'us', network: ['de'] });
        expect(shows()).toEqual({ strike: false, coinos: false });
        phone.now = { language: 'US', sim: 'us', network: ['us'] };
        await gate.refreshRegionSignals();
        expect(shows()).toEqual({ strike: true, coinos: true });
        expect(gate.getRegionGateVersion()).toBe(1);
    });

    it('takes a new language country, which is a setting the user changed', async () => {
        // A Wi-Fi-only tablet, which has only its language.
        const { gate, phone, shows } = loadGate({ language: 'DE', sim: null, network: [] });
        expect(shows()).toEqual({ strike: false, coinos: false });
        phone.now = { language: 'US', sim: null, network: [] };
        await gate.refreshRegionSignals();
        expect(shows()).toEqual({ strike: true, coinos: true });
    });

    it('keeps everything when a refresh fails', async () => {
        const { gate, phone, shows } = loadGate({ language: 'US', sim: null, network: ['de'] });
        phone.now = new Error('native read failed');
        await expect(gate.refreshRegionSignals()).resolves.toBeUndefined();
        expect(shows()).toEqual({ strike: false, coinos: false });
        expect(gate.getRegionGateVersion()).toBe(0);
    });

    it('stays closed when a build without the native module refreshes', async () => {
        const { gate, shows } = loadGate(null);
        await gate.refreshRegionSignals();
        expect(shows()).toEqual({ strike: false, coinos: false });
    });

    it('re-reads each time the app returns to the foreground', async () => {
        const { gate, phone, getSignals, shows, appState, appStateListeners } = loadGate({ language: 'US', sim: 'us', network: ['us'] });
        await gate.refreshRegionSignals();
        await gate.refreshRegionSignals();
        expect(appStateListeners).toHaveLength(1); // registered once
        expect(getSignals).toHaveBeenCalledTimes(2);

        phone.now = { language: 'US', sim: 'us', network: ['de'] };
        appState('background');
        await settle();
        expect(getSignals).toHaveBeenCalledTimes(2);
        expect(shows()).toEqual({ strike: true, coinos: true });

        appState('active');
        await settle();
        expect(getSignals).toHaveBeenCalledTimes(3);
        expect(shows()).toEqual({ strike: false, coinos: false });
    });

    it('reads the storefront, not the Android signals, on iOS', async () => {
        const { gate, getSignals, getCountryCode, appStateListeners } = loadGate({ network: ['de'] }, { os: 'ios', storefront: 'USA' });
        await gate.refreshRegionSignals();
        expect(getCountryCode).toHaveBeenCalledTimes(1);
        expect(getSignals).not.toHaveBeenCalled();
        expect(appStateListeners).toHaveLength(0);
    });
});

describe('remembering the SIM and network country across restarts', () => {
    const BOTH = { strike: true, coinos: true };
    const NEITHER = { strike: false, coinos: false };
    const remembered = () => disk.get('region-signals')?.get('last');

    it('keeps both hidden on an airplane-mode start after the phone saw a German network', () => {
        // The A14: a run on the German network, then a fresh start in airplane mode.
        expect(loadGate({ language: 'US', sim: null, network: ['de'] }).shows()).toEqual(NEITHER);
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(NEITHER);
    });

    it('has only the language on the very first start, before anything is remembered', () => {
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
    });

    it('remembers the SIM country for a start that cannot read the SIM', () => {
        expect(loadGate({ language: 'US', sim: 'gb', network: ['gb'] }).shows()).toEqual(NEITHER);
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(NEITHER);
    });

    it('replaces the remembered country when the phone reads a new one', () => {
        loadGate({ language: 'US', sim: null, network: ['de'] }).shows();
        expect(loadGate({ language: 'US', sim: 'us', network: ['us'] }).shows()).toEqual(BOTH);
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
    });

    it('remembers what a refresh reads, for the next start', async () => {
        const { gate, phone } = loadGate({ language: 'US', sim: null, network: [] });
        phone.now = { language: 'US', sim: null, network: ['fr'] };
        await gate.refreshRegionSignals();
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(NEITHER);
    });

    it('stores the SIM and network country and when they were read, never the language', () => {
        setNow(NOV_1);
        expect(loadGate({ language: 'DE', sim: 'us', network: ['us'] }).shows()).toEqual(BOTH);
        expect(JSON.parse(remembered() ?? 'null')).toEqual({ sim: 'US', network: ['US'], at: NOV_1 });
    });

    it('does not let a remembered SIM country outlive a fresh network reading', () => {
        // A German SIM taken out after moving; the phone now runs on a US network.
        expect(loadGate({ language: 'US', sim: 'de', network: ['de'] }).shows()).toEqual(NEITHER);
        expect(loadGate({ language: 'US', sim: null, network: ['us'] }).shows()).toEqual(BOTH);
        // And the next airplane-mode start remembers the US, not Germany.
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
    });

    it('does not let a remembered network country outlive a fresh SIM reading', () => {
        // Back from Germany, airplane mode on, the US SIM still readable.
        expect(loadGate({ language: 'US', sim: 'us', network: ['de'] }).shows()).toEqual(NEITHER);
        expect(loadGate({ language: 'US', sim: 'us', network: [] }).shows()).toEqual(BOTH);
    });

    it('forgets a remembered country after 30 days', () => {
        setNow(NOV_1);
        loadGate({ language: 'US', sim: null, network: ['de'] }).shows();
        setNow(NOV_1 + 29 * DAY_MS);
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(NEITHER);
        setNow(NOV_1 + 31 * DAY_MS);
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
    });

    it('counts the 30 days from the last time the phone read the country', () => {
        setNow(NOV_1);
        loadGate({ language: 'US', sim: null, network: ['de'] }).shows();
        setNow(NOV_1 + 20 * DAY_MS);
        loadGate({ language: 'US', sim: null, network: ['de'] }).shows();
        setNow(NOV_1 + 45 * DAY_MS);
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(NEITHER);
    });

    it('ignores a record without a time, or dated more than 30 days ahead', () => {
        setNow(NOV_1);
        disk.set('region-signals', new Map([['last', JSON.stringify({ sim: 'DE', network: ['DE'] })]]));
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
        disk.set('region-signals', new Map([['last', JSON.stringify({ sim: 'DE', network: ['DE'], at: NOV_1 + 40 * DAY_MS })]]));
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
        disk.set('region-signals', new Map([['last', JSON.stringify({ sim: 'DE', network: ['DE'], at: NOV_1 + 2 * DAY_MS })]]));
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(NEITHER);
    });

    it('writes nothing while no SIM or network country has been seen', () => {
        loadGate({ language: 'US', sim: null, network: [] }).shows();
        expect(remembered()).toBeUndefined();
    });

    it('ignores a damaged remembered record', () => {
        disk.set('region-signals', new Map([['last', 'not json']]));
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
        disk.set('region-signals', new Map([['last', JSON.stringify({ sim: 'DEU', network: ['', 7], at: Date.now() })]]));
        expect(loadGate({ language: 'US', sim: null, network: [] }).shows()).toEqual(BOTH);
    });

    it('never opens the store on iOS', () => {
        loadGate({ network: ['de'] }, { os: 'ios', storefront: 'USA' }).shows();
        expect(disk.has('region-signals')).toBe(false);
    });
});
