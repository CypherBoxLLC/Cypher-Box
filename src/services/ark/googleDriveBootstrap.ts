import { Platform } from 'react-native';

import { configureGoogleDrive } from './googleDrive';

/**
 * One-time runtime configuration of the Google Drive client.
 *
 * Module is imported for side effect from App.js; the body executes
 * once at startup, no further calls needed. Idempotent — repeated
 * imports during HMR don't re-trigger because module evaluation is
 * memoised.
 *
 * Why split out from googleDrive.ts: that file's pure helpers should
 * stay parameterised (caller passes `webClientId`). The bootstrap
 * here is the single place that pulls the env value and calls the
 * configurator. Keeps the env-source coupling localised to one
 * module — anyone wanting to swap react-native-config for a
 * different env strategy edits one file.
 */

/**
 * Hardcoded fallback Web OAuth client ID for Android.
 *
 * WHY THIS IS HERE — under RN 0.76 + New Arch + this codebase's `rn-nodeify
 * --hack` postinstall step, `react-native-config` v1.6.1's TurboModule never
 * registers at runtime on Android: `TurboModuleRegistry.get('RNCConfigModule')`
 * returns null and `react-native-config/index.js`'s eager `.getConfig()` call
 * throws `TypeError: Cannot read property 'getConfig' of null` before the
 * package can return its config object. iOS is unaffected — the pods
 * integration on that platform doesn't go through the autolinking-discovery
 * path that rn-nodeify breaks.
 *
 * IS THE CLIENT ID SECRET? — No. Per Google's Android OAuth docs, native
 * Android apps use the "installed application" flow which has no
 * `client_secret`. The security binding is the SHA-1 fingerprint of the app
 * signing certificate plus the package name, both of which are registered
 * in Google Cloud Console and enforced server-side. The Web OAuth client ID
 * itself is also already embedded in every shipped APK via
 * `android/app/google-services.json` (Firebase config), so it's effectively
 * public regardless of what we do here. Hardcoding it avoids the broken
 * env-pull path and keeps Android Drive backup working today.
 *
 * If this changes (e.g. you create a separate prod OAuth client), update
 * this constant. iOS continues to read from `.env` via react-native-config
 * because that path works there.
 */
const ANDROID_WEB_CLIENT_ID_FALLBACK =
    '404148357398-cgvaqqtm7no04jm0in8bfjb5qvaq7f9c.apps.googleusercontent.com';

/** Lazy-load react-native-config so iOS bundles don't crash if the dep
 * isn't installed yet (the package.json bump is separate from
 * `yarn install`). Returns null on import failure. */
function loadConfig(): any | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('react-native-config');
        const resolved = mod?.default ?? mod ?? null;
        if (__DEV__) {
            console.log(
                '[Ark/Drive bootstrap] react-native-config resolved. Has default?',
                !!mod?.default,
                'Keys:',
                Object.keys(resolved || {}).slice(0, 5),
                'GOOGLE_WEB_CLIENT_ID len:',
                String(resolved?.GOOGLE_WEB_CLIENT_ID ?? '').length,
            );
        }
        return resolved;
    } catch (err: any) {
        if (__DEV__) {
            // Print the *actual* exception, not a misleading "not installed"
            // message — the real error tells us if it's a missing JS module
            // (`require` failed) vs. a native side returning null
            // (TurboModuleRegistry mis-registration).
            console.log(
                '[Ark/Drive bootstrap] require(react-native-config) threw. Real error:',
                err?.message ?? String(err),
                err?.stack?.split('\n').slice(0, 3).join(' | ') ?? '',
            );
        }
        return null;
    }
}

if (Platform.OS === 'android') {
    // Try .env first (works if react-native-config gets fixed later), fall
    // through to the hardcoded constant if the TurboModule path still
    // returns null. Either way we end up with a valid client ID on Android.
    const Config = loadConfig();
    const envClientId: string | undefined = Config?.GOOGLE_WEB_CLIENT_ID;
    const webClientId =
        envClientId && envClientId.length > 0
            ? envClientId
            : ANDROID_WEB_CLIENT_ID_FALLBACK;
    const usingFallback = webClientId === ANDROID_WEB_CLIENT_ID_FALLBACK;

    try {
        configureGoogleDrive({ webClientId });
        if (__DEV__) {
            console.log(
                '[Ark/Drive bootstrap] configured Drive client (id=',
                webClientId.slice(0, 12) + '…',
                usingFallback ? '— from hardcoded fallback)' : '— from .env)',
            );
        }
    } catch (err: any) {
        if (__DEV__) {
            console.log(
                '[Ark/Drive bootstrap] configureGoogleDrive threw — Drive backup disabled:',
                err?.message ?? err,
            );
        }
    }
}

// Exported so tests / dev tools can re-trigger config without restarting.
// Production path uses the side-effect import in App.js.
export function rebootstrapGoogleDrive(): void {
    if (Platform.OS !== 'android') return;
    const Config = loadConfig();
    const envClientId: string | undefined = Config?.GOOGLE_WEB_CLIENT_ID;
    const webClientId =
        envClientId && envClientId.length > 0
            ? envClientId
            : ANDROID_WEB_CLIENT_ID_FALLBACK;
    configureGoogleDrive({ webClientId });
}
