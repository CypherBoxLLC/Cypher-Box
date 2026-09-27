/**
 * featureFlags: single source of truth for region gating.
 *
 * The gate that matters right now is CoinOS in the European Economic
 * Area. MiCA (Regulation (EU) 2023/1114) requires anyone providing
 * crypto-asset services to EEA clients to be authorised as a CASP, and
 * the transitional grandfathering ended 1 July 2026. CoinOS holds no
 * such authorisation, so its surfaces are hidden in EEA storefronts.
 *
 * Strike is NOT gated: Strike's European entity is an authorised CASP
 * and the integration is sign-in only against an account the user
 * opened with Strike directly. Ark and the Vaults are not gated either,
 * they are self-custodial and out of CASP scope.
 *
 * --- Platform ---------------------------------------------------------
 * There is deliberately no `Platform.OS` branch here. The previous
 * version of this gate exempted Android because the driver was Apple's
 * DSA-era approval terms. The driver now is MiCA itself, which binds us
 * and CoinOS regardless of which store the install came from.
 *
 * --- Dev / test bypass ------------------------------------------------
 * Geo-blocking is bypassed in `__DEV__` builds so testers can verify
 * multi-jurisdiction behaviour without a foreign SIM or a VPN. Release
 * builds run the real check.
 */

import * as RNLocalize from 'react-native-localize';

/**
 * EEA = the 27 EU member states plus Iceland, Norway and Liechtenstein.
 *
 * The earlier revision of this list covered the EU proper only, because
 * Apple's geo-block scope at the time followed the EU. MiCA applies
 * across the whole EEA, and App Review's September 2026 finding said
 * "European Economic Area", so the three EFTA states are included.
 *
 * Kept inline rather than pulling a country-list package: the set is
 * stable (any change to it is a political event, not a dependency
 * upgrade) and a 30-entry array is cheaper than another dep.
 */
const EEA_COUNTRIES = new Set<string>([
    // EU 27
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    // EFTA members of the EEA
    'IS', 'NO', 'LI',
]);

/**
 * Flip to `true` to hide CoinOS in every storefront rather than in the
 * EEA only. CoinOS holds no authorisation in any jurisdiction, so this
 * is the switch to reach for if App Review comes back on the non-EEA
 * half of guideline 3.1.5(iii), or if the rail is retired outright.
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
 * Returns null when the region genuinely cannot be determined, which
 * callers must treat as "assume restricted". See isEeaRegion().
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

/**
 * True when the device region is in the EEA, OR when the region cannot
 * be read at all.
 *
 * The unknown case fails CLOSED, which inverts what this file used to
 * do. The old code defaulted to 'US' so a bridge failure would never
 * gate a tester. That default is no longer acceptable: serving an
 * unauthorised CASP to an EEA user is a regulatory problem, while
 * hiding one rail from a user we cannot place is a support ticket.
 * `__DEV__` bypasses the whole check, so testers are unaffected.
 */
export function isEeaRegion(): boolean {
    const country = getDeviceCountry();
    if (!country) return true;
    return EEA_COUNTRIES.has(country);
}

/**
 * Returns true when CoinOS surfaces (login tile, home card actions,
 * send/topup/withdraw/cold-storage tiles, swap rail) should be shown.
 *
 * Gates VISIBILITY, not auth state. A user who connected CoinOS before
 * this build still has `isAuth === true` in the store; the entry points
 * are hidden and the home card goes read-only. Disconnect stays
 * reachable, and their balance is with CoinOS either way.
 */
export function isCoinosAllowed(): boolean {
    if (__DEV__) return true;
    if (COINOS_DISABLED_GLOBALLY) return false;
    return !isEeaRegion();
}
