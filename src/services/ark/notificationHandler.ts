import PushNotification from 'react-native-push-notification';

import useAuthStore from '@Cypher/stores/authStore';

import { navigationRef } from '../../../NavigationService';
import { isArkExpiryWarningSource } from './backgroundNotifications';

/**
 * Notification-tap routing for the Ark expiry warnings.
 *
 * This is the surviving piece of the old background-refresh scheduler:
 * the five pre-scheduled local expiry warnings (backgroundNotifications.ts)
 * fire regardless of app state, and tapping one deep-links the user to the
 * Capsules tab with an auto-refresh flag set. The silent-push / scheduled
 * background wake machinery that used to live alongside this handler was
 * removed after being disarmed in v0.1.1 — refresh now only happens with
 * the app in the foreground (sync-tick urgency sweep or user action).
 */

/**
 * Deep-link the user to the Ark Capsules tab and signal it to auto-refresh
 * on mount. Called from the notification tap handler — both for live taps
 * (app already running) and cold-start taps. The cold-start case is
 * delivered through the same `onNotification` callback because
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

async function dispatchArkExpiryTapRefresh(): Promise<void> {
    try {
        useAuthStore.getState().setArkPendingTapRefresh(true);
    } catch (err) {
        console.warn('[Ark notifications] could not set tap-refresh flag:', err);
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
 * One-time registration of the notification tap handler. Must run from
 * index.js so the handler is attached before the OS delivers a cold-start
 * tap into the process.
 *
 * requestPermissions: false — the reminders opt-in flow requests
 * permission via ensureBgNotificationPermission() when the user enables
 * the toggle.
 */
export function registerArkNotificationTapHandler(): void {
    // Single PushNotification.configure call for the whole app.
    PushNotification.configure({
        requestPermissions: false,
        onNotification: (notification: any) => {
            const data = (notification && (notification.data || notification.userInfo)) || {};
            if (
                notification &&
                notification.userInteraction === true &&
                isArkExpiryWarningSource(data.source)
            ) {
                // User tapped a pre-scheduled VTXO expiry warning (or one
                // of the live equivalents fired from a refresh tick).
                // Deterministic path: set a one-shot zustand flag, then
                // deep-link to the Capsules tab. ArkCapsules consumes the
                // flag on mount, hydrates the wallet (re-prompts Keychain
                // biometric if needed), and fires `refreshIds` against
                // every imminent VTXO with the existing "Refreshing…"
                // indicator visible from the moment the screen renders.
                // Works on cold/background/foreground because configure()
                // auto-pops the initial notification on cold launches.
                void dispatchArkExpiryTapRefresh();
            }
        },
    });

    // One-time hygiene for installs that had the old background-refresh
    // feature enabled: the toggle used to mirror the seed into a
    // background-readable (non-biometric) Keychain entry so headless wakes
    // could open the wallet. Those wakes no longer exist, so no copy of
    // the seed should either. Lazy require keeps the boot path light;
    // fire-and-forget because failure just means the entry outlives this
    // launch and gets retried on the next one.
    setTimeout(() => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { deleteBackgroundArkSeed } = require('./backgroundKeychain');
            void deleteBackgroundArkSeed().catch(() => {});
        } catch {}
    }, 0);
}
