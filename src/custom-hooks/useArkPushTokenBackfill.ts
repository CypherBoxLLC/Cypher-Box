import { useEffect, useRef } from 'react';

import useAuthStore from '@Cypher/stores/authStore';

/**
 * Mint a push token for the capsule-expiry wake when the reminders flag is on
 * but no token exists.
 *
 * The gap this closes: `ensurePushTokenForArk` has exactly one caller,
 * `setArkBackgroundRefreshEnabled(true)`, which only runs on the TRANSITION to
 * on (wallet create, wallet recover, or the user flipping the switch).
 * `arkBgRefreshEnabled` defaults to `true` in authStore, so every wallet that
 * existed before that minting code shipped already has the flag on and never
 * transitions again. No transition means no token; `arkExpiryToGroundControl`
 * returns early without one, so GroundControl is never told when a capsule
 * expires and the unattended refresh can never fire. Every step of that fails
 * silently, which is why it looked like push delivery was broken.
 *
 * Deliberately additive. It can turn a dead wake path live; it cannot break a
 * working one. It writes no wallet state, touches no VTXO, and never blocks
 * boot.
 *
 * What it does NOT do: opt the user into on-chain address uploads.
 * `ensurePushTokenForArk` resolves and pins that separate consent flag BEFORE
 * minting, precisely so acquiring a token for Bark cannot be read later as
 * agreement to upload addresses.
 *
 * Consent: the reminders flag is the consent, and it is already on here. This
 * mints the token that flag always implied.
 *
 * Calibrate expectations. A token is necessary for the wake, not sufficient.
 * Apple states plainly that background notifications have no delivery
 * guarantee and throttles them device-wide, a force-quit iOS app receives none
 * at all until relaunched, and FCM demotes data pushes that never surface a
 * visible notification, which is exactly the shape of this one. So treat this
 * as repairing an optimisation, not as adding a safety net. The local expiry
 * alarms remain the mechanism of record: they are OS-scheduled and fire with
 * no network, no push and no ASP.
 *
 * Mount alongside `useArkSync` and `useArkRestoreOnBoot` in HomeScreen.
 */
export default function useArkPushTokenBackfill(): void {
    const isArkAuth = useAuthStore((s) => s.isArkAuth);
    const arkBgRefreshEnabled = useAuthStore((s) => s.arkBgRefreshEnabled);

    // Once per app session. If the user has denied notifications there will
    // never be a token, and without this the effect would re-attempt on every
    // dependency change for the whole session. The OS bounds the damage (iOS
    // shows its prompt only once ever), but a 60s pending promise per render
    // is still worth not creating.
    const attemptedRef = useRef(false);

    useEffect(() => {
        if (!isArkAuth) return;
        if (!arkBgRefreshEnabled) return;
        if (attemptedRef.current) return;
        attemptedRef.current = true;

        let cancelled = false;
        (async () => {
            try {
                // Lazy require: notifications.js is a JS singleton whose statics
                // attach at App bootstrap, so a static import can resolve before
                // they exist. `.default` is required because it is an ES module;
                // without it the optional calls below silently no-op, which is
                // the exact failure that kept Ark expiry registration dead once
                // before.
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const Notifications = require('../../blue_modules/notifications').default;
                if (!Notifications) return;

                const existing = await Notifications.getPushToken?.();
                if (cancelled) return;
                if (existing && existing.token) {
                    // Already minted. The registration path can run.
                    return;
                }

                const got = await Notifications.ensurePushTokenForArk?.();
                if (cancelled) return;
                console.log('[Ark pushBackfill] minted token for expiry wake:', !!got);
            } catch (err: any) {
                // Never fatal. A missing token only costs the unattended wake,
                // and the local expiry alarms are unaffected.
                console.warn(
                    '[Ark pushBackfill] token backfill failed (non-fatal):',
                    err?.message ?? err,
                );
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isArkAuth, arkBgRefreshEnabled]);
}
