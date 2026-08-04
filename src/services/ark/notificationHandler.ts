import { AppState } from 'react-native';
import PushNotification from 'react-native-push-notification';
import SimpleToast from 'react-native-simple-toast';

import useAuthStore from '@Cypher/stores/authStore';

import { navigationRef } from '../../../NavigationService';
import {
    isArkCapsuleTapSource,
    isArkExpiryWarningSource,
    isArkStuckSwapSource,
} from './backgroundNotifications';

/**
 * Notification-tap routing for the Ark capsule notifications: the five
 * pre-scheduled expiry warnings, payment-received alerts, and
 * refresh-complete notices (all in backgroundNotifications.ts). They fire
 * regardless of app state; tapping any of them deep-links the user to the
 * Capsules tab. The silent-push / scheduled background wake machinery that
 * used to live alongside this handler was removed after being disarmed in
 * v0.1.1 — refresh now only happens with the app in the foreground
 * (sync-tick urgency sweep or user action).
 */

/**
 * Deep-link the user to the Ark Capsules tab, optionally signalling it to
 * auto-refresh on mount. Called from the notification tap handler — both
 * for live taps (app already running) and cold-start taps. The cold-start
 * case is delivered through the same `onNotification` callback because
 * react-native-push-notification's `configure()` default
 * `popInitialNotification: true` auto-pops the initial notification once
 * the JS bridge is ready.
 *
 * On cold-start the JS bundle is loaded but NavigationContainer may not
 * have mounted yet. We poll `navigationRef.isReady()` for up to
 * `NAV_WAIT_MS` before giving up. If the timeout fires the zustand flag
 * stays set, so an eventual manual navigation to Capsules will still
 * consume it and trigger refresh — the user just doesn't get the
 * automatic routing on this launch.
 */
const NAV_WAIT_MS = 8000;

async function dispatchArkCapsuleTap(autoRefresh: boolean): Promise<void> {
    // Only expiry-warning taps arm the auto-refresh-on-mount flag —
    // refreshing is the action those notifications ask for. Payment-received
    // and refresh-complete taps are informational: navigate to Capsules
    // (whose mount reconciles VTXO state) without spending refresh fees.
    if (autoRefresh) {
        try {
            useAuthStore.getState().setArkPendingTapRefresh(true);
        } catch (err) {
            console.warn('[Ark notifications] could not set tap-refresh flag:', err);
        }
    }

    const wallet = useAuthStore.getState().arkWallet;
    if (!wallet) {
        // No Ark wallet on this install — the notification shouldn't have
        // fired in the first place. Bail rather than navigate to a screen
        // whose other tabs would dereference a null wallet.
        return;
    }

    const start = Date.now();
    while (!navigationRef.isReady() && Date.now() - start < NAV_WAIT_MS) {
        await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
    if (!navigationRef.isReady()) {
        return;
    }

    navigationRef.current?.navigate('CheckingAccountNew', {
        wallet,
        accountType: 'ark',
        initialTab: 0,
    });
}

/**
 * Deep-link a stuck-refresh "move your funds out" notification tap to
 * ArkStuckCapsuleScreen. Unlike the expiry-warning taps, this does NOT arm
 * auto-refresh, since refreshing is exactly what's stuck. The screen reads the
 * live `arkRefreshStuck` state from the store (cancel + swap-out actions),
 * so we pass only the vtxoId for context. Same cold-start nav-ready poll as
 * dispatchArkCapsuleTap.
 */
async function dispatchArkStuckSwapTap(vtxoId: unknown): Promise<void> {
    const wallet = useAuthStore.getState().arkWallet;
    if (!wallet) return;

    const start = Date.now();
    while (!navigationRef.isReady() && Date.now() - start < NAV_WAIT_MS) {
        await new Promise<void>(resolve => setTimeout(resolve, 100));
    }
    if (!navigationRef.isReady()) return;

    navigationRef.current?.navigate('ArkStuckCapsuleScreen', {
        vtxoId: typeof vtxoId === 'string' ? vtxoId : undefined,
    });
}

/**
 * Shared tap routing, callable from ANY PushNotification.configure
 * onNotification. react-native-push-notification only honors the LAST
 * configure() call, and blue_modules/notifications.js re-configures when
 * the user enables GroundControl notifications — which used to silently
 * replace this handler and break expiry-warning taps. Both configure
 * sites now delegate here, so last-caller-wins is harmless.
 *
 * Returns true when the notification was a capsule tap and was routed.
 */
export function handleArkNotificationTap(notification: any): boolean {
    const data = (notification && (notification.data || notification.userInfo)) || {};
    // Stuck-refresh swap-out taps route to ArkStuckCapsuleScreen instead of
    // the Capsules tab + auto-refresh. Checked first because these sources
    // are deliberately NOT in isArkCapsuleTapSource (refreshing is stuck).
    if (
        notification &&
        notification.userInteraction === true &&
        isArkStuckSwapSource(data.source)
    ) {
        void dispatchArkStuckSwapTap(data.vtxoId);
        return true;
    }
    if (
        notification &&
        notification.userInteraction === true &&
        isArkCapsuleTapSource(data.source)
    ) {
        // User tapped a capsule-related notification: an expiry warning,
        // a payment-received alert, or a refresh-complete notice. All
        // deep-link to the Capsules tab; only expiry warnings arm the
        // one-shot auto-refresh flag, which ArkCapsules consumes on mount
        // (hydrates the wallet, re-prompts Keychain biometric if needed,
        // and fires `refreshIds` against every imminent VTXO with the
        // "Refreshing…" indicator visible from first render). Works on
        // cold/background/foreground because configure() auto-pops the
        // initial notification on cold launches.
        void dispatchArkCapsuleTap(isArkExpiryWarningSource(data.source));
        return true;
    }
    return false;
}

// Foreground-transfer toast dedupe. GroundControl delivers the same
// transfer push more than once (observed live: identical payload twice
// within a second), and Android hands foreground pushes to JS silently —
// without dedupe the toast would stack.
let lastTransferToastKey = '';
let lastTransferToastAt = 0;
const TRANSFER_TOAST_DEDUPE_MS = 15_000;

/**
 * Visible in-app signal for a GroundControl transfer push that arrives
 * while the app is foregrounded. The OS shows nothing in that state by
 * design (the payload is handed to JS instead), and until now the app
 * discarded it — the user only found out about an incoming transfer by
 * pulling balances manually. Expects the flattened GroundControl payload
 * (fields at the root, e.g. `message` + `address`).
 */
export function maybeShowForegroundTransferBanner(payload: any): void {
    if (AppState.currentState !== 'active') return;
    if (!payload || payload.userInteraction === true) return;

    // Two push shapes are handled here, both otherwise invisible while
    // foregrounded (the OS shows no banner for a data push handed to JS):
    //   1. GroundControl onchain/coinos transfers — carry `message` + `address`.
    //   2. Ark mailbox pushes (type='ark_mailbox') from our bark relay —
    //      carry `title` + `body` + optional `sats`. The old handler
    //      dropped these as "could not find wallet, NOP".
    let text: string | null = null;
    let dedupeKey: string | null = null;

    if (payload.type === 'ark_mailbox') {
        const body: unknown = payload.body;
        const title: unknown = payload.title;
        text = typeof body === 'string' && body ? body
            : typeof title === 'string' && title ? title
            : null;
        // sats (when present) is the natural per-receive key; fall back to
        // the text so refresh/arkoor pushes without an amount still dedupe.
        dedupeKey = `ark:${payload.sats ?? text ?? ''}`;
    } else {
        const message: unknown = payload.message;
        const address: unknown = payload.address;
        if (typeof message === 'string' && message && typeof address === 'string') {
            text = message;
            dedupeKey = `${address}:${message}`;
        }
    }

    if (!text || !dedupeKey) return;
    const now = Date.now();
    if (dedupeKey === lastTransferToastKey && now - lastTransferToastAt < TRANSFER_TOAST_DEDUPE_MS) {
        return;
    }
    lastTransferToastKey = dedupeKey;
    lastTransferToastAt = now;
    SimpleToast.show(text, SimpleToast.LONG);
}

/**
 * One-time registration of the notification tap handler. Must run from
 * index.js so the handler is attached before the OS delivers a cold-start
 * tap into the process.
 *
 * requestPermissions: false — the reminders opt-in flow requests
 * permission via ensureBgNotificationPermission() when the user enables
 * the toggle.
 *
 * NOTE: blue_modules/notifications.js calls PushNotification.configure
 * AGAIN when GroundControl notifications are enabled, replacing these
 * callbacks. Both onNotification implementations route through the same
 * shared handlers above, so behavior is identical whichever configure
 * ran last.
 */
export function registerArkNotificationTapHandler(): void {
    PushNotification.configure({
        requestPermissions: false,
        onNotification: (notification: any) => {
            if (handleArkNotificationTap(notification)) return;
            // Mirror blue_modules' payload flattening: GroundControl data
            // sometimes sits under `data`, sometimes at the root.
            const payload = Object.assign({}, notification, notification?.data);
            maybeShowForegroundTransferBanner(payload);
        },
    });

    // Keep the background-readable seed copy in sync with the opt-in state: it
    // must exist ONLY while background refresh is enabled. When it's off, delete
    // any lingering copy so no seed lives outside the biometry-locked primary.
    // (Opt-out and reset delete it explicitly; this is the boot-time safety
    // net.) Lazy require keeps the boot path light; fire-and-forget.
    setTimeout(() => {
        try {
            if (!useAuthStore.getState().arkBgRefreshEnabled) {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { deleteBackgroundArkSeed } = require('./backgroundKeychain');
                void deleteBackgroundArkSeed().catch(() => {});
            }
        } catch {}
    }, 0);
}
