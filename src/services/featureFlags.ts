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
 * otherwise. Android has no storefront to read, so the device region
 * decides there. The rule is the same on both platforms; only the signal
 * differs.
 *
 * --- Unknown country --------------------------------------------------
 * Every gate fails CLOSED. Serving a rail where it should not appear is
 * a regulatory problem; hiding one from a user we cannot place is a
 * support ticket.
 *
 * --- Dev / test bypass ------------------------------------------------
 * Geo-blocking is bypassed in `__DEV__` builds so testers can verify
 * multi-jurisdiction behaviour without a foreign SIM or a VPN. Release
 * builds run the real check.
 */

import { NativeModules, Platform } from 'react-native';
import * as RNLocalize from 'react-native-localize';

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
 * Best-effort ISO 3166-1 alpha-2 for the device.
 *
 * `getCountry()` reads the device region setting on iOS and the
 * SIM/locale on Android. It is the account-region signal rather than an
 * IP lookup, which is what we want: a German user travelling through
 * New York is still a German user, and no network round-trip can be
 * blocked, spoofed by a proxy, or fail offline.
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

function normaliseAlpha3(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null;
}

/** undefined = not read yet; null = read, but no storefront available. */
let storefrontCountry: string | null | undefined;

/**
 * App Store storefront country (alpha-3) on iOS, null elsewhere or when
 * no storefront is available. The first call reads the native module's
 * constant so render-time checks stay synchronous;
 * refreshStorefrontCountry() updates it later.
 */
// QA-ONLY 0.1.13 device test. Do not commit. Set to 'GBR', 'DEU', ... to fake the storefront.
const QA_STOREFRONT_OVERRIDE: string | null | undefined = undefined;

function getStorefrontCountry(): string | null {
    if (Platform.OS !== 'ios') return null;
    if (QA_STOREFRONT_OVERRIDE !== undefined) return QA_STOREFRONT_OVERRIDE; // QA-ONLY
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
 * Re-reads the storefront from StoreKit. Call once at startup: the
 * storefront can be unavailable for a moment after launch, and the
 * module constant is fixed for the module's lifetime. A failed or empty
 * read keeps the previous value.
 */
export async function refreshStorefrontCountry(): Promise<void> {
    // QA-ONLY 0.1.13 device test. Do not commit.
    const qaLog = (stage: string) => console.log('[QA region]', stage, JSON.stringify({
        constant: NativeModules.CypherStorefront?.countryCode ?? null,
        cached: storefrontCountry, override: QA_STOREFRONT_OVERRIDE,
        region: getDeviceCountry(), strike: isStrikeAllowed(), coinos: isCoinosAllowed(),
    }));
    qaLog('before');
    if (Platform.OS !== 'ios') return;
    try {
        const next = normaliseAlpha3(await NativeModules.CypherStorefront?.getCountryCode?.());
        console.log('[QA region] getCountryCode ->', next); // QA-ONLY
        if (next !== null) storefrontCountry = next;
    } catch {
        // Keep whatever we had. The gates fail closed on null.
    }
    qaLog('after'); // QA-ONLY
}

function inEeaOrUk(storefront: string | null, region: string | null): boolean {
    return (storefront !== null && EEA_UK_ALPHA3.has(storefront))
        || (region !== null && EEA_UK_ALPHA2.has(region));
}

/**
 * True when the device region is in the EEA, OR when the region cannot
 * be read at all. Kept for callers that only care about the EEA.
 */
export function isEeaRegion(): boolean {
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
    // QA-ONLY: __DEV__ bypass removed for the 0.1.13 device test. Restore before commit.
    if (COINOS_DISABLED_GLOBALLY) return false;
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
    // QA-ONLY: __DEV__ bypass removed for the 0.1.13 device test. Restore before commit.
    const region = getDeviceCountry();
    if (Platform.OS === 'ios') {
        const storefront = getStorefrontCountry();
        if (storefront === null || !STRIKE_ALPHA3.has(storefront)) return false;
        return !(region !== null && EEA_UK_ALPHA2.has(region));
    }
    return region !== null && STRIKE_ALPHA2.has(region);
}
