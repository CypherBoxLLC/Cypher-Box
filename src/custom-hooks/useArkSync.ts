import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';

import {
    applyExpiredVtxoFilter,
    ARK_ARKOOR_ASSUMED_DAYS,
    AVG_BLOCK_MINUTES,
    cancelArkPendingRound,
    cancelVtxoExpiryWarnings,
    cancelVtxoStuckSwapWarnings,
    claimArkExitsToAddress,
    fetchClaimFeeRateSatPerVb,
    getArkCancelling,
    setArkCancelling,
    fetchArkBalance,
    fetchArkPendingLightningReceives,
    fetchArkPendingRoundStates,
    fetchArkRoundIntervalSecs,
    fetchArkVtxos,
    fetchChainTipHeight,
    fetchArkExitVtxos,
    fetchClaimableExitVtxos,
    fetchPendingExitsTotalSats,
    getArkWalletHandle,
    getCachedArkMnemonic,
    barkStateTag,
    isActiveExit,
    isICloudBackupAvailable,
    maybeSweepDueArkVtxos,
    progressArkExits,
    progressArkPendingRounds,
    reopenArkWalletFromCache,
    scheduleVtxoExpiryWarnings,
    scheduleVtxoStuckSwapWarnings,
    syncArkExits,
    syncArkWallet,
    tryClaimArkLightningReceives,
    driveArkPendingLightningSends,
    writeArkAutoBackup,
} from '@Cypher/services/ark';
import { processArkMovementsForActivity } from '@Cypher/services/ark/movementsActivity';
// Imported from the file path directly (not the @Cypher/services/ark
// barrel) — the barrel doesn't re-export the expiry module.
import { formatBlocksUntil } from '@Cypher/services/ark/expiry';
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

// Urgency threshold for the refresh-failure escalation: a spendable VTXO
// this close to expiry, together with a run of failed manual refreshes,
// triggers the blocking rescue Alert below. This used to also gate the
// automatic foreground refresh sweep, which has been removed.
const URGENCY_THRESHOLD_DAYS = 2;
const URGENCY_THRESHOLD_BLOCKS = Math.round(
    (URGENCY_THRESHOLD_DAYS * 24 * 60) / AVG_BLOCK_MINUTES,
);

// --- Refresh-failure escalation near expiry --------------------------------
//
// The expiry-warning notifications cover "time is running out" and the
// stuck-refresh banner covers "a round is wedged". Neither covers the
// failure mode that actually lost user funds (support case 2026-07-11):
// every refresh SUBMISSION fails outright (infra outage, IP-blocked
// esplora, captive portal) while the expiry clock runs down — 12+ failed
// rounds over 3 days with under 2 days left, and the app never raised
// its voice. Once this many consecutive submissions have failed
// (arkRefreshFailStreak, maintained in services/ark/refresh.ts across
// every refresh path) AND a spendable VTXO is inside the urgency window,
// a blocking Alert surfaces the rescue playbook in the order that works
// in practice: switch networks and retry, then Emergency Exit while
// there is still time. Re-shown at most once per gap window so the sync
// tick doesn't nag while the user is following the steps.
const REFRESH_FAIL_ESCALATE_STREAK = 3;
const REFRESH_FAIL_ALERT_GAP_MS = 6 * 60 * 60 * 1000;

// --- Stuck-refresh swap-out window + auto-cancel safety net ----------------
//
// When a round is detected stuck (useArkSync flags it past 2x the round
// interval) AND its Locked VTXOs are inside this window of their pre-refresh
// expiry, the UX escalates from "cancel & retry the refresh" to "move your
// funds out": swap-out notifications are scheduled and the in-app banners
// route to ArkStuckCapsuleScreen. 24h gives a full day of runway for the
// cooperative swap-out or exit before the funds expire, so a stuck round this
// close to expiry surfaces the escape hatch rather than just a cancel prompt.
const STUCK_SWAP_WINDOW_MS = 24 * 60 * 60 * 1000;
// Auto-cancel safety net: once a stuck round's Locked funds are inside this
// window of expiry, cancel the wedged round automatically so the VTXOs unlock
// with enough runway for the user to still swap / exit before the deadline.
// Cancelling only unlocks the inputs (per Erik / Bark), it never spends, so
// this is safe to do without user confirmation. Bam approved this net.
const STUCK_AUTO_CANCEL_MS = 3 * 60 * 60 * 1000;

// Module-level throttle for the auto-cancel net so a 30s sync tick doesn't
// hammer cancelPendingRound while a round settles server-side.
let arkAutoCancelInFlight = false;
let lastArkAutoCancelAt = 0;
const ARK_AUTO_CANCEL_MIN_GAP_MS = 5 * 60 * 1000;

/**
 * Cancel the given stuck round(s) automatically, then sync so the just-
 * unlocked VTXOs re-read as Spendable. Guarded + throttled + respects the
 * shared `cancelling` flag so it never races a user-initiated cancel or the
 * banner's cancel-and-retry. Per-round failures are swallowed (the round may
 * already be finalising server-side, in which case the next sync ingests it).
 */
async function maybeAutoCancelStuckRounds(roundIds: number[]): Promise<void> {
    if (!roundIds || roundIds.length === 0) return;
    if (arkAutoCancelInFlight) return;
    if (Date.now() - lastArkAutoCancelAt < ARK_AUTO_CANCEL_MIN_GAP_MS) return;
    // Don't fight a user-initiated cancel (banner cancel-and-retry sets this).
    if (getArkCancelling()) return;
    arkAutoCancelInFlight = true;
    lastArkAutoCancelAt = Date.now();
    setArkCancelling(true);
    try {
        for (const id of roundIds) {
            try {
                await cancelArkPendingRound(id);
            } catch {
                // cancelArkPendingRound already logs the inner BarkError.
                // Swallow so one refused round doesn't block the others.
            }
        }
        try {
            await syncArkWallet();
        } catch (syncErr: any) {
            if (__DEV__) console.warn('[Ark auto-cancel] post-cancel sync failed:', syncErr?.message ?? syncErr);
        }
        if (__DEV__) console.warn('[Ark auto-cancel] cancelled stuck rounds near expiry:', roundIds);
    } finally {
        setArkCancelling(false);
        arkAutoCancelInFlight = false;
    }
}

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
    const setArkScheduledStuckSwapNotifs = useAuthStore((s) => s.setArkScheduledStuckSwapNotifs);
    const setArkPendingLnReceives = useAuthStore((s) => s.setArkPendingLnReceives);
    const setArkChainTipHeight = useAuthStore((s) => s.setArkChainTipHeight);
    const setArkLastSyncedAt = useAuthStore((s) => s.setArkLastSyncedAt);
    const setArkLastBackupAt = useAuthStore((s) => s.setArkLastBackupAt);
    const arkRoundIntervalSecs = useAuthStore((s) => s.arkRoundIntervalSecs);
    const setArkRoundIntervalSecs = useAuthStore((s) => s.setArkRoundIntervalSecs);
    const arkExitInProgress = useAuthStore((s) => s.arkExitInProgress);
    const arkExitDestinationAddress = useAuthStore((s) => s.arkExitDestinationAddress);
    const setArkExitInProgress = useAuthStore((s) => s.setArkExitInProgress);
    const setArkExitDestinationAddress = useAuthStore((s) => s.setArkExitDestinationAddress);
    const setArkExitStartedAt = useAuthStore((s) => s.setArkExitStartedAt);
    const arkExitDrained = useAuthStore((s) => s.arkExitDrained);
    const setArkExitDrained = useAuthStore((s) => s.setArkExitDrained);
    const arkExitStartedAt = useAuthStore((s) => s.arkExitStartedAt);
    const setArkExitStartedSats = useAuthStore((s) => s.setArkExitStartedSats);

    const [isSyncing, setIsSyncing] = useState(false);
    const [lastError, setLastError] = useState<Error | null>(null);

    // Guard against overlapping fetches: if a previous sync is still
    // in-flight when the interval fires, skip the new one. This also means
    // a slow esplora round-trip doesn't stack up calls behind it.
    const inFlight = useRef(false);
    // Last wall-clock ms the exit machinery (progressExits/syncExits) ran.
    // Drives the ~2 min exit-drive throttle — see the exit block below.
    const exitDriveLastRunMsRef = useRef(0);
    // Counter used by the idle-skip heuristic. Increments every cycle that
    // returns balance=0 and vtxos.all.length=0; resets the moment either
    // turns non-zero. We use this to avoid the 2s Bark `syncArkWallet`
    // call when the wallet has nothing to settle.
    const consecutiveEmptyTicks = useRef(0);
    // Last earliest-expiry (epoch ms) POSTed to GroundControl's /arkExpiry.
    // Memoizes the fire-and-forget registration so the 30s sync tick only
    // re-POSTs when the earliest expiry actually moves (see below). 0 = a
    // "no live capsules" clear was the last thing sent (or nothing yet).
    const lastGcArkExpiryRef = useRef(0);

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
            // Exit self-heal: bark's own DB is the source of truth for an
            // in-flight exit, not our zustand flag. The flag can be lost
            // while the exit txs live on-chain (observed: a stale bundle's
            // older guard cleared it mid-broadcast; also possible via
            // backup-restore onto a device that never had the flag). If the
            // flag is off but bark holds active exit records, re-arm so the
            // drive block below resumes progressing + claiming. Destination
            // backfill (ArkExitBackfill) re-derives the payout address when
            // it's missing, so claim still lands in the user's Hot Vault.
            if (!arkExitInProgress) {
                try {
                    const orphanExits = await fetchArkExitVtxos();
                    // bark 0.6.1: exit `state` is a tagged-enum object; the
                    // not-terminal liveness check re-arms the drive for any
                    // in-flight exit (incl. the new Start / ClaimInProgress).
                    const activeOrphans = orphanExits.filter((v) => isActiveExit(v));
                    if (activeOrphans.length > 0) {
                        console.warn(
                            '[Ark exit] found', activeOrphans.length,
                            'in-flight exit vtxo(s) in bark DB with no in-progress flag — re-arming exit drive',
                        );
                        setArkExitInProgress(true);
                        // Let the next tick run the full drive block with the
                        // re-armed flag (this tick's closure still sees the
                        // stale false).
                        return;
                    }
                } catch {
                    // Handle closed or read failed — nothing to heal this tick.
                }
            }

            // Exit lifecycle. HARD-WON (2026-07-31, wallet deleted mid-exit,
            // twice): the SDK's `pendingExitsTotalSats()` returns 0 even
            // while exit txs are actively broadcasting (per-VTXO state
            // `Processing(…)`), so "0 pending && 0 claimable" is NOT a
            // completion signal — it's also the mid-broadcast state AND the
            // never-materialised state. Liveness must come from the per-VTXO
            // exit records (`getExitVtxos`): Processing/claimable = ACTIVE.
            // Completion (funds drained, nothing active) just retires the
            // exit flags — the vault is NEVER auto-deleted (see the
            // completion branch below).
            if (arkExitInProgress) {
                // Throttle: every progressExits/syncExits pass hits esplora
                // (tip retrieval + tx status). At the 30s sync cadence that
                // burned Blockstream's unauthenticated 700 req/h/IP cap
                // mid-exit (429s, observed live). Block time is ~10 min, so
                // driving the exit machinery every ~2 min loses nothing and
                // cuts the esplora load 4x. Skipped ticks do nothing at all
                // (normal sync stays skipped while an exit is running).
                const nowMs = Date.now();
                if (nowMs - exitDriveLastRunMsRef.current < 120_000) {
                    _stamp('exit drive skipped (throttle)');
                    return;
                }
                exitDriveLastRunMsRef.current = nowMs;
                try {
                    // Sync the wallet FIRST. The normal sync path below is
                    // skipped during an exit, so without this bark's on-chain
                    // (BDK) wallet and chain tip go stale across app
                    // restarts — and progressExits then tries to fund the
                    // next CPFP child from already-spent coins, silently
                    // failing to broadcast forever (observed live: leaf stuck
                    // in AwaitingCpfpBroadcast with tip frozen 129 blocks
                    // behind). The board pipeline inside syncArkWallet is
                    // exit-aware (holds funds while arkExitInProgress), so
                    // this is safe to run mid-exit.
                    try {
                        await syncArkWallet();
                        _stamp('exit: syncArkWallet done');
                    } catch (syncErr: any) {
                        console.warn('[Ark exit] pre-drive wallet sync failed (continuing):', syncErr?.message ?? syncErr);
                    }
                    const progressResult = await progressArkExits();
                    _stamp('progressArkExits done');
                    // Diagnostic: the per-VTXO progress payload is the only
                    // signal of WHERE the state machine is (build?
                    // broadcast? awaiting confs?). Serialize defensively;
                    // UniFFI objects can carry bigints.
                    try {
                        console.log(
                            '[Ark exit] progressExits result:',
                            JSON.stringify(progressResult, (_, v) =>
                                typeof v === 'bigint' ? Number(v) : v),
                        );
                    } catch { /* diagnostic only */ }
                    await syncArkExits();
                    _stamp('syncArkExits done');

                    const claimable = await fetchClaimableExitVtxos();
                    _stamp(`fetchClaimableExitVtxos: ${claimable.length} ready`);
                    if (claimable.length > 0 && arkExitDestinationAddress) {
                        // claimArkExitsToAddress now finalizes AND broadcasts the
                        // claim (drainExits alone only builds a PSBT). Gate
                        // arkExitDrained on a real broadcast txid: a non-throwing
                        // return is NOT proof the funds left, and treating it as
                        // such pinned the exit "active" forever (the claim VTXO
                        // stayed claimable because nothing was ever relayed).
                        let claimRateForLog = 0;
                        try {
                            // Price the claim explicitly. Passing undefined lets
                            // bark pick, and it picks for speed: observed live
                            // bidding 779 sats to sweep a 698 sat output, which
                            // it then refuses to build. The claim races nothing
                            // once the CSV has matured, and its fee comes out of
                            // the claimed value, so the 1-hour rate is correct
                            // and "fastest" is actively harmful.
                            const claimRate = await fetchClaimFeeRateSatPerVb();
                            claimRateForLog = claimRate;
                            const claim = await claimArkExitsToAddress(
                                arkExitDestinationAddress,
                                BigInt(claimRate),
                            );
                            if (claim.txid) {
                                _stamp(
                                    `exit claim broadcast txid=${claim.txid} fee=${claim.feeSats} sats`,
                                );
                                setArkExitDrained(true);
                            } else {
                                _stamp('exit claim returned no txid, NOT marking drained');
                            }
                        } catch (claimErr: any) {
                            // Sign/extract/broadcast failed. Leave arkExitDrained
                            // as-is so the next cycle retries; the claim VTXO
                            // stays listClaimableExits()-visible until the tx
                            // actually lands, which is the correct retry gate.
                            // "Claim Fee Exceeds Output" is not a transient
                            // failure and retrying identically cannot fix it:
                            // the capsule is worth less than it costs to sweep
                            // at the current rate. Name it, so it is not just
                            // an anonymous warning repeating every drive tick.
                            const msg = String(claimErr?.message ?? claimErr);
                            if (/Claim Fee Exceeds Output/i.test(msg)) {
                                console.warn(
                                    '[Ark exit] claim UNECONOMIC at',
                                    claimRateForLog, 'sat/vB:', msg,
                                    '- will retry, but this cannot clear until the fee rate drops or more capsules ripen and batch.',
                                );
                            } else {
                                console.warn(
                                    '[Ark exit] claim sweep failed (will retry next cycle):',
                                    msg,
                                );
                            }
                        }
                    }

                    // Per-VTXO liveness (the authoritative signal — see the
                    // block comment above). `pendingTotal` is kept only as a
                    // belt-and-suspenders OR-term in case a future SDK
                    // version starts counting something we don't model.
                    const exitVtxos = await fetchArkExitVtxos();
                    // bark 0.6.1: count in-flight exits by the not-terminal
                    // check so we never under-count active exits, which would
                    // retire an exit early (the mid-exit wallet-deletion bug).
                    const activeExitCount = exitVtxos.filter((v) => isActiveExit(v)).length;
                    console.log(
                        '[Ark exit] exit vtxos:',
                        exitVtxos.length,
                        exitVtxos.map((v) =>
                            `${String(v.vtxoId).slice(0, 8)}… state=${barkStateTag(v.state)} claimable=${v.isClaimable} sats=${Number(v.amountSats)}`,
                        ).join(' | '),
                    );
                    const pendingTotal = await fetchPendingExitsTotalSats();
                    const stillClaimable = await fetchClaimableExitVtxos();
                    const exitActive =
                        activeExitCount > 0 ||
                        stillClaimable.length > 0 ||
                        exitVtxos.some((v) => v.isClaimable) ||
                        pendingTotal > 0;

                    // Keep the UI truthful during the exit. The normal sync
                    // path below is SKIPPED while an exit is in progress
                    // (early return), which used to freeze the store on the
                    // pre-exit snapshot: capsule rendered green/spendable and
                    // the balance card kept its old total for the entire
                    // ~24h+ exit. Refresh vtxos + balance here with the same
                    // filter pipeline as the normal path, so the `exiting`
                    // row flags and the zeroed spendable actually reach the
                    // UI (and the send gate's store checks stay current).
                    try {
                        const uiVtxos = await fetchArkVtxos();
                        if (uiVtxos) setArkVtxos(uiVtxos.spendable);
                        const uiBalance = await fetchArkBalance();
                        const uiTip = useAuthStore.getState().arkChainTipHeight;
                        const uiFiltered = uiBalance
                            ? applyExpiredVtxoFilter(uiBalance, uiVtxos?.all, uiTip)
                            : null;
                        if (uiFiltered) {
                            setArkBalance(uiFiltered.totalSats);
                            setArkBalanceDetail(uiFiltered);
                        }
                    } catch (uiErr: any) {
                        console.warn('[Ark exit] mid-exit store refresh failed:', uiErr?.message ?? uiErr);
                    }

                    // Keep the backup fresh DURING the exit too. The normal
                    // sync path below (which runs the auto-backup) is skipped
                    // while an exit is in progress, so without this the local
                    // .cbark stops updating and arkLastBackupAt goes stale for
                    // the whole ~24h+ exit: the capsule reads "not backed up"
                    // and a mid-exit recover would restore a pre-exit snapshot.
                    // The datadir now carries the exit state, so a snapshot here
                    // is exactly what a mid-exit recovery needs to resume. Runs
                    // after this tick's exit drive (progress/drain/sync already
                    // completed above), so no datadir contention. Same
                    // fire-and-forget contract as the normal-path backup:
                    // getCachedArkMnemonic() (no biometric), never awaited,
                    // errors swallowed.
                    const exitBackupMnemonic = getCachedArkMnemonic();
                    if (exitBackupMnemonic) {
                        writeArkAutoBackup(exitBackupMnemonic)
                            .then(({ createdAt }) => setArkLastBackupAt(createdAt))
                            .catch((err) => {
                                if (__DEV__) console.warn('[Ark auto-backup] mid-exit backup failed:', err?.message ?? err);
                            });
                    }

                    if (exitActive) {
                        // Exit txs are live (broadcasting / awaiting confs /
                        // awaiting CSV). Keep the flag set and keep driving —
                        // NO timeout applies to a live exit (it legitimately
                        // spans ~24h of confirmations + timelock).
                        console.log(
                            '[Ark exit] active —',
                            activeExitCount, 'active,',
                            stillClaimable.length, 'claimable,',
                            pendingTotal, 'sats pending',
                        );
                    } else if (!arkExitDrained) {
                        // Nothing active and nothing was ever drained: either
                        // the start produced no exit txs at all, or every
                        // record is in a state we don't recognise (log above
                        // shows which). Grace window: give bark a few cycles
                        // to materialise the txs (esplora flakiness, fee
                        // estimation) before declaring the exit dead. Then
                        // clear the flag — NEVER delete on this path.
                        const elapsedMs = Date.now() - (arkExitStartedAt ?? 0);
                        const EXIT_MATERIALISE_GRACE_MS = 10 * 60 * 1000;
                        if (arkExitStartedAt && elapsedMs < EXIT_MATERIALISE_GRACE_MS) {
                            console.log(
                                '[Ark exit] nothing active yet — still trying,',
                                Math.round(elapsedMs / 1000) + 's elapsed of',
                                Math.round(EXIT_MATERIALISE_GRACE_MS / 1000) + 's grace',
                            );
                        } else {
                            console.warn('[Ark exit] no exit ever materialised (nothing active, never drained, grace expired) — clearing exit-in-progress WITHOUT deleting the vault');
                            setArkExitInProgress(false);
                            setArkExitDestinationAddress(null);
                            setArkExitStartedAt(null);
                            setArkExitStartedSats(null);
                        }
                    } else {
                        // Exit complete: funds drained to the destination and
                        // nothing is active any more. The vault is KEPT — an
                        // exit empties a wallet, it doesn't end it (identity,
                        // history, and receive ability all stay valid, and
                        // funds can even arrive mid-exit). Deleting here
                        // turned every completion-detection bug into fund
                        // loss, so auto-delete is gone entirely; the manual
                        // "Delete Ark vault" flow exists for when the user
                        // actually wants the vault removed.
                        console.log('[Ark exit] complete — funds swept; vault kept');
                        const correlationId = await getArkExitCorrelationId();
                        if (correlationId) {
                            recordEvent({
                                kind: 'ark-exit-finished',
                                correlationId,
                                result: 'success',
                            });
                            await setArkExitCorrelationId(null);
                        }
                        setArkExitInProgress(false);
                        setArkExitDestinationAddress(null);
                        setArkExitStartedAt(null);
                        setArkExitStartedSats(null);
                        setArkExitDrained(false);
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

            // Drive forward any pending OUTGOING Lightning sends too. The
            // 0.11.3 crash-safe send model needs someone polling
            // checkLightningPayment or an abandoned send locks its sats in
            // pendingLnSend until HTLC block expiry (hours). No-op when
            // nothing is pending.
            await driveArkPendingLightningSends();
            _stamp('driveArkPendingLightningSends done');

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

            // bark 0.6.0: mid-refresh VTXOs stay `Spendable`, so the client
            // tracks the submitted refresh ids itself (authStore
            // arkRefreshingVtxoIds) to drive the per-capsule "Refreshing"
            // animation. Prune them here: drop ids no longer in the wallet
            // (refreshed away, or spent by the user before the round ran), and
            // clear everything once nothing is left in a pending round.
            {
                const s = useAuthStore.getState();
                const tracked = s.arkRefreshingVtxoIds;
                if (tracked.length > 0) {
                    // Prune ONLY when the VTXO leaves the wallet (refreshed away
                    // or spent by the user). Do NOT prune on
                    // pendingInRoundSats === 0: bark reflects the round in the
                    // balance seconds-to-minutes AFTER the submission, and
                    // clearing during that lag drops the id before the animation
                    // ever shows.
                    const present = new Set((vtxos?.spendable ?? []).map((v) => v.id));
                    const next = tracked.filter((id) => present.has(id));
                    if (next.length !== tracked.length) {
                        s.setArkRefreshingVtxoIds(next);
                    }
                }
            }
            if (vtxos) {
                // Past-expiry VTXOs stay IN the list. The SDK reports them
                // as Spendable until the ASP actually sweeps them; they
                // can't join a refresh round (the ASP rejects expired
                // inputs) and the funds are effectively lost. An earlier
                // iteration filtered them out here, which made a wallet
                // whose only capsule expired read as an unexplained zero
                // balance with an empty Capsules tab (real support case,
                // 2026-07-11: a 1000-sat VTXO expired during an infra
                // outage and the app showed nothing at all). The Capsules
                // tab now renders them as a greyed non-actionable
                // "Expired" row with an explainer; the headline balance
                // still excludes their sats via applyExpiredVtxoFilter
                // above. Consumers that ACT on VTXOs (refresh batches,
                // urgency sweep, dust consolidation, expiry warnings)
                // each skip expiryHeight <= tip themselves.
                const expiredCount =
                    typeof tip === 'number'
                        ? vtxos.spendable.filter(
                              (v) => v.expiryHeight !== 0 && v.expiryHeight <= tip,
                          ).length
                        : 0;
                console.log(
                    '[Ark sync] writing',
                    vtxos.spendable.length,
                    'vtxos to store (of',
                    vtxos.all.length,
                    'total;',
                    expiredCount,
                    'past expiry)',
                );
                setArkVtxos(vtxos.spendable);

                // Foreground maintenance sweep: refresh in-band (28h..1week to
                // expiry, above-dust) VTXOs — regular and arkoor — so nothing
                // refreshable is silently lost. Fire-and-forget: it manages its
                // own pacing + in-flight guard, skips while a round is
                // ongoing/stuck, and respects the exit-runway floor. Always-on
                // in foreground; safe on the delegated (non-locking) path. See
                // services/ark/foregroundSweep.ts.
                void maybeSweepDueArkVtxos(vtxos.spendable, tip);
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

                // GroundControl silent-push registration: tell the server
                // the EARLIEST live expiry so its scheduler can wake us
                // with an { arkMaintenance: 1 } content-available push
                // while there's still runway (server policy decides the
                // offsets). Follows the reminders toggle: when it's off we
                // send one clearing 0 (the push would no-op anyway — the
                // bg seed is deleted on disable — but don't make the
                // server wake us for nothing). Re-POSTs only when the
                // earliest moves by >1h (refresh landed / capsule set
                // changed), not every 30s tick.
                // Arkoor VTXOs must be included here even though they are
                // absent from `nextScheduled`. They report expiryHeight 0
                // (the SDK does not surface the ASP's trust window), so the
                // loop above skips them, which used to leave the shortest-
                // lived funds in the wallet as the ONLY ones the server was
                // never asked to wake us for. Their deadline is already known
                // and persisted: useArkoorReceivePrompt schedules local
                // warnings off `observedAt + ARK_ARKOOR_ASSUMED_DAYS` and
                // stores it in arkArkoorPromptState. Reuse that same assumed
                // deadline here so the background wake covers them too.
                //
                // Registration only. Local reminder scheduling stays entirely
                // with useArkoorReceivePrompt (it already works, and driving
                // it from two places would fight over cancellation).
                const arkoorPromptState = useAuthStore.getState().arkArkoorPromptState ?? {};
                const arkoorDeadlines: number[] = [];
                for (const v of vtxos.spendable) {
                    if (v.expiryHeight > 0) continue;
                    const entry = arkoorPromptState[v.id];
                    if (!entry?.observedAt) continue;
                    arkoorDeadlines.push(
                        entry.observedAt + ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000,
                    );
                }

                const gcExpiries = [...Object.values(nextScheduled), ...arkoorDeadlines];
                const gcEarliest = remindersOn && gcExpiries.length > 0
                    ? Math.min(...gcExpiries)
                    : 0;
                const gcChanged =
                    Math.abs(gcEarliest - lastGcArkExpiryRef.current) > 3_600_000 ||
                    (gcEarliest === 0) !== (lastGcArkExpiryRef.current === 0);
                if (gcChanged) {
                    lastGcArkExpiryRef.current = gcEarliest;
                    try {
                        // Lazy require: notifications.js is a JS singleton
                        // whose statics attach at App bootstrap; optional-
                        // chain in case this tick wins that race.
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        // .default is required: notifications.js is an ES
                        // module, so require() returns the module namespace and
                        // the statics hang off .default. Without it the
                        // optional call below silently no-ops, which is why
                        // the server was never told when a capsule expires.
                        const Notifications = require('../../blue_modules/notifications').default;
                        void Notifications.arkExpiryToGroundControl?.(gcEarliest);
                        if (__DEV__) {
                            console.log(
                                '[Ark sync] GroundControl expiry registration:',
                                gcEarliest === 0 ? 'cleared' : new Date(gcEarliest).toISOString(),
                            );
                        }
                    } catch (gcErr) {
                        if (__DEV__) console.warn('[Ark sync] GroundControl expiry registration failed:', gcErr);
                    }
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
                const lockedVtxos = (vtxos?.all ?? []).filter(
                    (v) => v.state.toLowerCase() === 'locked',
                );
                const lockedSats = lockedVtxos.reduce((sum, v) => sum + v.sats, 0);
                // nearExpiry: is any Locked VTXO inside the swap-out window of
                // its PRE-refresh expiry? A Locked VTXO's expiryHeight is the
                // pre-refresh leaf's expiry (the deadline the stuck round
                // failed to extend), so it IS the real "time left before these
                // funds are lost" clock (unlike a healthy round, where the
                // countdown is meaningless; the 2× stuck gate rules that out).
                // Drives the escalation from "cancel & retry" to "move funds
                // out" across the notifications + banners.
                const blockMsStuck = AVG_BLOCK_MINUTES * 60 * 1000;
                let soonestLockedMsLeft = Infinity;
                if (typeof tip === 'number') {
                    for (const v of lockedVtxos) {
                        if (v.expiryHeight <= 0) continue;
                        const msLeft = Math.max(0, v.expiryHeight - tip) * blockMsStuck;
                        if (msLeft < soonestLockedMsLeft) soonestLockedMsLeft = msLeft;
                    }
                }
                const stuckNearExpiry =
                    isFinite(soonestLockedMsLeft) && soonestLockedMsLeft <= STUCK_SWAP_WINDOW_MS;
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
                        nearExpiry: stuckNearExpiry,
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
                            'nearExpiry=', stuckNearExpiry,
                        );
                    }
                } else {
                    setArkRefreshStuck(null);
                }
            } else {
                // No pending rounds at all → nothing stuck.
                setArkRefreshStuck(null);
            }

            // --- Stuck-capsule swap-out notifications + auto-cancel net ---
            //
            // When a round is stuck AND its Locked funds are near expiry,
            // schedule the 12h/6h/3h "move your funds out" alarms (whose tap
            // routes to ArkStuckCapsuleScreen) and, once inside the 3h
            // auto-cancel window, cancel the wedged round so the funds unlock
            // with runway to still swap/exit. Reconciled like the expiry queue:
            // entries added while stuck+near, cancelled the moment a VTXO stops
            // qualifying (unlocked / round cleared / no longer near expiry).
            // Reads arkRefreshStuck fresh (just set above).
            if (vtxos && typeof tip === 'number') {
                const stuckNow = useAuthStore.getState().arkRefreshStuck;
                const prevSwap = useAuthStore.getState().arkScheduledStuckSwapNotifs;
                const nextSwap: Record<string, number> = {};
                if (stuckNow && useAuthStore.getState().arkBgRefreshEnabled) {
                    const blockMs2 = AVG_BLOCK_MINUTES * 60 * 1000;
                    const nowMs2 = Date.now();
                    let anyWithinAutoCancel = false;
                    for (const v of vtxos.all) {
                        if (v.state.toLowerCase() !== 'locked') continue;
                        if (v.expiryHeight <= 0) continue;
                        const expiryAtMs = nowMs2 + Math.max(0, v.expiryHeight - tip) * blockMs2;
                        const msLeft = expiryAtMs - nowMs2;
                        if (msLeft <= STUCK_SWAP_WINDOW_MS) {
                            nextSwap[v.id] = expiryAtMs;
                            if (prevSwap[v.id] == null) {
                                try {
                                    scheduleVtxoStuckSwapWarnings(v.id, expiryAtMs, v.sats);
                                    if (__DEV__) {
                                        console.log(
                                            '[Ark sync] scheduled swap-out warnings for',
                                            v.id.slice(0, 12),
                                            'expiry', new Date(expiryAtMs).toISOString(),
                                        );
                                    }
                                } catch (notifErr) {
                                    console.warn('[Ark sync] scheduleVtxoStuckSwapWarnings threw:', notifErr);
                                }
                            }
                        }
                        if (msLeft <= STUCK_AUTO_CANCEL_MS) anyWithinAutoCancel = true;
                    }
                    // Auto-cancel-at-3h safety net (Bam-approved): unlock the
                    // wedged round's inputs while there's still time to move out.
                    if (anyWithinAutoCancel && stuckNow.stuckRoundIds.length > 0) {
                        void maybeAutoCancelStuckRounds(stuckNow.stuckRoundIds);
                    }
                }
                // Cancel swap-out alarms for VTXOs that no longer qualify
                // (unlocked, round cleared, or no longer near expiry).
                for (const id of Object.keys(prevSwap)) {
                    if (nextSwap[id] == null) {
                        try {
                            cancelVtxoStuckSwapWarnings(id);
                        } catch (notifErr) {
                            console.warn('[Ark sync] cancelVtxoStuckSwapWarnings threw:', notifErr);
                        }
                    }
                }
                const prevSwapKeys = Object.keys(prevSwap);
                const nextSwapKeys = Object.keys(nextSwap);
                const swapChanged =
                    prevSwapKeys.length !== nextSwapKeys.length ||
                    nextSwapKeys.some((k) => prevSwap[k] !== nextSwap[k]);
                if (swapChanged) setArkScheduledStuckSwapNotifs(nextSwap);
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

            // --- Soonest spendable expiry (feeds the failure escalation) ---
            //
            // Soonest on-chain expiry among spendable, non-Locked VTXOs.
            // Automatic refresh has been removed, so this now feeds only the
            // refresh-failure escalation below; the user acts on approaching
            // expiry via the pre-scheduled OS warnings and manual refresh.
            const state = useAuthStore.getState();
            let minBlocksAnySpendable = Infinity;
            if (tip !== null && vtxos) {
                for (const v of vtxos.spendable) {
                    if (v.expiryHeight === 0) continue;
                    if (v.state.toLowerCase() === 'locked') continue;
                    const blocks = v.expiryHeight - tip;
                    // Skip already-expired VTXOs: they can't be refreshed (the
                    // ASP can sweep them at any time past expiry), so they must
                    // not drive the escalation toward already-lost funds.
                    if (blocks <= 0) continue;
                    if (blocks < minBlocksAnySpendable) minBlocksAnySpendable = blocks;
                }
            }

            // --- Automatic refresh: removed (2026-07-23) ---
            //
            // A foreground sweep used to fire a refresh round on any spendable
            // VTXO within URGENCY_THRESHOLD_DAYS of expiry, retrying every few
            // minutes. After a user cancelled a wedged round it re-locked the
            // just-unlocked VTXO before the already-completed round could
            // reconcile, deadlocking near-expiry funds (incident 2026-07-23).
            // Refresh is manual now: the pre-scheduled expiry warnings say when
            // to act, the failure escalation below covers repeated manual
            // failures, and the stuck-swap flow covers a genuinely wedged round.

            // --- Refresh-failure escalation near expiry ---
            //
            // See REFRESH_FAIL_ESCALATE_STREAK above for the rationale.
            // Blocking Alert, not a toast or banner: this is the last
            // software intervention between the user and unrecoverable
            // fund loss, and the two prior warning layers (expiry
            // notifications, stuck banner) demonstrably weren't loud
            // enough when refreshes were failing outright.
            const failStreak = state.arkRefreshFailStreak ?? 0;
            if (
                failStreak >= REFRESH_FAIL_ESCALATE_STREAK &&
                isFinite(minBlocksAnySpendable) &&
                minBlocksAnySpendable < URGENCY_THRESHOLD_BLOCKS &&
                Date.now() - (state.arkRefreshFailAlertAt ?? 0) > REFRESH_FAIL_ALERT_GAP_MS
            ) {
                useAuthStore.getState().setArkRefreshFailAlertAt(Date.now());
                console.warn(
                    '[Ark sync] refresh-failure escalation — failStreak=', failStreak,
                    'minBlocks=', minBlocksAnySpendable,
                );
                Alert.alert(
                    'Refresh keeps failing',
                    `Your capsules expire ${formatBlocksUntil(minBlocksAnySpendable)} and your last ` +
                    `${failStreak} refresh attempts failed. Switch networks (Wi-Fi to cellular, or ` +
                    'cellular to Wi-Fi) and refresh again. If refresh still fails, use ' +
                    'Settings → Emergency Exit to move your funds on-chain before they expire. ' +
                    'Once a capsule expires, recovery is not guaranteed.',
                    [{ text: 'OK' }],
                );
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
        setArkExitInProgress,
        setArkExitDestinationAddress,
        setArkExitStartedAt,
        arkExitDrained,
        setArkExitDrained,
        arkExitStartedAt,
        setArkExitStartedSats,
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
