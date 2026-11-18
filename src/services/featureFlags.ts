/**
 * featureFlags: single source of truth for region gating.
 *
 * Two gates live here.
 *
 * CoinOS is hidden in the European Economic Area and the United Kingdom.
 * MiCA (Regulation (EU) 2023/1114) requires anyone providing crypto-asset
 * services to EEA clients to be authorised as a CASP, and the
 * transitional grandfathering ended 1 July 2026. CoinOS holds no such
 * authorisation. The UK was added in 0.1.13.
 *
 * Strike is shown only in the countries Strike lists as supported, and
 * never in the EEA, the UK, India or South Korea. Strike lists all of
 * them; leaving them out is a product decision. Ark and the Vaults are
 * not gated, they are self-custodial.
 *
 * --- Signals ----------------------------------------------------------
 * On iOS the App Store storefront country decides: the Apple Account
 * country that App Store Availability also uses, read through the
 * CypherStorefront native module. The device region is checked as well,
 * and an EEA or UK region hides both rails even when the storefront says
 * otherwise.
 *
 * Android has no storefront to read. The CypherRegionSignals native
 * module reports what the phone knows instead: the SIM provider's
 * country, the country of the mobile network in reach (Android reports it
 * even with no SIM), Xiaomi's region setting, and the country of the first
 * language. The language counts only when none of the others is known, so
 * English (UK) on a Kenyan SIM and network is a phone in Kenya, while a
 * Wi-Fi-only tablet still has its language. Any country in the EEA or the
 * UK hides both rails, and Strike shows only when every country is a
 * Strike country. So a US visitor in Germany loses both rails while there,
 * and a phone in Germany set to English (United States) hides both. A
 * reading with neither a SIM nor a network country (airplane mode, no
 * coverage yet, an unreadable SIM) uses those of the last reading that had
 * one, across app restarts too, for up to 30 days. react-native-localize
 * is not used on Android: there it reads only Xiaomi's region and the
 * language, and answers "US" when neither names a country.
 *
 * --- Unknown country --------------------------------------------------
 * Every gate fails CLOSED: no storefront on iOS, or no signal at all on
 * Android, read now or remembered from an earlier run, hides both rails.
 * Serving a rail where it should not appear is a regulatory problem;
 * hiding one from a user we cannot place is a support ticket.
 *
 * --- Dev / test bypass ------------------------------------------------
 * Geo-blocking is bypassed in `__DEV__` builds so testers can verify
 * multi-jurisdiction behaviour without a foreign SIM or a VPN. Release
 * builds run the real check.
 */

import { AppState, NativeModules, Platform } from 'react-native';
import * as RNLocalize from 'react-native-localize';
import { MMKV } from 'react-native-mmkv';

/** ISO 3166-1 alpha-2 (device region) and alpha-3 (App Store storefront). */
type CountryCodes = readonly [alpha2: string, alpha3: string];

/**
 * EEA = the 27 EU member states plus Iceland, Norway and Liechtenstein.
 *
 * Kept inline rather than pulling a country-list package: the set is
 * stable (any change to it is a political event, not a dependency
 * upgrade) and a short table is cheaper than another dep.
 */
const EEA: readonly CountryCodes[] = [
    // EU 27
    ['AT', 'AUT'], ['BE', 'BEL'], ['BG', 'BGR'], ['HR', 'HRV'], ['CY', 'CYP'],
    ['CZ', 'CZE'], ['DK', 'DNK'], ['EE', 'EST'], ['FI', 'FIN'], ['FR', 'FRA'],
    ['DE', 'DEU'], ['GR', 'GRC'], ['HU', 'HUN'], ['IE', 'IRL'], ['IT', 'ITA'],
    ['LV', 'LVA'], ['LT', 'LTU'], ['LU', 'LUX'], ['MT', 'MLT'], ['NL', 'NLD'],
    ['PL', 'POL'], ['PT', 'PRT'], ['RO', 'ROU'], ['SK', 'SVK'], ['SI', 'SVN'],
    ['ES', 'ESP'], ['SE', 'SWE'],
    // EFTA members of the EEA
    ['IS', 'ISL'], ['NO', 'NOR'], ['LI', 'LIE'],
];

const UK: readonly CountryCodes[] = [['GB', 'GBR']];

/**
 * Strike's published list of supported countries
 * (https://strike.me/support/where-is-strike-available/, read 2026-10-18),
 * minus the EEA, the UK, India and South Korea. Puerto Rico is listed by
 * Strike as part of the United States. Re-read the page when Strike adds
 * or drops a country.
 */
export const STRIKE_COUNTRIES: readonly CountryCodes[] = [
    ['AG', 'ATG'], ['AR', 'ARG'], ['AZ', 'AZE'], ['BH', 'BHR'], ['BB', 'BRB'],
    ['BZ', 'BLZ'], ['BJ', 'BEN'], ['BT', 'BTN'], ['BA', 'BIH'], ['BR', 'BRA'],
    ['BN', 'BRN'], ['CL', 'CHL'], ['CO', 'COL'], ['CR', 'CRI'], ['DO', 'DOM'],
    ['EC', 'ECU'], ['SV', 'SLV'], ['GQ', 'GNQ'], ['FJ', 'FJI'], ['GA', 'GAB'],
    ['GM', 'GMB'], ['GE', 'GEO'], ['GH', 'GHA'], ['GT', 'GTM'], ['GN', 'GIN'],
    ['GY', 'GUY'], ['HN', 'HND'], ['CI', 'CIV'], ['KZ', 'KAZ'],
    ['KE', 'KEN'], ['LA', 'LAO'], ['LS', 'LSO'], ['MG', 'MDG'], ['MW', 'MWI'],
    ['MV', 'MDV'], ['MX', 'MEX'], ['MN', 'MNG'], ['ME', 'MNE'], ['MZ', 'MOZ'],
    ['NA', 'NAM'], ['NZ', 'NZL'], ['NI', 'NIC'], ['NG', 'NGA'], ['OM', 'OMN'],
    ['PA', 'PAN'], ['PG', 'PNG'], ['PY', 'PRY'], ['PE', 'PER'], ['PH', 'PHL'],
    ['RS', 'SRB'], ['SC', 'SYC'], ['SL', 'SLE'], ['ZA', 'ZAF'],
    ['LK', 'LKA'], ['TW', 'TWN'], ['TL', 'TLS'], ['TG', 'TGO'], ['TT', 'TTO'],
    ['UG', 'UGA'], ['AE', 'ARE'], ['US', 'USA'], ['PR', 'PRI'], ['UY', 'URY'],
    ['VU', 'VUT'], ['VN', 'VNM'], ['ZM', 'ZMB'], ['ZW', 'ZWE'],
];

const alpha2 = (list: readonly CountryCodes[]) => new Set(list.map(([a2]) => a2));
const alpha3 = (list: readonly CountryCodes[]) => new Set(list.map(([, a3]) => a3));

const EEA_ALPHA2 = alpha2(EEA);
const EEA_UK_ALPHA2 = alpha2([...EEA, ...UK]);
const EEA_UK_ALPHA3 = alpha3([...EEA, ...UK]);
const STRIKE_ALPHA2 = alpha2(STRIKE_COUNTRIES);
const STRIKE_ALPHA3 = alpha3(STRIKE_COUNTRIES);

/**
 * Flip to `true` to hide CoinOS in every storefront rather than in the
 * EEA and the UK only. CoinOS holds no authorisation in any
 * jurisdiction, so this is the switch to reach for if the rail is
 * retired outright.
 */
const COINOS_DISABLED_GLOBALLY = false;

/**
 * Best-effort ISO 3166-1 alpha-2 for the device region on iOS.
 *
 * On iOS `getCountry()` reads the Region setting. It is a setting rather
 * than an IP lookup, which is what we want: a German user travelling
 * through New York is still a German user, and no network round-trip can
 * be blocked, spoofed by a proxy, or fail offline.
 *
 * Not used on Android, where `getCountry()` reads only Xiaomi's region and
 * the language, and answers "US" when neither names a country; the Android
 * gates read getAndroidCountries() instead.
 *
 * Returns null when the region genuinely cannot be determined.
 */
function getDeviceCountry(): string | null {
    try {
        const country = RNLocalize.getCountry();
        if (country) return country.toUpperCase();
    } catch {
        // Native module failed to bridge. Fall through to locales.
    }
    try {
        const code = RNLocalize.getLocales()?.[0]?.countryCode;
        if (code) return code.toUpperCase();
    } catch {
        // Nothing left to read.
    }
    return null;
}

function normaliseAlpha2(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}

function normaliseAlpha3(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null;
}

/** undefined = not read yet; null = read, but no storefront available. */
let storefrontCountry: string | null | undefined;

/**
 * The phone's country signals on Android, as the CypherRegionSignals
 * native module reports them (CypherRegionSignalsModule.java). Each is an
 * ISO 3166-1 alpha-2 code, or null when the phone cannot tell.
 */
type AndroidSignals = {
    /** Country of the first language: "English (United States)" gives US. */
    language: string | null;
    /** Xiaomi's own region setting; null on other phones. */
    vendorRegion: string | null;
    /** Country of the SIM provider; null without a SIM. */
    sim: string | null;
    /** Country of the mobile network each modem is on or can see, SIM or not. */
    network: readonly string[];
};

/** undefined = not read yet. */
let androidSignals: AndroidSignals | undefined;
/** Every country androidSignals names, sorted; empty when none is known. */
let androidCountries: readonly string[] = [];
let watchingForeground = false;

/*
 * The SIM and network country of the last reading that had one, with the
 * time it was taken, kept across restarts in a small MMKV store of their
 * own. A later reading with neither (airplane mode, no coverage yet, an
 * unreadable SIM) uses them for up to 30 days, so a cold start still knows
 * where the phone was. Created on first use, and only on Android.
 * allowBackup="false" keeps the store out of cloud backups, but from
 * Android 12 a device-to-device transfer can still copy it to a new phone
 * (only dataExtractionRules could exclude it). The 30-day limit, and the
 * new phone's first SIM or network reading, end its use there.
 */
const REMEMBERED_STORE_ID = 'region-signals';
const REMEMBERED_KEY = 'last';
const REMEMBER_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/** undefined = not opened yet; null = MMKV unavailable. */
let rememberedStore: MMKV | null | undefined;
/** A reading's SIM and network country, and when it was taken (ms since 1970). */
type LastSeen = { sim: string | null; network: readonly string[]; at: number };
/** The last reading with a SIM or network country. undefined = store not read yet; null = none. */
let lastSeen: LastSeen | null | undefined;

/* --- Region-gate reactivity -------------------------------------------
 * isStrikeAllowed()/isCoinosAllowed() read their signals synchronously at
 * render: the storefront on iOS, the phone's country signals on Android.
 * The storefront can be unavailable for a moment after launch, so the
 * first read is null and refreshStorefrontCountry() fills it in shortly
 * after. On Android the network country can arrive after launch too, and
 * it changes when the phone crosses a border. The cached values are plain
 * module variables, so a component that already rendered with the first
 * answer would keep it until some unrelated re-render. These primitives
 * let a component subscribe (see the useRegionGate hook) and re-render
 * when a value actually changes. The gate functions themselves stay plain,
 * so non-React callers are unaffected. */
const regionGateListeners = new Set<() => void>();
let regionGateVersion = 0;

/** Subscribe to region-gate changes; returns an unsubscribe. */
export function subscribeRegionGate(listener: () => void): () => void {
    regionGateListeners.add(listener);
    return () => {
        regionGateListeners.delete(listener);
    };
}

/** Monotonic counter bumped on every gate change, for useSyncExternalStore. */
export function getRegionGateVersion(): number {
    return regionGateVersion;
}

function notifyRegionGateChanged(): void {
    regionGateVersion += 1;
    regionGateListeners.forEach(listener => {
        try {
            listener();
        } catch {
            // One bad listener must not stop the others from updating.
        }
    });
}

/** Test-only: clear the cached signals and every region-gate subscriber. */
export function __resetRegionGateForTest(): void {
    storefrontCountry = undefined;
    androidSignals = undefined;
    androidCountries = [];
    watchingForeground = false;
    rememberedStore = undefined;
    lastSeen = undefined;
    regionGateListeners.clear();
    regionGateVersion = 0;
}

/**
 * App Store storefront country (alpha-3) on iOS, null elsewhere or when
 * no storefront is available. The first call reads the native module's
 * constant so render-time checks stay synchronous;
 * refreshStorefrontCountry() updates it later.
 */
export function getStorefrontCountry(): string | null {
    if (Platform.OS !== 'ios') return null;
    if (storefrontCountry !== undefined) return storefrontCountry;
    try {
        const mod = NativeModules.CypherStorefront;
        storefrontCountry = normaliseAlpha3(mod?.countryCode ?? mod?.getConstants?.()?.countryCode);
    } catch {
        storefrontCountry = null;
    }
    return storefrontCountry;
}

/**
 * Re-reads the storefront from StoreKit; refreshRegionSignals() calls it
 * once at startup. The storefront can be unavailable for a moment after
 * launch, and the module constant is fixed for the module's lifetime. A
 * failed or empty read keeps the previous value. Does nothing on Android.
 */
export async function refreshStorefrontCountry(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    try {
        const next = normaliseAlpha3(await NativeModules.CypherStorefront?.getCountryCode?.());
        if (next !== null && next !== storefrontCountry) {
            storefrontCountry = next;
            // Wake any gated surface that already rendered with the first
            // (null) read so it re-evaluates with the real storefront.
            notifyRegionGateChanged();
        }
    } catch {
        // Keep whatever we had. The gates fail closed on null.
    }
}

function parseAndroidSignals(raw: unknown): AndroidSignals {
    const fields = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const network = Array.isArray(fields.network)
        ? fields.network.map(normaliseAlpha2).filter((code): code is string => code !== null)
        : [];
    return {
        language: normaliseAlpha2(fields.language),
        vendorRegion: normaliseAlpha2(fields.vendorRegion),
        sim: normaliseAlpha2(fields.sim),
        network: [...new Set(network)],
    };
}

function hasSimOrNetwork({ sim, network }: Pick<AndroidSignals, 'sim' | 'network'>): boolean {
    return sim !== null || network.length > 0;
}

function getRememberedStore(): MMKV | null {
    if (rememberedStore === undefined) {
        try {
            rememberedStore = new MMKV({ id: REMEMBERED_STORE_ID });
        } catch {
            rememberedStore = null;
        }
    }
    return rememberedStore;
}

/** The last reading with a SIM or network country: from this run, or from the store. */
function getLastSeen(): LastSeen | null {
    if (lastSeen === undefined) {
        lastSeen = null;
        try {
            const json = getRememberedStore()?.getString(REMEMBERED_KEY);
            const stored = json ? JSON.parse(json) : null;
            const { sim, network } = parseAndroidSignals(stored);
            const at = stored?.at;
            if (typeof at === 'number' && Number.isFinite(at) && hasSimOrNetwork({ sim, network })) {
                lastSeen = { sim, network, at };
            }
        } catch {
            // A damaged record counts as none.
        }
    }
    return lastSeen;
}

/** Keeps a reading's SIM and network country and its time; never the language. */
function rememberLastSeen(record: LastSeen): void {
    lastSeen = record;
    try {
        getRememberedStore()?.set(REMEMBERED_KEY, JSON.stringify(record));
    } catch {
        // Kept for this run only; the next reading tries again.
    }
}

/**
 * What the gates take from a fresh reading. One with a SIM or network
 * country stands on its own and is remembered, so a German SIM taken out
 * of a phone now on a US network no longer counts. One with neither
 * borrows the SIM and network country of the last reading that had one,
 * from this run or an earlier one, if it was taken within 30 days. The
 * language and Xiaomi region are settings and always come fresh.
 */
function withLastSeen(fresh: AndroidSignals): AndroidSignals {
    const now = Date.now();
    if (hasSimOrNetwork(fresh)) {
        rememberLastSeen({ sim: fresh.sim, network: fresh.network, at: now });
        return fresh;
    }
    const earlier = getLastSeen();
    if (earlier === null || Math.abs(now - earlier.at) > REMEMBER_FOR_MS) return fresh;
    return { ...fresh, sim: earlier.sim, network: earlier.network };
}

/**
 * Where the signals place the phone. The language counts only when no SIM,
 * network or Xiaomi region is known: English (UK) on a Kenyan SIM and
 * network is a phone in Kenya, while a Wi-Fi-only tablet has only its
 * language to go on.
 */
function setAndroidSignals(signals: AndroidSignals): void {
    androidSignals = signals;
    const placed = [signals.vendorRegion, signals.sim, ...signals.network]
        .filter((code): code is string => code !== null);
    const known = placed.length > 0 ? placed : [signals.language].filter((code): code is string => code !== null);
    androidCountries = [...new Set(known)].sort();
}

/**
 * Every country that places the phone, sorted; empty when none is known.
 * The first call reads the module's constants (falling back on what was
 * remembered, as withLastSeen() says), so render-time checks stay
 * synchronous; refreshRegionSignals() updates them later. A build without
 * the native module knows only what was remembered.
 */
function getAndroidCountries(): readonly string[] {
    if (androidSignals === undefined) {
        let raw: unknown;
        try {
            const mod = NativeModules.CypherRegionSignals;
            raw = typeof mod?.getConstants === 'function' ? mod.getConstants() : mod;
        } catch {
            raw = undefined;
        }
        setAndroidSignals(withLastSeen(parseAndroidSignals(raw)));
    }
    return androidCountries;
}

/** Re-reads the Android signals. A failed read keeps everything. */
async function refreshAndroidSignals(): Promise<void> {
    let next: AndroidSignals;
    try {
        next = parseAndroidSignals(await NativeModules.CypherRegionSignals?.getSignals?.());
    } catch {
        return;
    }
    const before = getAndroidCountries().join();
    setAndroidSignals(withLastSeen(next));
    if (androidCountries.join() !== before) notifyRegionGateChanged();
}

/**
 * Re-reads the region signals: the App Store storefront on iOS, the
 * phone's country signals on Android. Call once at startup. On Android it
 * also re-reads each time the app comes back to the foreground, since the
 * network country changes when the phone crosses a border.
 */
export async function refreshRegionSignals(): Promise<void> {
    if (Platform.OS === 'ios') return refreshStorefrontCountry();
    if (!watchingForeground) {
        watchingForeground = true;
        AppState?.addEventListener?.('change', state => {
            if (state === 'active') refreshAndroidSignals();
        });
    }
    return refreshAndroidSignals();
}

function inEeaOrUk(storefront: string | null, region: string | null): boolean {
    return (storefront !== null && EEA_UK_ALPHA3.has(storefront))
        || (region !== null && EEA_UK_ALPHA2.has(region));
}

/**
 * True when the device is placed in the EEA, OR when it cannot be placed
 * at all: the region on iOS, any country that places the phone on Android
 * (see setAndroidSignals). Kept for callers that only care about the EEA.
 */
export function isEeaRegion(): boolean {
    if (Platform.OS !== 'ios') {
        const countries = getAndroidCountries();
        return countries.length === 0 || countries.some(code => EEA_ALPHA2.has(code));
    }
    const country = getDeviceCountry();
    if (!country) return true;
    return EEA_ALPHA2.has(country);
}

/**
 * Returns true when CoinOS surfaces (login tile, home card actions,
 * send/topup/withdraw/cold-storage tiles, swap rail) should be shown.
 *
 * Gates VISIBILITY, not auth state. A user who connected CoinOS before
 * this build still has `isAuth === true` in the store; the entry points
 * are hidden and the home card goes read-only. Their balance is with
 * CoinOS either way.
 */
export function isCoinosAllowed(): boolean {
    if (__DEV__) return true;
    if (COINOS_DISABLED_GLOBALLY) return false;
    if (Platform.OS !== 'ios') {
        // Any EEA or UK country hides CoinOS; none at all fails closed.
        const countries = getAndroidCountries();
        return countries.length > 0 && !countries.some(code => EEA_UK_ALPHA2.has(code));
    }
    const storefront = getStorefrontCountry();
    const region = getDeviceCountry();
    if (storefront === null && region === null) return false;
    return !inEeaOrUk(storefront, region);
}

/**
 * Returns true when Strike surfaces (sign-in and sign-up, home card
 * actions, buy and sell, send/topup/withdraw/cold-storage tiles, swap
 * rail, exit funding) should be shown.
 *
 * Same visibility-only contract as isCoinosAllowed(): a user who
 * connected Strike before this build keeps a read-only card with their
 * balance until the Strike session expires.
 */
export function isStrikeAllowed(): boolean {
    if (__DEV__) return true;
    if (Platform.OS !== 'ios') {
        // STRIKE_COUNTRIES leaves out the EEA, the UK, India and South
        // Korea, so any of them among the countries hides Strike.
        const countries = getAndroidCountries();
        return countries.length > 0 && countries.every(code => STRIKE_ALPHA2.has(code));
    }
    const storefront = getStorefrontCountry();
    if (storefront === null || !STRIKE_ALPHA3.has(storefront)) return false;
    const region = getDeviceCountry();
    return !(region !== null && EEA_UK_ALPHA2.has(region));
}
