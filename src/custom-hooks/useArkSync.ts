import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';

import {
    applyExpiredVtxoFilter,
    AVG_BLOCK_MINUTES,
    cancelVtxoExpiryWarnings,
    claimArkExitsToAddress,
    fetchArkBalance,
    fetchArkPendingLightningReceives,
    fetchArkPendingRoundStates,
    fetchArkRoundIntervalSecs,
    fetchArkVtxos,
    fetchChainTipHeight,
    fetchClaimableExitVtxos,
    fetchPendingExitsTotalSats,
    getArkWalletHandle,
    getCachedArkMnemonic,
    isICloudBackupAvailable,
    progressArkExits,
    progressArkPendingRounds,
    reopenArkWalletFromCache,
    resetArkWalletState,
    runBackgroundRefresh,
    scheduleVtxoExpiryWarnings,
    syncArkExits,
    syncArkWallet,
    tryClaimArkLightningReceives,
    writeArkAutoBackup,
} from '@Cypher/services/ark';
import { processArkMovementsForActivity } from '@Cypher/services/ark/movementsActivity';
import useAuthStore from '@Cypher/stores/authStore';
import { recordEvent } from '@Cypher/stores/eventLogStore';
import {
    getArkExitCorrelationId,
    setArkExitCorrelationId,
} from '@Cypher/services/activityCursors';

/**
 * Keep Ark wallet state in zustand fresh.
 *
 * Lifecycle:
 *   - On mount (if authed): immediate fetch.
 *   - Every INTERVAL_MS while mounted + authed: background fetch.
 *   - On AppState 'active' (user returns from background): fetch.
 *   - Ignores fetches if handle is null (wallet not initialized yet).
 *
 * We intentionally DO NOT block the UI on the fetch — the card renders
 * from whatever zustand currently holds (cached value from a prior session,
 * or the default 0 for a fresh install). `isSyncing` lets the caller show a
 * subtle spinner if desired, nothing more.
 *
 * Error policy: swallow errors into `lastError` and keep going. A one-off
 * esplora flake or ASP hiccup shouldn't spam the user — they'll see stale
 * data for up to one interval, which is fine for a balance view.
 *
 * PERFORMANCE NOTE: every cycle does ~5s of JS-thread-blocking UniFFI calls
 * into Bark's Rust crate (`syncArkWallet` ~2.3s, `fetchBalance/Vtxos/Tip`
 * ~2.6s on Galaxy A14). The Rust crate runs synchronously on the JS thread
 * because that's how `bark-react-native`'s UniFFI bindings work today, so
 * during those 5 seconds JS-driven UI updates stop. We can't make Rust
 * faster, but we can make the freezes less frequent and less noticeable:
 *   1. Longer interval on Android (slower phones, bigger relative cost)
 *   2. `InteractionManager.runAfterInteractions` so a cycle never starts
 *      mid-tap or mid-scroll — the work still runs, but only after the
 *      user's gesture completes, so they don't feel the freeze.
 *   3. Skip the slowest call (`syncArkWallet`) when there are no VTXOs
 *      and the prior sync was recent — nothing to sync against the ASP.
 */
const INTERVAL_MS_IOS = 30_000;
// Android (Galaxy A14 in particular) feels every 5s freeze; halving the
// freeze frequency to once a minute makes the wallet feel ~2x snappier
// while balance staleness stays acceptable for a non-custodial Ark wallet.
const INTERVAL_MS_ANDROID = 60_000;
const INTERVAL_MS = Platform.OS === 'android' ? INTERVAL_MS_ANDROID : INTERVAL_MS_IOS;
// If both balance and vtxo list have been zero/empty for at least N ticks,
// assume the wallet is idle (no incoming Lightning, no in-flight rounds,
// nothing to refresh). Skip the slow `syncArkWallet` call on those ticks
// and just refresh balance/vtxos/tip — saving ~2s per cycle.
const IDLE_SKIP_AFTER_EMPTY_TICKS = 3;

// Lazy refresh threshold. The sweep below fires runBackgroundRefresh
// ('foreground') only when a spendable, non-arkoor VTXO is within this
// many days of expiry. Anything farther out is left alone — the arkoor
// server-trust window is acceptable (and bark's refresh fee is 0 below
// 2 days per their published schedule). Replaces the old arrival-trigger
// strategy that fired on every LN receive.
const URGENCY_THRESHOLD_DAYS = 2;
const URGENCY_THRESHOLD_BLOCKS = Math.round(
    (URGENCY_THRESHOLD_DAYS * 24 * 60) / AVG_BLOCK_MINUTES,
);
// JS-side gate so a 30s sync tick doesn't spam runBackgroundRefresh()
// while the wallet sits in the urgent zone. The orchestrator has its
// own success-rate-limit, but it also writes a telemetry entry on
// every call (including rate_limited ones) — without this guard the
// telemetry buffer would fill with no-ops.
const FOREGROUND_SWEEP_MIN_GAP_MS = 5 * 60 * 1000;
let lastForegroundSweepAt = 0;

// --- Self-heal for a failed boot open -------------------------------------
//
// useArkRestoreOnBoot runs exactly once per mount and, on a failed open,
// leaves the handle null forever — the sync loop then just logs
// "handle not ready" every tick and NOTHING re-opens until a full app
// relaunch. That starves everything Ark (balance, VTXOs, round progression,
// stuck-refresh detection). When the handle is missing we kick off a
// cache-based re-open on a backoff. It reuses the seed cached at boot, so no
// Keychain read and no repeat FaceID; if the seed was never cached (boot
// hook hasn't run its first read yet) it no-ops and the boot hook handles it.
let arkReopenInFlight = false;
let lastArkReopenAt = 0;
const ARK_REOPEN_MIN_GAP_MS = 20_000;

async function maybeSelfHealArkHandle(): Promise<void> {
    if (arkReopenInFlight) return;
    if (Date.now() - lastArkReopenAt < ARK_REOPEN_MIN_GAP_MS) return;
    arkReopenInFlight = true;
    lastArkReopenAt = Date.now();
    try {
        const result = await reopenArkWalletFromCache();
        if (__DEV__) {
            console.log(
                '[ArkSync] self-heal reopen:',
                result.restored
                    ? 'success'
                    : `no-op/failed (${'reason' in result ? result.reason : 'unknown'})`,
            );
        }
    } catch (err) {
        if (__DEV__) console.warn('[ArkSync] self-heal reopen threw:', err);
    } finally {
        arkReopenInFlight = false;
    }
}

/**
 * Schedule version of the OS-level expiry-warning queue. Bumped when the
 * warning schedule changes (e.g. moving from 24h+6h to 4d/2d/24h/12h/6h).
 * The sync loop reads the persisted authStore value; if behind AND the
 * reminders toggle is on, it force-calls scheduleVtxoExpiryWarnings on
 * every spendable VTXO so existing alarms catch up with the new schedule,
 * then sets the persisted version. Idempotent: the OS replaces alarms
 * with the same id, and new alarms get added.
 */
const CURRENT_EXPIRY_NOTIFS_SCHEDULE_VERSION = 1;

export type UseArkSync = {
    isSyncing: boolean;
    lastError: Error | null;
    /** Manual refresh — use for pull-to-refresh gestures or after a send. */
    refresh: () => Promise<void>;
};

export default function useArkSync(): UseArkSync {
    const isArkAuth = useAuthStore((s) => s.isArkAuth);
    const setArkBalance = useAuthStore((s) => s.setArkBalance);
    const setArkBalanceDetail = useAuthStore((s) => s.setArkBalanceDetail);
    const setArkVtxos = useAuthStore((s) => s.setArkVtxos);
    const setArkRefreshStuck = useAuthStore((s) => s.setArkRefreshStuck);
    const setArkPendingRoundFirstSeen = useAuthStore((s) => s.setArkPendingRoundFirstSeen);
    const setArkScheduledExpiryNotifs = useAuthStore((s) => s.setArkScheduledExpiryNotifs);
    const setArkPendingLnReceives = useAuthStore((s) => s.setArkPendingLnReceives);
    const setArkChainTipHeight = useAuthStore((s) => s.setArkChainTipHeight);
    const setArkLastSyncedAt = useAuthStore((s) => s.setArkLastSyncedAt);
    const setArkLastBackupAt = useAuthStore((s) => s.setArkLastBackupAt);
    const arkRoundIntervalSecs = useAuthStore((s) => s.arkRoundIntervalSecs);
    const setArkRoundIntervalSecs = useAuthStore((s) => s.setArkRoundIntervalSecs);
    const arkExitInProgress = useAuthStore((s) => s.arkExitInProgress);
    const arkExitDestinationAddress = useAuthStore((s) => s.arkExitDestinationAddress);
    const clearArkAuth = useAuthStore((s) => s.clearArkAuth);
    const setArkExitInProgress = useAuthStore((s) => s.setArkExitInProgress);
    const setArkExitDestinationAddress = useAuthStore((s) => s.setArkExitDestinationAddress);
    const setArkExitStartedAt = useAuthStore((s) => s.setArkExitStartedAt);

    const [isSyncing, setIsSyncing] = useState(false);
    const [lastError, setLastError] = useState<Error | null>(null);

    // Guard against overlapping fetches: if a previous sync is still
    // in-flight when the interval fires, skip the new one. This also means
    // a slow esplora round-trip doesn't stack up calls behind it.
    const inFlight = useRef(false);
    // Counter used by the idle-skip heuristic. Increments every cycle that
    // returns balance=0 and vtxos.all.length=0; resets the moment either
    // turns non-zero. We use this to avoid the 2s Bark `syncArkWallet`
    // call when the wallet has nothing to settle.
    const consecutiveEmptyTicks = useRef(0);

    const sync = useCallback(async () => {
        if (inFlight.current) return;

        // Hard gate on handle readiness. On cold boot, `restoreArkWalletFromDisk`
        // takes 3-5s on a Galaxy A14 to reopen the Bark wallet. If the sync
        // hook fires in that window (mount triggers it immediately), the
        // UniFFI calls inside `fetchArkBalance` etc. block the JS thread
        // waiting for the handle that's still being opened by the boot
        // restore — an extra 4-5 seconds of JS-thread freeze on top of
        // the already-slow boot. Skip until the handle is genuinely ready;
        // the AppState 'active' listener and the next interval tick will
        // pick up where we left off.
        if (!getArkWalletHandle()) {
            // Don't just skip forever — the boot open may have failed and
            // nothing else re-opens. Kick off a guarded, backed-off re-open
            // from the cached seed (no Keychain / FaceID). This tick still
            // bails; the next tick after a successful re-open syncs normally.
            if (__DEV__) console.log('[ArkSync] handle not ready — attempting self-heal reopen');
            void maybeSelfHealArkHandle();
            return;
        }

        inFlight.current = true;
        setIsSyncing(true);
        // Defer the heavy work until the JS thread is genuinely idle.
        // RN's InteractionManager queues callbacks behind any in-flight
        // gesture / animation / native module callback. If the user is
        // currently tapping a button or scrolling, the sync waits up to
        // a few hundred ms for that to finish — we trade slightly stale
        // data for not pinning the JS thread mid-interaction.
        await new Promise<void>((resolve) =>
            InteractionManager.runAfterInteractions(() => resolve()),
        );
        // TEMPORARY: Bam reported a 20s freeze on cold launch when Ark exists.
        // Per-call timing narrows the JS-thread block to a single SDK call.
        const _t0 = Date.now();
        const _stamp = (label: string) => __DEV__ && console.log(`[ArkSync] ${label} +${Date.now() - _t0}ms`);
        _stamp('cycle start');
        try {
            // ----- Emergency-exit path -----
            //
            // When the user has triggered unilateral exit, we DON'T run the
            // normal sync (refresh / Lightning claim / VTXO fetch / round
            // progression). Those would race the exit machinery and burn
            // JS-thread time on Bark calls that no longer matter — every
            // VTXO is now in exit state, not Spendable.
            //
            // Per Erik / Bark docs: progressExits() must be called repeatedly
            // to advance broadcast txs as inputs ripen. syncExits() reconciles
            // chain state. Once listClaimableExits() returns non-empty, we
            // sweep to the saved destination address with drainExits().
            //
            // When pendingExitsTotalSats hits 0 AND there are no claimable
            // exits left, the exit is complete. We auto-delete the vault
            // (resetArkWalletState + clearArkAuth) so the user doesn't have
            // to come back later — Bam's call: "yes auto delete ark vault".
            if (arkExitInProgress) {
                try {
                    await progressArkExits();
                    _stamp('progressArkExits done');
                    await syncArkExits();
                    _stamp('syncArkExits done');

                    const claimable = await fetchClaimableExitVtxos();
                    _stamp(`fetchClaimableExitVtxos: ${claimable.length} ready`);
                    if (claimable.length > 0 && arkExitDestinationAddress) {
                        const claim = await claimArkExitsToAddress(
                            arkExitDestinationAddress,
                        );
                        _stamp(
                            `drainExits done — fee=${Number(claim.feeSats)} sats`,
                        );
                    }

                    // Did we finish? "Finished" = nothing pending AND nothing
                    // claimable left. Use this conservative AND so we don't
                    // delete the wallet while a second batch is mid-broadcast.
                    const pendingTotal = await fetchPendingExitsTotalSats();
                    const stillClaimable = await fetchClaimableExitVtxos();
                    if (pendingTotal === 0 && stillClaimable.length === 0) {
                        if (__DEV__) console.log('[Ark exit] complete — auto-deleting vault');
                        // Activity log: emit BEFORE resetArkWalletState
                        // wipes the Ark identity from this device, so the
                        // event-log entry is the user's lasting record
                        // that the exit succeeded. correlationId pairs
                        // this with the ark-exit-started event captured
                        // at the start of the exit.
                        const correlationId = getArkExitCorrelationId();
                        if (correlationId) {
                            recordEvent({
                                kind: 'ark-exit-finished',
                                correlationId,
                                result: 'success',
                            });
                            setArkExitCorrelationId(null);
                        }
                        await resetArkWalletState();
                        clearArkAuth();
                        setArkExitInProgress(false);
                        setArkExitDestinationAddress(null);
                        setArkExitStartedAt(null);
                    }
                } catch (exitErr: any) {
                    console.warn('[Ark exit] cycle failed:', exitErr?.message ?? exitErr);
                    setLastError(
                        exitErr instanceof Error ? exitErr : new Error(String(exitErr)),
                    );
                }
                // Skip the normal sync path — exit and refresh aren't a
                // sensible mix, and the heavy UniFFI calls below are pure
                // overhead while every VTXO is in exit state.
                return;
            }

            // Drive forward any pending Lightning receives BEFORE reading
            // VTXOs. (See original comment.)
            await tryClaimArkLightningReceives();
            _stamp('tryClaimArkLightningReceives done');

            // Drive forward any pending refresh / send rounds. This is the
            // recovery path for VTXOs left Locked after an interrupted
            // refresh — app-killed mid-round, JS-thread stalled past ASP
            // cutoff, network blip, etc. Per Bark dev (Erik): the SDK's
            // round state machine only advances when we call
            // `progressPendingRounds()`. Without this call, a Locked VTXO
            // sits Locked in our SQLite forever even though the round
            // succeeded (or failed) server-side. See
            // `progressArkPendingRounds` for full rationale.
            await progressArkPendingRounds();
            _stamp('progressArkPendingRounds done');

            // Observability: how many pending rounds is the SDK tracking?
            // ongoing=true → ASP / SDK still working it; wait.
            // ongoing=false → terminated server-side, awaiting local ingest
            //                 (next syncArkWallet should clear it).
            // If a Locked VTXO persists with ongoing=false across multiple
            // cycles, that's the signal for the future "Cancel stuck
            // refresh" UX (Layer 3). For now we just log the snapshot.
            // Fetch pending rounds outside the __DEV__ guard so the result
            // is available for the stuck-refresh detection below. The dev-
            // only console.log stays gated.
            const rounds = await fetchArkPendingRoundStates();
            if (__DEV__ && rounds.length > 0) {
                console.log(
                    '[Ark sync] pending rounds:',
                    rounds.map((r) => `${r.id}(${r.ongoing ? 'ongoing' : 'finalising'})`).join(', '),
                );
            }

            // Pull round finalizations + server-side updates into the local
            // datadir. SKIPPED when the wallet has been empty for
            // IDLE_SKIP_AFTER_EMPTY_TICKS in a row — there's nothing on the
            // ASP side to settle against an empty pubkey, and burning 2s of
            // JS-thread time for nothing is the freeze users notice most.
            // The first non-empty balance / vtxo result instantly resets
            // the skip counter, so a Lightning receive or board doesn't
            // get delayed.
            const skipSync = consecutiveEmptyTicks.current >= IDLE_SKIP_AFTER_EMPTY_TICKS;
            if (skipSync) {
                _stamp(`syncArkWallet skipped (idle ${consecutiveEmptyTicks.current} ticks)`);
            } else {
                try {
                    await syncArkWallet();
                    _stamp('syncArkWallet done');
                } catch (syncErr) {
                    console.warn('[Ark sync] wallet.sync() failed, continuing with cached state:', syncErr);
                    _stamp('syncArkWallet FAILED');
                }
            }

            // Run balance + vtxos + tip + pending-LN-receives concurrently.
            // Balance / vtxos / pending-LN-receives all read local SQLite
            // (no ASP round-trip), tip hits esplora — Promise.all collapses
            // them into a single JS-thread block with overlapping native
            // bridge time.
            const [balance, vtxos, tip, pendingLnReceives] = await Promise.all([
                fetchArkBalance(),
                fetchArkVtxos(),
                fetchChainTipHeight(),
                fetchArkPendingLightningReceives(),
            ]);
            _stamp('fetchBalance/Vtxos/Tip/PendingLn done');

            // Headline = sats the user can actually spend right now. The
            // SDK's `wallet.balance()` reports `spendableSats` based on
            // its local VTXO DB, which has two known over-reporting modes:
            //
            //   1. Pending in-flight buckets — pendingExit / pendingLnSend /
            //      claimableLnRecv / pendingBoard. These are real sats
            //      tied up in mid-flight flows but NOT immediately spendable.
            //      `fetchArkBalance` already keeps them in their own fields
            //      (and out of `totalSats`), so consumers can render them
            //      as separate UI elements ("100 sats incoming via LN"…)
            //      rather than rolling them into the big number.
            //
            //   2. Expired-but-still-Spendable VTXOs — the SDK doesn't
            //      auto-evict expired VTXOs until the ASP sweeps them and
            //      a sync prunes them, so dust the user can't recover
            //      (exit fee > value) lingers in `spendableSats` as a
            //      phantom. `applyExpiredVtxoFilter` subtracts these by
            //      comparing each VTXO's expiryHeight to the chain tip.
            //
            // Trade-off accepted: during a VTXO refresh the SDK briefly
            // marks the input VTXO Locked while the output isn't yet
            // Spendable, so the headline can flicker toward 0 for ~10–30s
            // mid-round. The fix for that is a "+ X sats refreshing"
            // indicator beside the headline driven by `pendingInRoundSats`
            // from `arkBalanceDetail`, not inflating the headline itself.
            // Earlier iterations tried `Math.max(balance, vtxoSum)` to
            // hide the dip, but it had a worse failure: it ALSO counted
            // Locked VTXOs that were mid-send, so post-withdrawal the
            // balance stayed artificially high until server-side pubkey
            // detachment (many minutes). Trusting `spendableSats` post-
            // expiry-filter is the lesser evil.
            const filteredBalance = balance
                ? applyExpiredVtxoFilter(balance, vtxos?.all, tip)
                : null;
            if (filteredBalance) {
                console.log(
                    '[Ark sync] headline=', filteredBalance.totalSats,
                    '(spendable=', filteredBalance.spendableSats,
                    'pendingInRound=', filteredBalance.pendingInRoundSats,
                    'claimableLn=', filteredBalance.claimableLightningReceiveSats,
                    'expiredUnrecoverable=', filteredBalance.expiredUnrecoverableSats,
                    'tip=', tip, ')',
                );
                setArkBalance(filteredBalance.totalSats);
                setArkBalanceDetail(filteredBalance);
            }
            if (vtxos) {
                // Filter past-expiry VTXOs out of the live capsule list.
                // The SDK reports them as Spendable until the ASP actually
                // sweeps them, but they cannot participate in a refresh
                // round (the ASP rejects expired inputs) and surfacing
                // them as actionable capsules misleads users: the funds
                // are already lost. Arkoor (expiryHeight === 0) stay,
                // they inherit expiry from their parent and the SDK
                // hasn't resolved it yet. The History tab still shows
                // their lifecycle as a record, so the loss is visible
                // there instead of cluttering the active capsule list.
                const visibleSpendable =
                    typeof tip === 'number'
                        ? vtxos.spendable.filter(
                              (v) => v.expiryHeight === 0 || v.expiryHeight > tip,
                          )
                        : vtxos.spendable;
                console.log(
                    '[Ark sync] writing',
                    visibleSpendable.length,
                    'vtxos to store (of',
                    vtxos.spendable.length,
                    'spendable,',
                    vtxos.all.length,
                    'total;',
                    vtxos.spendable.length - visibleSpendable.length,
                    'past-expiry hidden)',
                );
                setArkVtxos(visibleSpendable);
            } else {
                console.log('[Ark sync] fetchArkVtxos returned null (no handle)');
            }

            // --- Pre-schedule OS-level expiry-warning notifications ---
            //
            // This is the only mitigation for the "user receives via
            // Lightning while online, then goes offline indefinitely" edge
            // case. Background refresh + silent push both require the
            // device to wake up. Pre-scheduled local notifications fire
            // from the OS scheduler (UNUserNotificationCenter on iOS,
            // AlarmManager on Android) — they need only the clock ticking
            // and notification permission.
            //
            // We schedule the moment a VTXO with on-chain expiry appears
            // and cancel the moment it disappears (refreshed → new VTXO id,
            // spent, exited). True arkoor VTXOs (`expiryHeight === 0`)
            // are skipped — we'd need the ASP's trust window duration
            // to know when to fire, and the SDK doesn't expose that.
            // Documented limitation.
            //
            // Persisted bookkeeping in `arkScheduledExpiryNotifs` avoids
            // re-scheduling on every 30s tick. The OS's idempotent-by-id
            // behavior would make re-scheduling safe, but it's wasteful
            // and racy with the OS scheduler.
            if (vtxos && typeof tip === 'number') {
                const prevScheduled = useAuthStore.getState().arkScheduledExpiryNotifs;
                // First-sync-after-upgrade migration: if the persisted
                // schedule version trails the current one AND reminders
                // are on, force-call scheduleVtxoExpiryWarnings for every
                // spendable VTXO so the OS alarm queue matches the new
                // schedule (4d/2d/24h/12h/6h). Gated on the toggle so an
                // OFF user doesn't burn the migration tick on no-ops; the
                // migration retries next sync once they flip it on.
                const persistedScheduleVersion =
                    useAuthStore.getState().arkExpiryNotifsScheduleVersion ?? 0;
                const remindersOn = useAuthStore.getState().arkBgRefreshEnabled;
                const needsScheduleMigration =
                    persistedScheduleVersion < CURRENT_EXPIRY_NOTIFS_SCHEDULE_VERSION
                    && remindersOn;
                const nextScheduled: Record<string, number> = {};
                const blockMs = AVG_BLOCK_MINUTES * 60 * 1000;
                const nowMs = Date.now();

                // Add / keep entries for currently-spendable VTXOs with
                // an on-chain expiry. Skip ones that already expired (the
                // sweep upstream skips them too) and arkoor (expiryHeight=0).
                for (const v of vtxos.spendable) {
                    if (v.expiryHeight <= 0) continue;
                    const blocksLeft = v.expiryHeight - tip;
                    if (blocksLeft <= 0) continue;
                    const expiryAtMs = nowMs + blocksLeft * blockMs;
                    nextScheduled[v.id] = expiryAtMs;
                    if (needsScheduleMigration || prevScheduled[v.id] == null) {
                        try {
                            // Pass per-VTXO sats so the notification title
                            // carries "{N} sats" instead of the generic
                            // "your Ark vault balance" fallback. Cancellation
                            // on state change (above) keeps the baked-in
                            // amount from going stale.
                            scheduleVtxoExpiryWarnings(v.id, expiryAtMs, v.sats);
                            if (__DEV__) {
                                console.log(
                                    '[Ark sync] scheduled expiry warnings for',
                                    v.id.slice(0, 12),
                                    'at',
                                    new Date(expiryAtMs).toISOString(),
                                );
                            }
                        } catch (notifErr) {
                            console.warn(
                                '[Ark sync] scheduleVtxoExpiryWarnings threw:',
                                notifErr,
                            );
                        }
                    }
                }

                // Cancel for entries that are gone (refreshed, spent,
                // exited, or otherwise no longer spendable).
                for (const id of Object.keys(prevScheduled)) {
                    if (nextScheduled[id] == null) {
                        try {
                            cancelVtxoExpiryWarnings(id);
                            if (__DEV__) {
                                console.log(
                                    '[Ark sync] cancelled expiry warnings for',
                                    id.slice(0, 12),
                                );
                            }
                        } catch (notifErr) {
                            console.warn(
                                '[Ark sync] cancelVtxoExpiryWarnings threw:',
                                notifErr,
                            );
                        }
                    }
                }

                // Only commit the map back if it changed, to avoid
                // pointless re-renders of any subscriber to this slot.
                const prevKeys = Object.keys(prevScheduled);
                const nextKeys = Object.keys(nextScheduled);
                const changed =
                    prevKeys.length !== nextKeys.length ||
                    nextKeys.some((k) => prevScheduled[k] !== nextScheduled[k]);
                if (changed) setArkScheduledExpiryNotifs(nextScheduled);

                // Mark the migration as done so subsequent ticks skip it.
                // Bumped only if we actually ran the migration this tick
                // (so an OFF-toggle user retries next sync).
                if (needsScheduleMigration) {
                    useAuthStore
                        .getState()
                        .setArkExpiryNotifsScheduleVersion(
                            CURRENT_EXPIRY_NOTIFS_SCHEDULE_VERSION,
                        );
                }
            }

            // Stuck-refresh detection — TIME-based.
            //
            // Reliable signal: a round that's stayed pending (whether the SDK
            // reports it `ongoing` or `finalising`) for more
            // than `2 × roundIntervalSecs` (interval from
            // `fetchArkRoundIntervalSecs` — mainnet=3600s, signet=300s) is
            // past the natural ASP completion window. 2× allows for normal
            // jitter, a missed round, or a single network blip. Anything
            // beyond that is statistically not coming back without
            // intervention via `cancelPendingRound`.
            //
            // Why time and not on-chain expiry: tested empirically on
            // 2026-05-20 — a Locked VTXO's `expiryHeight` is the
            // PRE-refresh leaf's expiry, not the future round's. It's
            // expected to lag `tip` during a normal in-flight round.
            // (Confirmed: 3 Locked VTXOs at exp=949589 with tip=950146
            // were replaced by fresh exp=954176 VTXOs the moment the
            // round completed.) Using expiry as the stuck signal produced
            // false positives whenever a refresh was driven on
            // already-past-expiry VTXOs — exactly the recovery case the
            // SDK is designed to handle. Tapping the banner during a
            // false positive would call `cancelPendingRound` on a healthy
            // in-flight round.
            //
            // We track `firstSeenAt` per roundId in authStore (persisted
            // via existing zustand persist middleware) so a round that's
            // been pending across an app cold-restart still trips the
            // threshold instead of restarting the clock. The map is
            // pruned each sync to drop roundIds no longer in
            // `pendingRoundStates()`.
            // Track EVERY pending round, not just `ongoing` ones. A round
            // wedged in `finalising` (ongoing=false — terminated server-side
            // but never ingested into the local DB) is just as stuck as one
            // wedged `ongoing`, and the old `filter(r => r.ongoing)` let it
            // slip through, so it pulsed "Refreshing…" forever with no banner.
            // A healthy finalising round clears within a sync tick or two and
            // never reaches the 2×interval threshold; only wedged ones do.
            const now = Date.now();
            const prevFirstSeen = useAuthStore.getState().arkPendingRoundFirstSeen;
            // Ark is mainnet-only (1h round cadence), so fall back
            // to 3600s when arkInfo hasn't resolved yet. Without this the whole
            // detection silently no-op'd until the interval fetch landed, which
            // on a flaky ASP can be never — a wedged round then had no path to
            // a banner at all.
            const intervalSecs = useAuthStore.getState().arkRoundIntervalSecs ?? 3600;
            const pendingIdSet = new Set(rounds.map((r) => String(r.id)));

            // Build the next firstSeen map: keep existing entries for rounds
            // still pending; stamp `now` for newly-observed rounds; drop
            // entries for rounds no longer pending. Skip the setter when the
            // map is unchanged to avoid re-rendering subscribers for nothing.
            const nextFirstSeen: Record<string, number> = {};
            for (const [id, ts] of Object.entries(prevFirstSeen)) {
                if (pendingIdSet.has(id)) nextFirstSeen[id] = ts;
            }
            for (const r of rounds) {
                const key = String(r.id);
                if (nextFirstSeen[key] == null) nextFirstSeen[key] = now;
            }
            const prevKeys = Object.keys(prevFirstSeen);
            const nextKeys = Object.keys(nextFirstSeen);
            const mapChanged =
                prevKeys.length !== nextKeys.length ||
                nextKeys.some((k) => prevFirstSeen[k] !== nextFirstSeen[k]);
            if (mapChanged) setArkPendingRoundFirstSeen(nextFirstSeen);

            if (rounds.length > 0) {
                const stuckThresholdMs = 2 * intervalSecs * 1000;
                const stuck = rounds.filter((r) => {
                    const seen = nextFirstSeen[String(r.id)];
                    return seen != null && now - seen > stuckThresholdMs;
                });
                // "stuckSats" = sum of Locked VTXO amounts. The SDK doesn't
                // expose a vtxo→round link, so this is the total locked across
                // all rounds, not strictly the stuck-round subset. Fine for a
                // banner headline since the user cancels all stuck rounds anyway.
                const lockedSats = (vtxos?.all ?? [])
                    .filter((v) => v.state.toLowerCase() === 'locked')
                    .reduce((sum, v) => sum + v.sats, 0);
                // Only surface the banner when funds are ACTUALLY locked. Orphan
                // `finalising` round-state rows linger for days with no locked
                // inputs (observed live: rounds 8 & 12 flagged with lockedSats=0),
                // which the old `stuck.length > 0` alone would render as a bogus
                // "Refresh stuck · 0 sats". No locked sats → nothing at stake.
                if (stuck.length > 0 && lockedSats > 0) {
                    setArkRefreshStuck({
                        stuckRoundIds: stuck.map((r) => r.id),
                        stuckSats: lockedSats,
                        detectedAtTip: typeof tip === 'number' ? tip : 0,
                    });
                    if (__DEV__) {
                        console.warn(
                            '[Ark sync] STUCK refresh (time-based):',
                            'roundIds=', stuck.map((r) => r.id),
                            'ongoing=', stuck.map((r) => r.ongoing),
                            'ages(s)=', stuck.map((r) =>
                                Math.round((now - nextFirstSeen[String(r.id)]) / 1000),
                            ),
                            'thresholdSecs=', intervalSecs * 2,
                            'lockedSats=', lockedSats,
                        );
                    }
                } else {
                    setArkRefreshStuck(null);
                }
            } else {
                // No pending rounds at all → nothing stuck.
                setArkRefreshStuck(null);
            }

            // In-flight LN receives: pay-only entries (hasHtlcVtxos === true)
            // are the gap state — money landed at the ASP, but the round
            // that condenses it into a VTXO hasn't run yet. Surface to
            // zustand so ArkCapsules can render a ghost capsule and
            // ArkHistory can flag the corresponding "successful" row as
            // still claiming. Drop unpaid invoices (both flags false) so
            // a stale invoice the user generated days ago doesn't masquerade
            // as an in-flight claim.
            const inFlight = pendingLnReceives.filter((r) => r.hasHtlcVtxos);
            if (inFlight.length > 0) {
                console.log(
                    '[Ark sync] pending LN receives in-flight:',
                    inFlight.map(
                        (r) =>
                            `${r.amountSats}sats preimage=${r.preimageRevealed} hash=${r.paymentHash.slice(0, 12)}…`,
                    ),
                );
            }
            setArkPendingLnReceives(inFlight);

            // Activity log: diff Ark movements for newly-settled LN
            // receives. Reads local SQLite (cheap), first-sync suppresses
            // historical movements, failure non-fatal.
            try {
                await processArkMovementsForActivity();
            } catch (diffErr) {
                if (__DEV__) console.warn('[Activity] ark movements diff failed:', diffErr);
            }

            // Update the idle-skip counter based on what this tick saw.
            // Both balance and vtxo list have to be empty for us to count
            // the tick as "idle"; non-zero in either resets the counter
            // immediately so the next tick syncs against the ASP again.
            const isEmpty =
                (!balance || balance.totalSats === 0) &&
                (!vtxos || vtxos.all.length === 0);
            if (isEmpty) {
                consecutiveEmptyTicks.current += 1;
            } else {
                consecutiveEmptyTicks.current = 0;
            }
            // tip is allowed to be null (esplora offline / network flake) —
            // leave the previous value in place rather than clearing.
            if (tip !== null) {
                setArkChainTipHeight(tip);
            }
            setArkLastSyncedAt(Date.now());
            setLastError(null);

            // --- Push soonest-expiry to the relay (fire-and-forget) ---
            //
            // The relay's silent-push scanner uses this to decide when
            // to fire ark.refresh.due wakes. We POST only when the user
            // has opted into background refresh — non-opted-in users
            // shouldn't generate relay traffic from this code path.
            //
            // Compute the soonest expiry locally rather than asking the
            // SDK because the same math (skip arkoor, skip Locked) is
            // already used in ArkWallet/index.tsx for the in-app banner;
            // duplicating it inline is cheaper than introducing a
            // dependency cycle.
            const state = useAuthStore.getState();
            // VTXOs the user has explicitly told us NOT to auto-refresh —
            // via the Arkoor-receive popup's "Use immediately" path. Without
            // this gate, picking "Use immediately" is a lie: auto-refresh
            // hits the urgency threshold a few seconds later and grabs the
            // VTXO anyway, locking the funds into a round. Status
            // 'pending' is included for the brief window between
            // movementWatcher pushing the entry and the user tapping a
            // button, so the race-winner is the user, not the scheduler.
            const promptState = state.arkArkoorPromptState ?? {};
            const deferredIds = new Set<string>();
            for (const [id, entry] of Object.entries(promptState)) {
                if (entry.status === 'pending' || entry.status === 'dismissed') {
                    deferredIds.add(id);
                }
            }
            let minBlocks = Infinity;
            if (tip !== null && vtxos) {
                for (const v of vtxos.spendable) {
                    if (v.expiryHeight === 0) continue;
                    if (v.state.toLowerCase() === 'locked') continue;
                    // User-deferred — skip so the urgency sweep doesn't
                    // try to refresh a VTXO the user said to leave alone.
                    if (deferredIds.has(v.id)) continue;
                    const blocks = v.expiryHeight - tip;
                    // Skip already-expired VTXOs. Including them would make
                    // the lazy-refresh sweep fire on dead funds (refresh
                    // hangs because the ASP can sweep at any time past
                    // expiry — observed 2026-05-16 on a sim that was offline
                    // for 3+ days). The sweep should react to the
                    // next-most-urgent SPENDABLE-IN-PRACTICE VTXO, not to
                    // already-lost ones.
                    if (blocks <= 0) continue;
                    if (blocks < minBlocks) minBlocks = blocks;
                }
            }

            // --- Lazy-refresh sweep ---
            //
            // Fires runBackgroundRefresh('foreground') only when a
            // spendable, non-arkoor VTXO is within URGENCY_THRESHOLD_DAYS
            // of expiry. Replaces the old movement-watcher arrival path
            // that triggered on every LN receive — that strategy locked
            // funds for ~1h within minutes of arrival and hammered the
            // ASP during flake periods. Lazy refresh lets fresh receives
            // stay spendable for days (Lightning-like UX) and only spends
            // refresh fees / takes round-locking risk near expiry.
            //
            // The JS-side FOREGROUND_SWEEP_MIN_GAP_MS guard prevents
            // every 30s tick from invoking the orchestrator and writing
            // a rate_limited telemetry entry. The orchestrator's own
            // success rate-limit still applies.
            if (
                state.arkBgRefreshEnabled &&
                isFinite(minBlocks) &&
                minBlocks < URGENCY_THRESHOLD_BLOCKS &&
                Date.now() - lastForegroundSweepAt > FOREGROUND_SWEEP_MIN_GAP_MS
            ) {
                lastForegroundSweepAt = Date.now();
                console.log(
                    '[Ark sync] urgency sweep firing — minBlocks=', minBlocks,
                    'threshold=', URGENCY_THRESHOLD_BLOCKS,
                );
                void runBackgroundRefresh('foreground').catch((err) => {
                    console.warn('[Ark sync] foreground sweep threw:', err?.message ?? err);
                });
            }

            // --- Auto-backup (fire-and-forget, off the critical path) ---
            //
            // After every successful sync the datadir reflects current wallet
            // state. We write an encrypted snapshot to AUTO_BACKUP_PATH in
            // Documents so the user's funds are recoverable even if they never
            // tap "Back up wallet state" manually.
            //
            // We do NOT await this — backup takes ~0.5-1s (file reads + AES)
            // and must not stall the sync cycle or block the UI. The backup
            // runs concurrently; the next sync tick starts fresh either way.
            //
            // We use getCachedArkMnemonic() rather than hitting Keychain so
            // there is no biometric prompt during a background tick. The seed
            // was cached in walletHandle when the wallet was opened.
            // Run the auto-backup on every successful sync tick. We used to
            // guard this with a (balance, vtxo count, tip) signature
            // comparison to skip "no-op" writes, but that comparison can't
            // see SDK-internal mutations — most importantly the Lightning
            // preimage that `bolt11Invoice()` writes to Bark's SQLite without
            // moving any user-visible field. On 2026-05-06 a 100-sat in-flight
            // HTLC was lost when the user uninstalled between invoice
            // creation and the next user-visible state change; the .cbark
            // on disk and on Drive/SAF didn't have the preimage because the
            // signature said "unchanged" and the backup never ran.
            //
            // The encrypt step now runs on the native thread (see backup.ts)
            // and the Drive + SAF mirrors are best-effort fire-and-forget,
            // so unconditional re-backup is cheap on every interval.
            const mnemonic = getCachedArkMnemonic();
            if (mnemonic) {
                writeArkAutoBackup(mnemonic)
                    .then(({ path, iCloudPath, sizeBytes, createdAt }) => {
                        setArkLastBackupAt(createdAt);
                        if (__DEV__) {
                            // Auto-backup now writes BOTH the local sandbox
                            // and (on iOS w/ iCloud Drive) the iCloud
                            // container in the same tick. Log both so the
                            // destinations are explicit. iCloudPath is null
                            // on Android, or on iOS when iCloud is off /
                            // the mirror write failed (silent-fail per the
                            // auto-backup contract).
                            console.log(
                                '[Ark auto-backup] wrote',
                                (sizeBytes / 1024).toFixed(1),
                                'KB · local=', path,
                                '· iCloud=', iCloudPath ?? '(skipped)',
                            );
                        }
                    })
                    .catch((err) => {
                        // Swallow — auto-backup is best-effort. The user still
                        // has the manual "Back up wallet state" button. A
                        // failure here is typically a filesystem issue (low
                        // storage) or a concurrent write; it won't repeat
                        // indefinitely since the next successful sync retries.
                        if (__DEV__) {
                            console.warn('[Ark auto-backup] failed:', err?.message ?? err);
                        }
                    });
            }
        } catch (err) {
            console.warn('[Ark] sync failed:', err);
            setLastError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            inFlight.current = false;
            setIsSyncing(false);
        }
    }, [
        setArkBalance,
        setArkBalanceDetail,
        setArkVtxos,
        setArkPendingLnReceives,
        setArkChainTipHeight,
        setArkLastSyncedAt,
        setArkLastBackupAt,
        arkExitInProgress,
        arkExitDestinationAddress,
        clearArkAuth,
        setArkExitInProgress,
        setArkExitDestinationAddress,
        setArkExitStartedAt,
    ]);

    // Primary driver: mount + interval. Restarts whenever auth flips on,
    // so the moment a wallet is created the first fetch fires.
    //
    // The handle-readiness gate inside `sync()` may return early if the
    // boot restore hasn't finished. Without a fast-retry the user would
    // wait up to INTERVAL_MS (60s on Android) for their balance after
    // first launch. So we also kick off a short polling loop on mount:
    // probe every 600ms for up to 15s, fire the sync the moment the
    // handle becomes ready, then stop polling. After the first
    // successful sync the interval driver takes over.
    useEffect(() => {
        if (!isArkAuth) return;
        void sync();

        // One-shot: round-cadence (`wallet.arkInfo().roundIntervalSecs`) is
        // server-side static config — fetch once per session as soon as the
        // handle is ready, store in zustand. Drives the upper-bound ETA on
        // "Refreshing… ≤Xm" labels in ArkCapsules. We can't show a real
        // countdown because the SDK doesn't expose `nextRoundAt`.
        const maybeFetchRoundInterval = () => {
            if (arkRoundIntervalSecs != null) return;
            void fetchArkRoundIntervalSecs().then((secs) => {
                if (secs != null) setArkRoundIntervalSecs(secs);
            });
        };
        maybeFetchRoundInterval();

        // Fast retry: catch the wallet handle the moment boot finishes.
        let pollTries = 0;
        const POLL_INTERVAL_MS = 600;
        const POLL_MAX_TRIES = 25; // 25 * 600ms = 15s ceiling
        const fastPollId = setInterval(() => {
            pollTries += 1;
            if (getArkWalletHandle()) {
                clearInterval(fastPollId);
                void sync();
                maybeFetchRoundInterval();
            } else if (pollTries >= POLL_MAX_TRIES) {
                clearInterval(fastPollId);
            }
        }, POLL_INTERVAL_MS);

        const id = setInterval(() => {
            void sync();
        }, INTERVAL_MS);
        return () => {
            clearInterval(id);
            clearInterval(fastPollId);
        };
    }, [isArkAuth, sync, arkRoundIntervalSecs, setArkRoundIntervalSecs]);

    // Foreground kick — refresh the moment the user returns to the app,
    // regardless of where the interval is in its cycle.
    useEffect(() => {
        if (!isArkAuth) return;
        const onChange = (status: AppStateStatus) => {
            if (status === 'active') void sync();
        };
        const sub = AppState.addEventListener('change', onChange);
        return () => sub.remove();
    }, [isArkAuth, sync]);

    // Auto-clear the iOS backup-snapshot reminder when iCloud Drive
    // becomes available for Cypher Box. The flag is set at create time
    // when the user satisfied the gate via manual share+confirm; it
    // stays on while iCloud isn't reachable. As soon as the user enables
    // iCloud Drive for the app in iOS Settings (or signs back into iCloud,
    // or comes back online), the auto-tick has a verifiable off-device
    // channel and the reminder no longer applies — flipping it off lets
    // the persistent banners disappear without the user having to dig
    // into Settings → Ark Backup to dismiss manually.
    //
    // Probes on mount, on every AppState→active, and once per sync tick.
    // The native call is cheap (no mkdir, just URLForUbiquityContainerIdentifier
    // → Bool). Skipped on Android and on iOS when the flag is already
    // false. One-way: the flag never re-arms here (only the create flow
    // sets it true).
    useEffect(() => {
        if (Platform.OS !== 'ios' || !isArkAuth) return;
        let cancelled = false;
        const probe = async () => {
            const flagOn = useAuthStore.getState().arkIosBackupReminderActive;
            if (!flagOn) return;
            try {
                const ok = await isICloudBackupAvailable();
                if (!cancelled && ok) {
                    useAuthStore.getState().setArkIosBackupReminderActive(false);
                    if (__DEV__) console.log('[Ark backup] iCloud verified — reminder auto-cleared');
                }
            } catch {
                // Probe failure → leave the flag alone, banner stays up.
            }
        };
        void probe();
        const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
            if (status === 'active') void probe();
        });
        return () => {
            cancelled = true;
            sub.remove();
        };
    }, [isArkAuth]);

    return { isSyncing, lastError, refresh: sync };
}
