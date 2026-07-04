/**
 * featureFlags — single source of truth for region/platform gating.
 *
 * Right now the only gate we enforce is for CoinOS on iOS in the EU,
 * because Apple's DSA-driven approval terms require us to ship without
 * non-custodial fiat-onramp paths in those storefronts. The CoinOS UI
 * (account connect, source/destination tiles in send/topup/withdraw
 * popups, capsule-tab top-up CTA) is hidden in that combination.
 *
 * Other wallets — Strike, Ark — are not gated.
 *
 * --- Dev / test bypass -----------------------------------------------
 * Geo-blocking is bypassed in `__DEV__` builds. That means a Metro
 * dev build always shows every wallet regardless of the device's
 * region — testers can verify multi-jurisdiction behaviour without
 * needing a non-EU SIM or VPN. Release builds run the real check.
 * If you ever need a release-build override, drop a settings toggle
 * that maps to `__forceEnableCoinos` and OR it into the result here.
 */

import { Platform } from 'react-native';
import * as RNLocalize from 'react-native-localize';

// 27 EU member states, ISO 3166-1 alpha-2. Kept inline rather than
// pulling a country-list package — the set is stable (any change is a
// political event, not a code change), and a 27-entry array is cheaper
// than another dep. Iceland / Norway / Switzerland / Liechtenstein
// (EEA / EFTA) are NOT in the list because Apple's geo-block scope
// follows the EU proper, not the EEA. Add them here if Apple's terms
// extend.
const EU_COUNTRIES = new Set<string>([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * `getCountry()` returns the device's region setting (e.g. 'US', 'DE')
 * derived from the system locale on iOS and the SIM/locale on Android.
 * It's a best-effort signal: a US user travelling through Berlin with
 * their phone still on US locale reads 'US' here, which we want — Apple
 * reviewers care about the *account region*, not the IP country. The
 * library is synchronous and cached, so calling per render is fine.
 */
function getDeviceCountry(): string {
    try {
        return RNLocalize.getCountry();
    } catch {
        // Defensive: if the native module ever fails to bridge (e.g.
        // brand-new install before locale resolves), default to a
        // non-EU value so testers don't accidentally hit the gate.
        // Production never sees this path.
        return 'US';
    }
}

/**
 * Returns true when the CoinOS UI surfaces (connect button, tiles in
 * Send/Topup/Withdraw lists, CoinOS history rail) should be visible.
 *
 * Currently returns `true` everywhere — Bam's intermediate plan: ship
 * archive/TestFlight builds with both CoinOS and Ark visible so the
 * full custodial-vs-non-custodial Lightning matrix can be tested, then
 * flip to "Strike + Ark only" for the actual App Store production
 * release. The geo-gating logic (EU iOS-only, dev bypass, country list)
 * is kept commented below as the canonical reference for when we wire
 * the production behavior back in.
 *
 * Production switch (when ready):
 *   - To hide CoinOS in production: change this to `return __DEV__;`.
 *     That keeps it reachable for local testing but cuts the surface
 *     out of every release build.
 *   - To restore the original EU-only iOS gate, uncomment the body
 *     below. Apple's DSA-driven approval terms required hiding CoinOS
 *     on iOS in EU storefronts, so the country-list logic is still
 *     correct if a future release re-enables CoinOS for non-EU users.
 *
 * Note: this gates *visibility*, not auth state. A user who authed
 * CoinOS earlier and is now on a hidden-CoinOS build will still have
 * `isAuth=true` in the store; the surfaces will just hide the entry
 * points. Sign-out remains accessible.
 */
export function isCoinosAllowed(): boolean {
    // Test/intermediate phase — show CoinOS everywhere.
    return true;

    // --- Original production gate (preserved for re-enable) ---------
    // if (__DEV__) return true;
    // if (Platform.OS === 'android') return true;
    // return !EU_COUNTRIES.has(getDeviceCountry());
}
