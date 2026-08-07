import useAuthStore from '@Cypher/stores/authStore';

import {
    cancelVtxoExpiryWarnings,
    ensureBgNotificationPermission,
} from './backgroundNotifications';
import {
    deleteBackgroundArkSeed,
    readBackgroundArkSeed,
    writeBackgroundArkSeed,
} from './backgroundKeychain';
import { getArkWalletHandle, getCachedArkMnemonic, openArkWallet } from './walletHandle';
import { maintenanceArkDelegated } from './refresh';
import { syncArkWallet } from './sync';
import { AVG_BLOCK_MINUTES, fetchChainTipHeight } from './chainTip';
import { fetchArkVtxos } from './vtxos';

/**
 * Toggle the capsule-expiry reminders + opt-in background maintenance on/off.
 *
 * While ENABLED this governs two things:
 *   (a) the per-VTXO expiry reminder notifications the sync loop schedules; and
 *   (b) the background maintenance path — the seed is mirrored into a
 *       background-readable Keychain entry (see backgroundKeychain.ts) so a
 *       background wake can open the wallet and run delegated maintenance
 *       without a biometric prompt (see runArkBackgroundMaintenance below).
 *
 * DISABLING restores the pre-feature posture: bookkeeping cleared, every queued
 * expiry warning cancelled, and the background-readable seed copy deleted so no
 * seed lives outside the biometry-locked primary.
 *
 * The background path is deliberately NOT surfaced in UI copy: it is a
 * best-effort backstop, and manual refresh remains the reliable habit we want
 * users to keep. The persisted flag name (arkBgRefreshEnabled) is unchanged.
 */
export async function setArkBackgroundRefreshEnabled(enabled: boolean): Promise<void> {
    const store = useAuthStore.getState();

    if (enabled) {
        store.setArkBgRefreshEnabled(true);
        // Mirror the seed into the background-readable entry so the unattended
        // maintenance task can open the wallet on a background wake. Cached
        // mnemonic only (no biometric prompt); if the wallet isn't open yet
        // this is a no-op and the wallet-open path can backfill it.
        try {
            const m = getCachedArkMnemonic();
            if (m) await writeBackgroundArkSeed(m);
        } catch (seedErr) {
            console.warn('[Ark bg] background seed write threw:', seedErr);
        }
        // Request notification permission so the expiry reminders can
        // surface. The reminders work either way; declining just means the
        // user relies on the in-app banner as their signal.
        try {
            await ensureBgNotificationPermission();
        } catch (notifErr) {
            console.warn('[Ark reminders] notification permission threw:', notifErr);
        }
        // Acquire a push token so the server can wake this device before a
        // capsule expires. ensureBgNotificationPermission only unlocks LOCAL
        // notifications; it never registers the callback that captures a
        // token, so without this the wake registration silently no-ops and
        // the unattended refresh can never fire.
        //
        // This does NOT opt the user into onchain address uploads: that
        // consent is a separate flag which ensurePushTokenForArk pins before
        // minting. Lazy require because notifications.js is a JS singleton
        // whose statics attach at App bootstrap.
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Notifications = require('../../../blue_modules/notifications').default;
            const got = await Notifications.ensurePushTokenForArk?.();
            console.log('[Ark reminders] push token acquired:', !!got);
        } catch (tokenErr) {
            console.warn('[Ark reminders] push token acquisition threw:', tokenErr);
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
    // Remove the background-readable seed copy so no seed lives outside the
    // biometry-locked primary once the user opts out.
    await deleteBackgroundArkSeed();
}

/**
 * Unattended background maintenance: open the wallet from the background-
 * readable seed and hand due VTXOs to the ASP via delegated refresh. Invoked
 * by a background trigger (silent push / headless task) shortly before a VTXO's
 * expiry.
 *
 * No-ops unless the background seed exists — that entry is written on opt-in
 * and deleted on opt-out, so its presence IS the authoritative "enabled"
 * signal (more reliable than the persisted flag, which may not have rehydrated
 * yet on a cold background launch).
 *
 * Best-effort: any failure returns quietly; the local expiry reminders and the
 * next foreground sync remain the safety net. IMPORTANT: delegated maintenance
 * only kicks off the server-side round; the refreshed VTXO is VALIDATED on a
 * later foreground sync (the non-custodial step), so this widens the runway but
 * does NOT remove the need to open the app before expiry.
 */
export async function runArkBackgroundMaintenance(
    trigger: 'push' | 'scheduled' | 'foreground' | 'manual-test',
): Promise<void> {
    const mnemonic = await readBackgroundArkSeed();
    if (!mnemonic) return; // not opted in / no background seed → cannot open headlessly.

    useAuthStore.getState().setArkBgRefreshLastAttempt(Date.now());
    console.log('[Ark bg-refresh] maintenance start, trigger=', trigger);
    try {
        // Reuse a live handle if the process is already resident; otherwise open
        // from the background-readable seed (no biometric prompt).
        if (!getArkWalletHandle()) {
            await openArkWallet(mnemonic);
        }
        await maintenanceArkDelegated();
        // Pull the round outcome + validate the refreshed VTXO into the datadir.
        await syncArkWallet();
        const s = useAuthStore.getState();
        s.setArkBgRefreshLastSuccessAt(Date.now());
        s.setArkBgRefreshConsecutiveFailures(0);
        console.log('[Ark bg-refresh] maintenance ok, trigger=', trigger);

        // Re-register the NEW earliest expiry with GroundControl from within
        // the background wake itself. Without this, a device that is never
        // foregrounded gets exactly one rescue: the server would keep the
        // pre-refresh deadline, watch it pass, and drop the subscription.
        // With it, each successful background refresh re-arms the next
        // wake-up cycle (chained rescues). Foreground opens do the same via
        // useArkSync; this is the unattended twin. Best-effort: any failure
        // leaves the old server-side deadline in place, and the local
        // reminders remain the user-facing net.
        try {
            const vtxos = await fetchArkVtxos();
            const tipHeight = await fetchChainTipHeight();
            if (vtxos && typeof tipHeight === 'number') {
                const blockMs = AVG_BLOCK_MINUTES * 60 * 1000;
                const nowMs = Date.now();
                let earliest = 0;
                for (const v of vtxos.spendable) {
                    if (v.expiryHeight <= 0) continue;
                    const blocksLeft = v.expiryHeight - tipHeight;
                    if (blocksLeft <= 0) continue;
                    const expiryAtMs = nowMs + blocksLeft * blockMs;
                    if (earliest === 0 || expiryAtMs < earliest) earliest = expiryAtMs;
                }
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                // .default is required: notifications.js is an ES module, so
                // require() returns the module namespace and the statics hang
                // off .default. Without it the optional call below silently
                // no-ops and the next wake is never registered.
                const Notifications = require('../../../blue_modules/notifications').default;
                void Notifications.arkExpiryToGroundControl?.(earliest);
                console.log(
                    '[Ark bg-refresh] re-registered earliest expiry:',
                    earliest === 0 ? 'none' : new Date(earliest).toISOString(),
                );
            }
        } catch (regErr: any) {
            console.warn('[Ark bg-refresh] expiry re-registration failed (non-fatal):', regErr?.message ?? regErr);
        }
    } catch (err: any) {
        const s = useAuthStore.getState();
        s.setArkBgRefreshConsecutiveFailures((s.arkBgRefreshConsecutiveFailures ?? 0) + 1);
        console.warn('[Ark bg-refresh] maintenance failed:', err?.message ?? err);
    }
}

// Dev-only harness: exposes the maintenance entry point on the JS global so
// the full pipeline (bg-seed read -> handle-less wallet open -> delegated
// maintenance -> sync) can be driven from the Metro/CDP console on a real
// device without waiting for a real silent push:
//   arkBgMaintenanceTest()
// Stripped from release bundles by the __DEV__ guard; deliberately NOT a UI
// affordance (no user-facing surface for background refresh, per design).
if (__DEV__) {
    (globalThis as Record<string, unknown>).arkBgMaintenanceTest = () =>
        runArkBackgroundMaintenance('manual-test');
}
