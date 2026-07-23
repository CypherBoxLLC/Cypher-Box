import useAuthStore from '@Cypher/stores/authStore';

import {
    cancelVtxoExpiryWarnings,
    ensureBgNotificationPermission,
} from './backgroundNotifications';

/**
 * Toggle the capsule-expiry reminders on or off.
 *
 *   ON  → flip the persisted flag and request notification permission so
 *         the sync loop can schedule the per-VTXO expiry warnings.
 *
 *   OFF → clear the derived bookkeeping (last-success / last-attempt /
 *         consecutive-failure / deferred-backup) and cancel every queued
 *         expiry warning. Posture is fully restored to pre-feature.
 *
 * History: automatic refresh has been removed (a foreground sweep, and
 * before that an OS background-wake path with a background-readable seed
 * copy and relay silent pushes). Refresh is manual now, so this toggle only
 * governs the expiry reminder notifications. The persisted flag name
 * (arkBgRefreshEnabled) is kept for store compatibility.
 */
export async function setArkBackgroundRefreshEnabled(enabled: boolean): Promise<void> {
    const store = useAuthStore.getState();

    if (enabled) {
        store.setArkBgRefreshEnabled(true);
        // Request notification permission so the expiry reminders can
        // surface. The reminders work either way; declining just means the
        // user relies on the in-app banner as their signal.
        try {
            await ensureBgNotificationPermission();
        } catch (notifErr) {
            console.warn('[Ark reminders] notification permission threw:', notifErr);
        }
        return;
    }

    // Drop any queued VTXO expiry warnings so the OS doesn't fire reminders
    // for a user who just turned them off. Iterate the persisted map of
    // (vtxoId -> expiryMs) the sync loop maintains; cancelVtxoExpiryWarnings
    // is per-id and swallows stale-id errors. Clear the map after so the
    // next sync tick (post-toggle-on) re-populates from a clean slate.
    const scheduled = store.arkScheduledExpiryNotifs ?? {};
    for (const id of Object.keys(scheduled)) {
        cancelVtxoExpiryWarnings(id);
    }
    store.setArkScheduledExpiryNotifs({});
    store.setArkBgRefreshEnabled(false);
    store.setArkBgRefreshLastSuccessAt(null);
    store.setArkBgRefreshLastAttempt(null);
    store.setArkBgRefreshConsecutiveFailures(0);
    store.setArkBgRefreshDeferredBackup(false);
}
