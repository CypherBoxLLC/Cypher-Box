import { AppState } from 'react-native';

import useAuthStore from '@Cypher/stores/authStore';
import { recordEvent } from '@Cypher/stores/eventLogStore';

import { writeArkAutoBackup } from './backup';
import { fetchChainTipHeight, blocksToDays } from './chainTip';
import { ARK_REFRESH_MIN_SATS, ARK_VTXO_DUST_SATS } from './config';
import { estimateArkRefreshFee, fetchArkPendingRoundStates, refreshArkVtxosAndSync } from './refresh';
import { fetchArkVtxos } from './vtxos';
import { getArkWalletHandle, getCachedArkMnemonic } from './walletHandle';
import {
    cancelVtxoExpiryWarnings,
    ensureBgNotificationPermission,
    notifyConsecutiveFailures,
    notifyDustStranded,
    notifyDustUneconomic,
    notifyExpiryWarning24h,
    notifyExpiryWarning6h,
    notifyFeeGated,
    notifyStuckRefresh,
} from './backgroundNotifications';
import {
    recordTelemetry,
    type ArkBgRefreshOutcome,
    type ArkBgRefreshTelemetryEntry,
    type ArkBgRefreshTrigger,
} from './backgroundTelemetry';

/**
 * Tunables for background-refresh policy. Module-level so a future debug
 * screen can override at runtime without wiring through state.
 *
 * Day thresholds assume Bark's default ~28-day VTXO lifetime; the spec's
 * "less than 1/3 / 1/2 of full lifetime" maps to ~9d / ~14d. If the ASP
 * config shifts the lifetime materially, revisit these.
 *
 * Fee ceiling is NOT here — it lives in zustand (`arkBgRefreshMaxFeeSats`)
 * because users can edit it from the Ark settings card. Default 5000 sats
 * is set at the store level.
 */
export const BG_REFRESH_TUNABLES = {
    /** Trigger threshold: at least one VTXO under this many days from expiry. */
    triggerDays: 9,
    /** Batch threshold: include all VTXOs under this many days in the round. */
    batchDays: 14,
    /** Minimum gap between successful background rounds, ms. */
    minGapBetweenSuccessMs: 12 * 60 * 60 * 1000,
    /**
     * Min gap for `arrival` triggers. LN receives land in an arkoor trust
     * window that closes only after refresh, so we want fire-on-arrival
     * latency — but a 60s coalescing floor batches rapid-fire receives
     * into one round and prevents fee-drain attacks via micro-payment
     * spam. See `project_arkoor_lightning_trust_model` memory entry.
     */
    minGapBetweenSuccessMsArrival: 60 * 1000,
    /** Suppress duplicate "<24h to expiry" notifications within this window, ms. */
    warn24hDedupeWindowMs: 12 * 60 * 60 * 1000,
    /** Suppress duplicate "<2h to expiry" notifications within this window, ms. */
    warn2hDedupeWindowMs: 60 * 60 * 1000,
    /** Suppress duplicate stuck-refresh notifications within this window, ms. */
    stuckWarnDedupeWindowMs: 2 * 60 * 60 * 1000,
    /**
     * Maximum age of the cached chain tip we'll trust for the
     * skip-esplora pre-check. Older than this and we fetch fresh —
     * matches the scheduler cadence so a force-quit user still
     * touches esplora at most once per ~6h, vs. once per wake.
     */
    cachedTipFreshMs: 6 * 60 * 60 * 1000,
    /**
     * Slack on top of batchDays for the cached pre-check, in days.
     * Absorbs up-to-cachedTipFreshMs of tip staleness — at mainnet's
     * ~144 blocks/day, 6h is ~36 blocks ≈ 0.25 days, so 1 day of
     * slack is a 4x safety margin against missing a near-expiry VTXO.
     */
    cachedPrecheckSlackDays: 1,
};

/**
 * Background-only stuck-refresh push. Called from the pending-round
 * pre-check: when a round has been in flight past the expected window
 * (the same 2x-round-interval threshold useArkSync uses for the in-app
 * banner), buzz the user so they can recover it with the app closed.
 *
 * - Foreground is skipped: useArkSync's "tap to recover" banner covers it
 *   there, and it (not us) owns the firstSeen map, so we avoid a double
 *   writer on the same zustand slot.
 * - Dedupe is PERSISTED (arkBgRefreshLastStuckWarnAt) because a cold
 *   background wake runs in a fresh JS process where an in-memory flag
 *   would be blank and re-fire on every wake.
 */
function maybeNotifyStuckRound(ongoingRoundIds: string[]): void {
    if (AppState.currentState === 'active') return;
    try {
        const store = useAuthStore.getState();
        const intervalSecs = store.arkRoundIntervalSecs;
        const prev = store.arkPendingRoundFirstSeen ?? {};
        const now = Date.now();
        // Maintain firstSeen like useArkSync does: keep stamps for
        // still-ongoing rounds, stamp newly-seen ones, drop the rest. Lets a
        // round first observed on a prior wake (no foreground tick since)
        // still age into "stuck".
        const onSet = new Set(ongoingRoundIds);
        const nextFirstSeen: Record<string, number> = {};
        for (const [id, ts] of Object.entries(prev)) {
            if (onSet.has(id)) nextFirstSeen[id] = ts;
        }
        for (const id of ongoingRoundIds) {
            if (nextFirstSeen[id] == null) nextFirstSeen[id] = now;
        }
        const changed =
            Object.keys(prev).length !== Object.keys(nextFirstSeen).length ||
            ongoingRoundIds.some((id) => prev[id] !== nextFirstSeen[id]);
        if (changed) store.setArkPendingRoundFirstSeen(nextFirstSeen);

        // No round interval yet (set once the interval fetch resolves); we
        // can't age a round without it. Bail quietly; a later wake retries.
        if (intervalSecs == null) return;
        const stuckThresholdMs = 2 * intervalSecs * 1000;
        const anyStuck = ongoingRoundIds.some(
            (id) => now - (nextFirstSeen[id] ?? now) > stuckThresholdMs,
        );
        if (!anyStuck) return;

        const last = store.arkBgRefreshLastStuckWarnAt;
        if (last !== null && now - last <= BG_REFRESH_TUNABLES.stuckWarnDedupeWindowMs) {
            return;
        }
        notifyStuckRefresh();
        store.setArkBgRefreshLastStuckWarnAt(now);
        console.log(
            '[Ark bg refresh] stuck-round push fired; ongoing round ids=',
            ongoingRoundIds.join(','),
        );
    } catch (err) {
        console.warn('[Ark bg refresh] stuck-round push check threw:', err);
    }
}

export type ArkBgRefreshResult = {
    outcome: ArkBgRefreshOutcome;
    elapsedMs: number;
    /** Number of VTXOs included in the batch (whether or not the round ran). */
    vtxoCount: number;
    feeSats: number | null;
    errorMsg?: string;
};

/**
 * Toggle the reminders + foreground auto-refresh feature on or off.
 *
 *   ON  → flip the persisted flag and request notification permission.
 *         The sync loop starts scheduling the per-VTXO expiry warnings
 *         and the urgency sweep starts firing runBackgroundRefresh
 *         ('foreground') on imminent capsules.
 *
 *   OFF → clear all derived state (last-success / last-attempt /
 *         consecutive-failure / deferred-backup) and cancel every queued
 *         expiry warning. Posture is fully restored to pre-feature.
 *
 * History: this toggle used to also arm the OS background-wake machinery
 * (BGProcessingTask / AlarmManager), mirror the seed into a background-
 * readable keychain entry, and subscribe the device to the relay's silent
 * ark.refresh.due pushes. All three were removed with the background
 * refresh machinery — refresh only ever runs with the app in the
 * foreground now, so no seed copy and no wake path are needed.
 */
export async function setArkBackgroundRefreshEnabled(enabled: boolean): Promise<void> {
    const store = useAuthStore.getState();

    if (enabled) {
        store.setArkBgRefreshEnabled(true);
        // Request notification permission so warning notifications can
        // surface. The feature works either way — declining just means
        // the user relies on the in-app banner as their signal.
        try {
            await ensureBgNotificationPermission();
        } catch (notifErr) {
            console.warn('[Ark bg refresh] notification permission threw:', notifErr);
        }
        return;
    }

    // Drop any queued VTXO expiry warnings so the OS doesn't fire reminders
    // for a user who just turned them off. iterate the persisted map of
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

/**
 * Run one refresh attempt.
 *
 * Entry point for the foreground urgency sweep (useArkSync) and
 * LN-receive arrival triggers. The trigger argument is purely for
 * telemetry — the policy logic is identical either way.
 *
 * This function NEVER throws — every error path is captured in the
 * returned result and the rolling telemetry buffer. The native scheduler
 * caller should treat any non-success outcome as a "ran cleanly, just
 * didn't refresh" signal and reschedule normally.
 */
export async function runBackgroundRefresh(
    trigger: ArkBgRefreshTrigger,
): Promise<ArkBgRefreshResult> {
    const startedAt = Date.now();

    const finalize = async (
        outcome: ArkBgRefreshOutcome,
        opts: {
            vtxoCount?: number;
            feeSats?: number | null;
            totalSats?: number;
            errorMsg?: string;
        } = {},
    ): Promise<ArkBgRefreshResult> => {
        const elapsedMs = Date.now() - startedAt;
        const result: ArkBgRefreshResult = {
            outcome,
            elapsedMs,
            vtxoCount: opts.vtxoCount ?? 0,
            feeSats: opts.feeSats ?? null,
            errorMsg: opts.errorMsg,
        };

        const entry: ArkBgRefreshTelemetryEntry = {
            at: startedAt,
            trigger,
            outcome,
            elapsedMs,
            vtxoCount: opts.vtxoCount,
            feeSats: opts.feeSats ?? undefined,
            errorMsg: opts.errorMsg,
        };
        await recordTelemetry(entry);

        // Mirror meaningful outcomes into the unified activity-log store so
        // the in-app notifications bell / Activity screen show bg refresh
        // alongside ln-sent / ln-received / auto-backup. Filter at the
        // call site (not inside recordEvent) so the detailed telemetry
        // buffer above keeps every attempt for debugging, while the
        // user-facing dropdown stays signal-dense.
        //
        // Skipped on purpose:
        //   - rate_limited            (normal — orchestrator declining)
        //   - no_eligible_vtxos       (normal — nothing near expiry)
        //   - disabled                (toggle is off; user knows)
        //   - pending_round_conflict  (transient — next sync resolves)
        const userVisibleOutcomes: ReadonlySet<ArkBgRefreshOutcome> = new Set([
            'success',
            'error',
            'fee_gated',
            'dust_uneconomic',
            'dust_stranded',
            'no_seed',
        ]);
        if (userVisibleOutcomes.has(outcome)) {
            try {
                recordEvent({
                    kind: 'ark-bg-refresh',
                    trigger,
                    outcome,
                    elapsedMs,
                    vtxoCount: opts.vtxoCount,
                    feeSats: opts.feeSats ?? undefined,
                    errorMsg: opts.errorMsg,
                });
            } catch (logErr) {
                // Telemetry must not break the refresh flow.
                console.warn('[Ark bg refresh] activity-log record failed:', logErr);
            }
        }

        const store = useAuthStore.getState();
        store.setArkBgRefreshLastAttempt({
            at: startedAt,
            outcome,
            elapsedMs,
            errorMsg: opts.errorMsg ?? null,
        });

        if (outcome === 'success') {
            store.setArkBgRefreshLastSuccessAt(startedAt);
            store.setArkBgRefreshConsecutiveFailures(0);
        } else if (outcome === 'error') {
            const next = store.arkBgRefreshConsecutiveFailures + 1;
            store.setArkBgRefreshConsecutiveFailures(next);
            // Fire only on the transition into 2 — not on every error past
            // 2 — so users get one notification per outage, not a stream.
            if (next === 2) {
                try {
                    notifyConsecutiveFailures();
                } catch (notifErr) {
                    console.warn('[Ark bg refresh] failure notification threw:', notifErr);
                }
            }
        } else if (outcome === 'fee_gated' && opts.feeSats != null) {
            try {
                notifyFeeGated(
                    opts.feeSats,
                    useAuthStore.getState().arkBgRefreshMaxFeeSats,
                );
            } catch (notifErr) {
                console.warn('[Ark bg refresh] fee-gate notification threw:', notifErr);
            }
        } else if (outcome === 'dust_uneconomic' && opts.feeSats != null) {
            try {
                notifyDustUneconomic(
                    opts.feeSats,
                    opts.totalSats ?? 0,
                    opts.vtxoCount ?? 0,
                );
            } catch (notifErr) {
                console.warn('[Ark bg refresh] dust-uneconomic notification threw:', notifErr);
            }
        } else if (outcome === 'dust_stranded') {
            try {
                notifyDustStranded(
                    opts.totalSats ?? 0,
                    ARK_REFRESH_MIN_SATS,
                    opts.vtxoCount ?? 0,
                );
            } catch (notifErr) {
                console.warn('[Ark bg refresh] dust-stranded notification threw:', notifErr);
            }
        }
        // Other outcomes (no_eligible_vtxos, rate_limited, no_seed,
        // disabled) represent the system correctly declining to run — they
        // are not failures and don't trigger any notification.

        return result;
    };

    try {
        // Re-check the toggle at runtime. A scheduled wake may fire after
        // the user disabled the feature; the OS-level cancel isn't
        // synchronous on every platform.
        if (!useAuthStore.getState().arkBgRefreshEnabled) {
            return finalize('disabled');
        }

        // Rate limit: at most one successful round per min-gap window.
        // Counting from last SUCCESS (not last attempt) so a string of failed
        // attempts doesn't lock us out. Arrival triggers (LN-receive
        // fire-on-landing) use a much shorter gap so the arkoor trust window
        // closes quickly, while burst arrivals still coalesce into one round
        // and a micro-payment spam attacker can't drain fees faster than once
        // per gap.
        const lastSuccess = useAuthStore.getState().arkBgRefreshLastSuccessAt;
        const minGapMs =
            trigger === 'arrival'
                ? BG_REFRESH_TUNABLES.minGapBetweenSuccessMsArrival
                : BG_REFRESH_TUNABLES.minGapBetweenSuccessMs;
        if (lastSuccess !== null && Date.now() - lastSuccess < minGapMs) {
            return finalize('rate_limited');
        }

        // Foreground-only now: the wallet handle must already be open
        // (boot restore or user action opened it). The old background-wake
        // path hydrated a fresh process from a background-readable seed
        // copy here; that machinery is gone. Reuse the `no_seed` outcome
        // so historical telemetry stays comparable.
        if (!getArkWalletHandle()) {
            return finalize('no_seed', { errorMsg: 'wallet handle not open' });
        }

        // Pending-round-state pre-check. If the ASP / SDK is still working
        // a round we previously submitted (the SDK exposes this via
        // `pendingRoundStates()` regardless of whether our local VTXO state
        // has caught up), bail before doing any more work. Submitting a
        // refresh with one of those VTXOs included produces a server-side
        // `vtxo … already registered` rejection that surfaces as
        // BarkError.ServerConnection, ticks the consecutive-failures
        // counter, and flashes a failed-round Movement event through the
        // UI — none of which is a real error: the round just hasn't
        // committed yet. The next sync cycle's MovementUpdated will fire
        // when the in-flight round resolves and the retry will work
        // naturally.
        try {
            const pendingRounds = await fetchArkPendingRoundStates();
            const ongoingRoundIds = pendingRounds
                .filter((r) => r.ongoing)
                .map((r) => String(r.id));
            if (ongoingRoundIds.length > 0) {
                // A round is in flight. If it has been in flight past the
                // expected completion window, buzz the user so they can
                // recover it even with the app closed (the in-app banner
                // only helps when the app is open). Backgrounded-only +
                // deduped inside the helper.
                maybeNotifyStuckRound(ongoingRoundIds);
                return finalize('pending_round_conflict');
            }
        } catch (err) {
            // Probe failed — fall through and let the round attempt
            // surface any real issue. We don't want a transient SDK
            // hiccup on a status query to block refresh entirely.
            console.warn('[Ark bg refresh] pendingRoundStates probe failed, proceeding:', err);
        }

        // Local VTXO read (no network) first — feeds both the cached
        // pre-check below and the fresh-tip eligibility scan further
        // down.
        const vtxos = await fetchArkVtxos();
        if (!vtxos) {
            return finalize('error', { errorMsg: 'vtxo fetch failed' });
        }

        // Privacy / battery / perf short-circuit: if the cached chain
        // tip from a recent foreground sync says NO spendable VTXO is
        // near expiry (with slack for tip staleness), exit without
        // hitting esplora at all. On a healthy active wallet this is
        // the common case — most background wakes complete fully
        // off-network, so neither esplora nor the ASP sees us.
        const store = useAuthStore.getState();
        const cachedTip = store.arkChainTipHeight;
        const lastSync = store.arkLastSyncedAt;
        const cachedTipFresh =
            cachedTip !== null &&
            lastSync !== null &&
            Date.now() - lastSync < BG_REFRESH_TUNABLES.cachedTipFreshMs;

        if (cachedTipFresh) {
            const cutoffDays =
                BG_REFRESH_TUNABLES.batchDays +
                BG_REFRESH_TUNABLES.cachedPrecheckSlackDays;
            let anyMaybeEligible = false;
            for (const v of vtxos.spendable) {
                if (v.expiryHeight === 0) continue;
                const blocksLeft = v.expiryHeight - cachedTip!;
                const daysLeft = blocksToDays(Math.max(0, blocksLeft));
                if (daysLeft < cutoffDays) {
                    anyMaybeEligible = true;
                    break;
                }
            }
            if (!anyMaybeEligible) {
                return finalize('no_eligible_vtxos', { vtxoCount: 0 });
            }
        }

        // Cached tip stale or pre-check flagged a candidate — fetch
        // fresh and run the real eligibility scan.
        //
        // Two thresholds in the scan below:
        //   triggerDays: at least one VTXO under this many days from
        //                expiry must exist or we don't run a round at all.
        //   batchDays:   if we're running, sweep up everything under this
        //                threshold so the same wallet doesn't get a second
        //                round next week.
        const tip = await fetchChainTipHeight();
        if (tip === null) {
            return finalize('error', { errorMsg: 'tip fetch failed' });
        }

        // Cache the fresh tip for the next wake's pre-check. useArkSync
        // doesn't run in the background so the store would otherwise
        // hold a stale value indefinitely on a force-quit user.
        store.setArkChainTipHeight(tip);
        store.setArkLastSyncedAt(Date.now());

        // VTXOs the user has explicitly opted out of auto-refresh via the
        // Arkoor-receive popup's "Use immediately" / "still pending" path.
        // These must be excluded BOTH from the short-expiry trigger set
        // AND from the filler set — otherwise the orchestrator drags the
        // user-deferred VTXO into a refresh round either as the trigger
        // (if it's the only short-expiry one in the wallet) or as a
        // top-up filler under the round-minimum (if its sats round out
        // an otherwise-tiny shortExpiry batch). Either way honours
        // "Use immediately" only on the JS-trigger side, not at the
        // batch-construction layer where Bark actually composes the
        // round payload.
        //
        // Paranoia gate: VTXOs observed within the last RECENT_WINDOW_MS
        // are also deferred regardless of their prompt-state status. This
        // closes the race where:
        //   T=0  bg refresh starts (useArkSync sweep, scheduled wake, ...)
        //   T=1  receive movement fires, movementWatcher pushes 'pending'
        //   T=2  bg refresh's getState() snapshot — already captured at T=0
        //        BEFORE the push — doesn't see the new entry, and the
        //        new vtxo gets pulled into the round as a filler.
        // Adding the time-window check picks up arkoors that arrived
        // mid-orchestrator and prevents them from being swept.
        const RECENT_WINDOW_MS = 90_000; // 90s — covers a slow ASP round + sync lag
        const promptState = useAuthStore.getState().arkArkoorPromptState ?? {};
        const nowForGate = Date.now();
        const deferredIds = new Set<string>();
        for (const [id, entry] of Object.entries(promptState)) {
            if (entry.status === 'pending' || entry.status === 'dismissed') {
                deferredIds.add(id);
                continue;
            }
            // Recently observed but somehow not pending (e.g. user already
            // resolved it via popup but the entry hasn't been pruned yet).
            // Don't double-refresh.
            if (entry.observedAt && nowForGate - entry.observedAt < RECENT_WINDOW_MS) {
                deferredIds.add(id);
            }
        }
        console.log(
            '[Ark bg refresh] deferral set:',
            deferredIds.size,
            'ids; promptState keys:',
            Object.keys(promptState).length,
        );

        // Categorise spendable VTXOs by expiry window and dust status.
        // The round-input constraint is on the AGGREGATE input total
        // (≥ ARK_REFRESH_MIN_SATS, currently 500 sats), not per-input —
        // so dust capsules CAN be refreshed if we top up the batch with
        // non-dust fillers. Mirrors the manual `dustConsolidate` logic
        // in `src/screens/Strike/CheckingAccountNew/ArkCapsules.tsx`.
        type Candidate = { id: string; sats: number; daysLeft: number };
        const shortExpiry: Candidate[] = []; // < batchDays, will be batched
        const longExpiryNonDust: Candidate[] = []; // ≥ batchDays AND > dust — usable as filler
        let triggerCount = 0;
        let imminent24h = false;
        let imminent6h = false;
        // Aggregate sats at risk inside each imminent window — the user-facing
        // notification surfaces the value so they can gauge "is this worth my
        // attention right now". 24h aggregate includes the 6h slice (a 6h-imminent
        // VTXO is also 24h-imminent), which matches the notification dedupe
        // logic below: when the 6h notif fires we suppress the 24h one.
        let imminent24hSats = 0;
        let imminent6hSats = 0;
        let deferredSkipped = 0;
        for (const v of vtxos.spendable) {
            // Honour user-deferred VTXOs (Arkoor-receive popup "Use
            // immediately"). Never include them in either bucket; the
            // 24h-before push schedule fires the safety net when they
            // approach actual expiry.
            if (deferredIds.has(v.id)) {
                deferredSkipped++;
                continue;
            }
            // Skip VTXOs with no resolved expiry (SDK sentinel: expiryHeight=0).
            // Arkoor VTXOs inherit their source's expiry and the SDK normally
            // resolves it; a 0 here means the source isn't in the local
            // datadir yet, so we can't compute a timeline — next sync should
            // populate it. Arkoor VTXOs refresh independently via
            // refreshVtxos(), they don't piggyback on the source.
            if (v.expiryHeight === 0) continue;
            // Skip past-expiry VTXOs. Including them in a round poisons it:
            // the ASP rejects expired inputs and the entire round fails with
            // outputs=0 effectiveSats=-2, leaving healthy non-expired inputs
            // stuck locked alongside the dead one. Filtering here lets the
            // batch progress with the recoverable subset. The expired VTXO
            // is also hidden from the capsule list (see useArkSync) so the
            // user isn't shown an actionable capsule that can't actually
            // be refreshed.
            if (v.expiryHeight <= tip) continue;
            const blocksLeft = v.expiryHeight - tip;
            const daysLeft = blocksToDays(Math.max(0, blocksLeft));
            // Imminent-expiry warning observation runs across ALL spendable VTXOs,
            // not just the batch-eligible set.
            const hoursLeft = daysLeft * 24;
            if (hoursLeft < 24) {
                imminent24h = true;
                imminent24hSats += v.sats;
            }
            if (hoursLeft < 6) {
                imminent6h = true;
                imminent6hSats += v.sats;
            }
            const cand: Candidate = { id: v.id, sats: v.sats, daysLeft };
            if (daysLeft < BG_REFRESH_TUNABLES.batchDays) {
                shortExpiry.push(cand);
                if (daysLeft < BG_REFRESH_TUNABLES.triggerDays) triggerCount++;
            } else if (v.sats > ARK_VTXO_DUST_SATS) {
                longExpiryNonDust.push(cand);
            }
        }
        if (deferredSkipped > 0) {
            console.log(
                '[Ark bg refresh] skipped',
                deferredSkipped,
                'user-deferred VTXO(s) from round eligibility',
            );
            // Surface in the activity feed so the user sees the
            // orchestrator actually honoured their "Use immediately"
            // choice. Without this, deferral is invisible until they
            // notice the VTXO isn't Locked — fine for the happy path,
            // confusing for "wait, did my choice register?" moments.
            recordEvent({
                kind: 'arkoor-prompt',
                outcome: 'auto-skipped',
                vtxoCount: deferredSkipped,
            });
        }

        // Build the round batch. Start with everything short-expiry; if
        // the aggregate is below the round minimum, top up with the
        // smallest non-dust long-expiry fillers (refreshing them too is
        // a small cost — they get a fresh ~30d lifetime — and unlocks
        // the dust). If even with all available fillers we can't reach
        // the minimum, the dust is protocol-stranded for this cycle and
        // we surface that to the user instead of submitting a round
        // that bark will reject with BarkError.Internal.
        const batchCandidates: Candidate[] = [...shortExpiry];
        let batchTotalSats = batchCandidates.reduce((a, c) => a + c.sats, 0);
        let fillerCount = 0;
        if (batchTotalSats > 0 && batchTotalSats < ARK_REFRESH_MIN_SATS) {
            // Filler selection priority:
            //   1. soonest-to-expire first (within the long-expiry set) —
            //      a filler at 16d gains ~14 days from this refresh,
            //      a filler at 30d gains only ~0 days, so we get more
            //      "expiry value" per fee sat spent;
            //   2. smallest sats within the same expiry tier — minimises
            //      the amount of healthy capsule value we drag into a
            //      dust-driven round;
            // Skipping fresh long-life big capsules unless nothing else
            // is available — matches Bam's intent for auto-consolidation.
            const fillers = [...longExpiryNonDust].sort((a, b) => {
                if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
                return a.sats - b.sats;
            });
            for (const f of fillers) {
                batchCandidates.push(f);
                batchTotalSats += f.sats;
                fillerCount++;
                if (batchTotalSats >= ARK_REFRESH_MIN_SATS) break;
            }
        }
        const batchIds: string[] = batchCandidates.map((c) => c.id);
        if (fillerCount > 0) {
            console.log(
                '[Ark bg refresh] topped up batch with', fillerCount,
                'long-expiry non-dust filler(s) to clear', ARK_REFRESH_MIN_SATS,
                'sat round minimum (final total=', batchTotalSats, 'sats)',
            );
        }

        // Fire imminent-expiry notifications BEFORE the action decision —
        // even if we exit on `rate_limited` or `no_eligible_vtxos`, the
        // user still needs to know. Dedupe per-window so a 6h scheduler
        // cadence doesn't spam.
        if (imminent6h) {
            const last2h = useAuthStore.getState().arkBgRefreshLastWarn2hAt;
            if (last2h === null || Date.now() - last2h > BG_REFRESH_TUNABLES.warn2hDedupeWindowMs) {
                try {
                    notifyExpiryWarning6h(imminent6hSats);
                    useAuthStore.getState().setArkBgRefreshLastWarn2hAt(Date.now());
                } catch (notifErr) {
                    console.warn('[Ark bg refresh] 2h warning threw:', notifErr);
                }
            }
        } else if (imminent24h) {
            // Only fire 24h if 2h didn't already — the 2h message covers it.
            const last24h = useAuthStore.getState().arkBgRefreshLastWarn24hAt;
            if (last24h === null || Date.now() - last24h > BG_REFRESH_TUNABLES.warn24hDedupeWindowMs) {
                try {
                    notifyExpiryWarning24h(imminent24hSats);
                    useAuthStore.getState().setArkBgRefreshLastWarn24hAt(Date.now());
                } catch (notifErr) {
                    console.warn('[Ark bg refresh] 24h warning threw:', notifErr);
                }
            }
        }

        // Final-mile deferral re-check. Receive notifications that landed
        // AFTER we read promptState at categorization-time would otherwise
        // sneak into batchIds. Re-read state here and drop any newly-added
        // deferred ids before fee estimation / round submission.
        {
            const latestPromptState =
                useAuthStore.getState().arkArkoorPromptState ?? {};
            const lateAddedDeferred = new Set<string>();
            const lateNow = Date.now();
            for (const [id, entry] of Object.entries(latestPromptState)) {
                if (deferredIds.has(id)) continue; // already accounted for at categorization
                if (
                    entry.status === 'pending' ||
                    entry.status === 'dismissed' ||
                    (entry.observedAt && lateNow - entry.observedAt < RECENT_WINDOW_MS)
                ) {
                    lateAddedDeferred.add(id);
                }
            }
            if (lateAddedDeferred.size > 0) {
                const droppedFromBatch = batchIds.filter((id) =>
                    lateAddedDeferred.has(id),
                );
                if (droppedFromBatch.length > 0) {
                    console.log(
                        '[Ark bg refresh] final-mile drop:',
                        droppedFromBatch.length,
                        'mid-orchestrator deferrals (ids:',
                        droppedFromBatch.map((id) => id.slice(0, 12)).join(', '),
                        ')',
                    );
                    const keptIds = batchIds.filter(
                        (id) => !lateAddedDeferred.has(id),
                    );
                    const keptSats = batchCandidates
                        .filter((c) => keptIds.includes(c.id))
                        .reduce((a, c) => a + c.sats, 0);
                    batchIds.length = 0;
                    batchIds.push(...keptIds);
                    batchTotalSats = keptSats;
                    recordEvent({
                        kind: 'arkoor-prompt',
                        outcome: 'auto-skipped',
                        vtxoCount: droppedFromBatch.length,
                    });
                }
            }
        }

        if (triggerCount === 0 || batchIds.length === 0) {
            return finalize('no_eligible_vtxos', { vtxoCount: batchIds.length });
        }

        // Round-input minimum: bark/ASP rejects rounds whose total input
        // value is below ARK_REFRESH_MIN_SATS with `BarkError.Internal:
        // "vtxo amount must be at least 0.00000330 BTC to participate in
        // a round"`. We already topped up with fillers above; if we
        // still can't reach the minimum, the user genuinely doesn't
        // have enough non-dust value in their wallet to consolidate
        // the dust. Surface it instead of submitting a round that
        // bark will reject.
        if (batchTotalSats < ARK_REFRESH_MIN_SATS) {
            return finalize('dust_stranded', {
                vtxoCount: batchIds.length,
                totalSats: batchTotalSats,
            });
        }

        // Fee preview before committing to the round. If the ASP returns an
        // unexpectedly large fee, surface it instead of silently auto-paying
        // — protects against runaway-fee scenarios drained without user
        // notice.
        let feeSats: number;
        try {
            const estimate = await estimateArkRefreshFee(batchIds);
            feeSats = estimate.feeSats;
        } catch (err: any) {
            return finalize('error', {
                vtxoCount: batchIds.length,
                errorMsg: `fee estimate failed: ${err?.message ?? err}`,
            });
        }

        const maxFeeSats = useAuthStore.getState().arkBgRefreshMaxFeeSats;
        if (feeSats > maxFeeSats) {
            return finalize('fee_gated', {
                vtxoCount: batchIds.length,
                feeSats,
            });
        }

        // Dust-economic guard. Refreshing a batch whose total value is at or
        // below the round fee is value-destroying — better to let those
        // VTXOs expire and notify the user than to lock in a guaranteed loss.
        // At observed mainnet refresh fees of 0–20 sats per user this only
        // fires for genuine sub-fee dust (e.g. a stray 1-sat LN tip with no
        // larger batch-mate to amortise it against).
        if (feeSats >= batchTotalSats) {
            return finalize('dust_uneconomic', {
                vtxoCount: batchIds.length,
                feeSats,
                totalSats: batchTotalSats,
            });
        }

        // The round itself. This is the long-running step: refresh + sync +
        // local read-back. Mainnet rounds under load can stretch into the
        // low minutes — too long for iOS BGAppRefreshTask's ~30s budget,
        // which is why the iOS scheduler runs as BGProcessingTask
        // (charger + idle, longer window). Android WorkManager has no
        // equivalent budget concern.
        try {
            await refreshArkVtxosAndSync(batchIds, batchTotalSats);
        } catch (err: any) {
            return finalize('error', {
                vtxoCount: batchIds.length,
                feeSats,
                errorMsg: `refresh failed: ${err?.message ?? err}`,
            });
        }

        // Best-effort local backup. Background refresh changed the VTXO
        // set, so the on-disk .cbark snapshot is now stale. Cloud upload
        // is out of scope — this codebase has no cloud-upload path yet
        // (see ARK_PROGRESS.md Phase 2A/2B) — so for now we only refresh
        // the local file. If the write fails the round still counts as a
        // success; the next foreground tick will retry via useArkSync.
        const mnemonic = getCachedArkMnemonic();
        if (mnemonic) {
            try {
                await writeArkAutoBackup(mnemonic);
                recordEvent({ kind: 'auto-backup', result: 'success', target: 'local' });
            } catch (err) {
                console.warn('[Ark bg refresh] post-refresh local backup failed:', err);
                recordEvent({ kind: 'auto-backup', result: 'failure', target: 'local' });
            }
        }

        return finalize('success', { vtxoCount: batchIds.length, feeSats });
    } catch (err: any) {
        // Defensive catch — every named branch above already returns through
        // finalize. This catches anything we didn't anticipate (e.g. zustand
        // initialisation order on a cold native wake).
        return finalize('error', { errorMsg: err?.message ?? String(err) });
    }
}
