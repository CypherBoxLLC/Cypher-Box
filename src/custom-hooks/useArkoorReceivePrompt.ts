import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';

import SimpleToast from 'react-native-simple-toast';

import {
    ARK_ARKOOR_ASSUMED_DAYS,
    ARK_EXIT_RUNWAY_HOURS,
    ARK_REFRESH_MIN_SATS,
    ARK_SWEEP_MAX_RUNWAY_HOURS,
    ArkRefreshInFlightError,
    AVG_BLOCK_MINUTES,
    buildDustSweepPlan,
    cancelVtxoExpiryWarnings,
    estimateArkRefreshFee,
    maybeSweepDustArkVtxos,
    refreshArkVtxosDelegatedAndSync,
    refreshFloorBlocks,
    scheduleVtxoExpiryWarnings,
} from '@Cypher/services/ark';
import useAuthStore from '@Cypher/stores/authStore';
import { recordEvent } from '@Cypher/stores/eventLogStore';

/**
 * Foreground orchestrator for a received Bark capsule (Lightning receive /
 * arkoor).
 *
 * Why this exists
 * ---------------
 * A received capsule has a short TTL (about 3 days). On bark 0.6.0 it carries
 * a REAL expiryHeight and, importantly, stays SPENDABLE during a refresh
 * round. Both facts change the old design: the app used to pop a "spend now
 * vs refresh now" fork because refreshing locked the funds, and it assumed a
 * flat 3-day fuse because the SDK reported expiryHeight 0. Neither holds now.
 *
 * What this hook does
 * -------------------
 *   1. Schedules OS-level expiry warnings the moment a receive is observed
 *      (movementWatcher pushes it into arkArkoorPromptState), as the safety
 *      net for a user who is backgrounded or never returns.
 *   2. For the oldest pending receive, in foreground, decides automatically
 *      (see step 2): auto-refresh silently when it is economically safe, or
 *      show a one-button "too small, spend it" notice with the real
 *      countdown. No user fork.
 *
 * Auto-refresh is gated on the SDK's own refresh estimate so it can never
 * (a) turn a refreshable capsule into unrefreshable dust (post-fee output
 * must clear the refresh floor) or (b) drag unrelated capsules into the
 * round (the estimate must spend only this capsule). Validated on-device
 * 2026-08-08: a 600-sat receive estimated a 2-sat fee and vtxosSpent =
 * [itself].
 *
 * Self-contained: no changes to movementWatcher or useArkSync. State lives
 * in zustand (arkArkoorPromptState) so a kill-and-relaunch does not re-decide
 * a capsule already handled, and the dismissed list survives so the expiry
 * warnings still fire from a cold boot.
 */
// Force-release the single-flight decision slot if a decision's native I/O
// (estimate / submit / an Alert whose callbacks never fire) never settles, so
// a hang can't pin the feature off for the whole session.
const ARKOOR_DECISION_WATCHDOG_MS = 90 * 1000;
// Back-off before retrying auto-refresh for a capsule that hit a busy round
// slot (one round per wallet), long enough for a typical round to progress
// or clear before we try again.
const ARKOOR_INFLIGHT_BACKOFF_MS = 2 * 60 * 1000;
// Grace window before an entry whose vtxo is absent from `arkVtxos` is
// pruned. movementWatcher queues a received capsule from bark's real-time
// MovementUpdated notification, which lands ~1-2s BEFORE the vtxo fetch
// writes the new vtxo into `arkVtxos`. Pruning purely on "id absent from
// arkVtxos" inside that window deletes the just-received entry before the
// decision effect can act on it, which silently killed auto-refresh
// (observed on-device: entry queued 19:48:03.236, pruned .353, vtxo landed
// only at 19:48:05.3). Only prune once the vtxo has had time to appear and
// genuinely didn't (spent / refreshed-away).
const ARKOOR_PRUNE_GRACE_MS = 30 * 1000;

/**
 * Human "time left" for a received capsule. On bark 0.6.0 a received capsule
 * carries a REAL expiryHeight (confirmed on-device 2026-08-08), so we compute
 * the actual remaining time from the chain tip. Falls back to the
 * ARK_ARKOOR_ASSUMED_DAYS estimate only when the height is unknown (older
 * arkoors report expiryHeight 0). Returns '' when nothing can be computed.
 */
function formatCapsuleTimeLeft(
    expiryHeight: number | undefined,
    tip: number | null,
    observedAt: number | undefined,
): string {
    let ms: number;
    if (expiryHeight && expiryHeight > 0 && typeof tip === 'number') {
        const blocksLeft = expiryHeight - tip;
        if (blocksLeft <= 0) return 'less than an hour';
        ms = blocksLeft * AVG_BLOCK_MINUTES * 60 * 1000;
    } else if (observedAt) {
        ms = observedAt + ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000 - Date.now();
    } else {
        return '';
    }
    if (ms <= 0) return 'less than an hour';
    const totalHours = Math.floor(ms / (60 * 60 * 1000));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h`;
    return 'less than an hour';
}

export default function useArkoorReceivePrompt(): void {
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const arkArkoorPromptState = useAuthStore((s) => s.arkArkoorPromptState);
    const setArkArkoorPromptState = useAuthStore((s) => s.setArkArkoorPromptState);
    const isArkAuth = useAuthStore((s) => s.isArkAuth);
    // NB: `arkArkoorPromptEnabled` exists in the store for back-compat but
    // is no longer read. The popup is always on — see the field's
    // deprecation comment in authStore.ts for the user-feedback rationale.

    // Single-flight guard: at most one Alert.alert visible at a time. The
    // ref protects against the effect running twice in fast succession
    // (StrictMode dev double-invoke, or a vtxo write landing while a
    // previous prompt is still being shown).
    const promptInFlight = useRef(false);
    // Tracks the current foreground state. Alert.alert is foreground-only;
    // attempting to fire while backgrounded creates a phantom modal that
    // surfaces on next foreground without the user's context. Gate on this.
    //
    // STATE, not a ref, deliberately: the documented contract is "popup
    // fires on next foreground", and that requires the foreground
    // transition itself to re-run the prompt effect. With a ref, the
    // effect only re-evaluated when something else changed — usually the
    // 30s sync tick's arkVtxos write, which pauses while HomeScreen is
    // unfocused. Net effect observed live 2026-07-07: tap the
    // payment-received notification (deep-links to Capsules), and the
    // pending prompt never fires until the user wanders back to Home.
    const [appIsActive, setAppIsActive] = useState(
        AppState.currentState === 'active',
    );

    useEffect(() => {
        const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
            setAppIsActive(status === 'active');
        });
        return () => sub.remove();
    }, []);

    // Step 1a: schedule OS-level expiry warnings the moment a new
    // 'pending' entry appears (regardless of where it came from — almost
    // always from movementWatcher's real-time receive notification).
    //
    // Detection itself is no longer this hook's job — movementWatcher
    // pushes new entries into arkArkoorPromptState as soon as Bark emits
    // MovementUpdated subsystem=receive status=successful. That gives us
    // sub-second latency, which is required because useArkSync's
    // auto-refresh trigger fires within ~2 seconds of the receive
    // settling. A 30s-poll-based detector loses that race and the popup
    // shows up about a VTXO that's already Locked in a round.
    //
    // Each entry's OS-push schedule fires once per (vtxoId, schedule-call)
    // pair — scheduleVtxoExpiryWarnings is idempotent on the OS layer, but
    // we track an in-process Set so we don't call the bridge on every
    // render. Reset across reloads is fine; OS dedups by notification id.
    const scheduledRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!isArkAuth) return;
        for (const [id, entry] of Object.entries(arkArkoorPromptState)) {
            if (entry.status !== 'pending' && entry.status !== 'dismissed') continue;
            if (scheduledRef.current.has(id)) continue;
            const liveVtxo = arkVtxos.find((v) => v.id === id);
            // Only schedule the ~3-day ASSUMPTION for capsules whose real
            // expiry is genuinely unknown (height 0), the ones useArkSync
            // skips. On bark 0.6.0 a received capsule carries a REAL
            // expiryHeight and useArkSync schedules it accurately from that
            // (same OS notification ids); re-arming an assumed deadline here
            // would override the accurate one after a relaunch (scheduledRef
            // is in-process; useArkSync's persisted map won't re-correct) and
            // fire near-expiry warnings too late for a sub-3-day capsule. If
            // the vtxo has not landed in the store yet, wait for it rather
            // than guess.
            if (!liveVtxo) continue;
            if (liveVtxo.expiryHeight > 0) {
                scheduledRef.current.add(id); // owned by useArkSync
                continue;
            }
            const assumedExpiryAtMs =
                entry.observedAt + ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000;
            const satsForNotif = entry.sats ?? liveVtxo.sats ?? undefined;
            try {
                scheduleVtxoExpiryWarnings(id, assumedExpiryAtMs, satsForNotif);
                scheduledRef.current.add(id);
                if (__DEV__) {
                    console.log(
                        '[useArkoorReceivePrompt] scheduled assumed expiry warnings for',
                        id.slice(0, 12),
                        'assumedExpiryAt=', new Date(assumedExpiryAtMs).toISOString(),
                    );
                }
            } catch (err) {
                console.warn(
                    '[useArkoorReceivePrompt] scheduleVtxoExpiryWarnings threw:',
                    err,
                );
            }
        }
    }, [arkArkoorPromptState, isArkAuth, arkVtxos]);

    // Step 1b: prune entries whose vtxo no longer exists in the wallet
    // (spent, exited, refreshed-and-replaced). Keeps the map from growing
    // unbounded over the wallet's lifetime and cancels any phantom OS
    // pushes for vtxos that already moved.
    useEffect(() => {
        if (!isArkAuth) return;
        // RACE GUARD. There's a window between boot and the first
        // useArkSync read where arkVtxos is still []. Without this guard,
        // when movementWatcher pushes a new arkoor entry during that
        // window, the prune effect re-runs (because arkArkoorPromptState
        // changed), sees an empty livingIds set, and immediately wipes
        // the just-added entry. The alert effect never gets a chance.
        // Empirically: this swallowed the first Strike→Ark test on a
        // fresh reload and produced no Activity-feed event at all.
        if (arkVtxos.length === 0) return;
        const livingIds = new Set(arkVtxos.map((v) => v.id));
        const now = Date.now();
        const next: typeof arkArkoorPromptState = {};
        let mutated = false;
        for (const [id, entry] of Object.entries(arkArkoorPromptState)) {
            if (livingIds.has(id)) {
                next[id] = entry;
            } else if (now - (entry.observedAt ?? 0) < ARKOOR_PRUNE_GRACE_MS) {
                // Vtxo not in arkVtxos YET: the receive's MovementUpdated
                // notification outran the vtxo fetch. Keep it through the
                // grace window so the decision effect can act once the vtxo
                // lands. Without this the entry is deleted ~2s before its
                // vtxo appears and auto-refresh never fires.
                next[id] = entry;
            } else {
                mutated = true;
                scheduledRef.current.delete(id);
                try {
                    cancelVtxoExpiryWarnings(id);
                } catch (err) {
                    console.warn('[useArkoorReceivePrompt] cancel on prune threw:', err);
                }
            }
        }
        if (mutated) setArkArkoorPromptState(next);
    }, [arkVtxos, arkArkoorPromptState, isArkAuth, setArkArkoorPromptState]);

    // Step 2: automatic refresh decision for the oldest pending arkoor.
    //
    // Design (validated on-device 2026-08-08). On bark 0.6.0 a received
    // capsule keeps a REAL expiryHeight and stays SPENDABLE during a refresh
    // round, so the old "spend now vs refresh now" fork is obsolete. We now
    // decide automatically, gated on the SDK's own refresh estimate:
    //
    //   - Auto-refresh, silently, if the estimate spends ONLY this capsule
    //     (no filler / whole-balance-into-a-round risk) AND the post-fee
    //     output still clears the refresh floor (so we never turn a
    //     refreshable capsule into unrefreshable dust). Confirmed live: a
    //     600-sat receive estimated a 2-sat fee and vtxosSpent = [itself].
    //   - Otherwise, a one-button notice: too small to refresh on its own,
    //     spend it before it expires, with the REAL countdown.
    //
    // Foreground-gated: the estimate needs the open wallet, and the toast /
    // notice are foreground UI. A backgrounded receive is still covered by
    // the OS expiry warnings scheduled in step 1a and is decided on next
    // foreground. `promptInFlight` serializes one decision at a time and is
    // claimed synchronously before the async estimate so a re-render can't
    // double-decide.
    //
    // COPY: the user-facing strings below are Bam's draft; final wording is
    // his to set.
    useEffect(() => {
        if (!isArkAuth || !appIsActive || promptInFlight.current) return;

        const now = Date.now();
        const firstId = Object.entries(arkArkoorPromptState)
            // Skip entries backed off after a busy round slot until their
            // defer window passes (see the in-flight branch below).
            .filter(([, e]) => e.status === 'pending' && (e.deferUntil == null || e.deferUntil <= now))
            .sort((a, b) => a[1].observedAt - b[1].observedAt)
            .map(([id]) => id)[0];
        if (!firstId) return;

        // Claim the single-flight slot synchronously, BEFORE any await, so a
        // re-render during the estimate returns early instead of re-deciding.
        promptInFlight.current = true;

        void (async () => {
            let released = false;
            // Watchdog: the native I/O below (estimate, submit, or an Alert
            // whose callbacks never fire) must never pin promptInFlight true
            // for the session, which would silently kill the feature for every
            // later receive. Force-release after a generous ceiling.
            const watchdog = setTimeout(() => {
                if (released) return;
                console.warn('[arkoor auto-refresh] decision watchdog fired; releasing');
                released = true;
                promptInFlight.current = false;
            }, ARKOOR_DECISION_WATCHDOG_MS);
            const release = () => {
                if (released) return;
                released = true;
                clearTimeout(watchdog);
                promptInFlight.current = false;
            };
            try {
                const entry = useAuthStore.getState().arkArkoorPromptState[firstId];
                if (!entry || entry.status !== 'pending') { release(); return; }
                // Prefer the live store (fresher than this render's closure) so a
                // sync that landed the vtxo between render and here is seen.
                const vtxo =
                    useAuthStore.getState().arkVtxos.find((v) => v.id === firstId) ??
                    arkVtxos.find((v) => v.id === firstId);
                // The exit-runway floor below needs the vtxo's REAL expiry. A
                // received capsule's vtxo lags its MovementUpdated notification by
                // ~2s; if it hasn't materialised yet, defer to the next tick (the
                // prune grace window holds the entry) rather than decide blind and
                // risk auto-refreshing a sub-28h capsule. If it never lands, the
                // grace window drops the entry and the foreground sweep is the
                // backstop once the vtxo settles.
                if (!vtxo) { release(); return; }
                // Use the ACTUAL vtxo amount, not the movement total in the
                // entry. A receive can split into multiple outputs (e.g. a 700
                // receive leaving a 673 capsule + a 27-sat dust piece); the
                // movement records 700 but THIS capsule may be dust. Deciding on
                // the movement total made the decision try to refresh a 27-sat
                // dust vtxo, which the ASP rejects ("amount must be >= 330 sats")
                // and which inflated the refresh-fail streak. entry.sats is only
                // a fallback for the rare case the vtxo carries no amount.
                const sats = vtxo.sats ?? entry.sats ?? null;
                const vtxoIdPrefix = firstId.slice(0, 12);
                const amountPhrase = sats != null ? `${sats.toLocaleString()} sats` : 'these sats';

                // Ask the SDK what refreshing JUST this capsule would do: the
                // fee, and crucially which vtxos the round would consume.
                let feeSats: number | null = null;
                let spendsOnlySelf = false;
                try {
                    const est = await estimateArkRefreshFee([firstId]);
                    feeSats = est.feeSats;
                    spendsOnlySelf = est.vtxosSpent.length === 1 && est.vtxosSpent[0] === firstId;
                } catch (estErr: any) {
                    // Wallet not ready / transient network. Leave the arkoor
                    // pending; a later tick (next sync writes arkVtxos, ~30s)
                    // retries. Not a tight loop: this effect only re-runs when
                    // one of its deps changes.
                    console.warn('[arkoor auto-refresh] estimate failed, will retry:', estErr?.message ?? estErr);
                    release();
                    return;
                }

                const outputSats = sats != null && feeSats != null ? sats - feeSats : null;
                const belowFloor = outputSats != null && outputSats < ARK_REFRESH_MIN_SATS;
                // Exit-runway floor: never AUTO-refresh a capsule within 28h of
                // expiry (24h unilateral-exit runway + 4h grace). A delegated
                // round that hangs instead of finalizing would eat the exit
                // window; below the floor the user should spend/exit, not
                // refresh. Older arkoors report expiryHeight 0 (unknown, ~3-day
                // assumed), which is safely above the floor.
                const tip = useAuthStore.getState().arkChainTipHeight;
                const bandCeilingBlocksForFloor = Math.round(
                    (ARK_SWEEP_MAX_RUNWAY_HOURS * 60) / AVG_BLOCK_MINUTES,
                );
                // Depth-aware, matching the foreground sweep. The flat
                // ARK_EXIT_RUNWAY_HOURS is exitDelta + grace with no
                // confirmation budget, so it under-protects every capsule of
                // depth >= 1; a received capsule is not exempt from that.
                // Falls back to the flat value when the capsule reports no
                // depth or the server delta is not known yet.
                const flatRunwayBlocks = Math.round(
                    (ARK_EXIT_RUNWAY_HOURS * 60) / AVG_BLOCK_MINUTES,
                );
                const runwayBlocks = refreshFloorBlocks(
                    vtxo.exitDepth,
                    useAuthStore.getState().arkVtxoExitDeltaBlocks ?? null,
                    flatRunwayBlocks,
                    bandCeilingBlocksForFloor,
                );
                const blocksLeft =
                    vtxo.expiryHeight > 0 && typeof tip === 'number'
                        ? vtxo.expiryHeight - tip
                        : null;
                const belowExitRunway = blocksLeft != null && blocksLeft < runwayBlocks;
                // Ceiling, mirroring the foreground sweep's band. Above this a
                // capsule has plenty of life and refreshing it buys nothing at
                // the most expensive rate the ASP charges. See the skip branch
                // below for the numbers.
                const bandCeilingBlocks = Math.round((ARK_SWEEP_MAX_RUNWAY_HOURS * 60) / AVG_BLOCK_MINUTES);
                const aboveRefreshBand = blocksLeft != null && blocksLeft > bandCeilingBlocks;
                /**
                 * A received capsule refreshes on sight. The only conditions
                 * left are the two that decide whether the refresh CAN work.
                 *
                 * `belowExitRunway` and `aboveRefreshBand` are NOT conditions
                 * here, and both used to be. They are the foreground sweep's
                 * rules, and the sweep is reasoning about a capsule the user
                 * already holds self-custodially: there, declining to refresh
                 * preserves a unilateral exit that a slow round could cost
                 * them, and waiting gets a cheaper rate.
                 *
                 * Neither applies to an arkoor. Until it is refreshed into a
                 * round it has no unilateral exit to preserve, so the runway
                 * floor protects nothing and the ASP can sweep it. Holding off
                 * is the risk, not the refresh. And the band ceiling is about
                 * paying the top rate for life the capsule does not need,
                 * which is irrelevant when the reason to refresh is custody
                 * rather than expiry.
                 *
                 * It is also deliberately NOT gated on arkAutoRefreshEnabled.
                 * That preference is about routine maintenance spending, and
                 * this is the one refresh that converts someone else's custody
                 * into the user's own.
                 */
                const safeToAutoRefresh =
                    spendsOnlySelf &&
                    outputSats != null &&
                    outputSats >= ARK_REFRESH_MIN_SATS;

                if (__DEV__) {
                    console.log('[arkoor decision]', JSON.stringify({
                        id: vtxoIdPrefix, sats, feeSats, outputSats,
                        spendsOnlySelf, safeToAutoRefresh, belowFloor,
                        belowExitRunway, aboveRefreshBand, bandCeilingBlocks,
                        blocksLeft, expiryHeight: vtxo.expiryHeight,
                    }));
                }

                if (safeToAutoRefresh) {
                    recordEvent({ kind: 'arkoor-prompt', outcome: 'auto-refresh', vtxoIdPrefix, sats: sats ?? undefined });
                    // Optimistically mark refreshed so it isn't re-selected
                    // while the round runs.
                    const cur = useAuthStore.getState().arkArkoorPromptState;
                    const ex = cur[firstId];
                    if (ex) setArkArkoorPromptState({ ...cur, [firstId]: { ...ex, status: 'refreshed' } });
                    if (sats != null) {
                        SimpleToast.show(`Received ${sats.toLocaleString()} sats. Refreshing now so they are yours to exit, not the server's.`, SimpleToast.LONG);
                    }
                    // Fire-and-forget. Expiry warnings stay armed until the
                    // refreshed replacement lands and the prune (step 1b)
                    // cancels them; see the failure handler for why we never
                    // cancel up-front.
                    refreshArkVtxosDelegatedAndSync([firstId], sats ?? undefined)
                        .catch((err) => {
                            console.warn('[arkoor auto-refresh] submit failed:', err?.message ?? err);
                            const c2 = useAuthStore.getState().arkArkoorPromptState;
                            const e2 = c2[firstId];
                            if (err instanceof ArkRefreshInFlightError) {
                                // A round is already running (another capsule, a
                                // tap refresh, or a background wake). Do NOT give
                                // up: back the capsule off to 'pending' with a
                                // defer window so it auto-refreshes once the slot
                                // frees. No toast (would spam on every retry
                                // while the round runs).
                                if (e2) {
                                    setArkArkoorPromptState({
                                        ...c2,
                                        [firstId]: { ...e2, status: 'pending', deferUntil: Date.now() + ARKOOR_INFLIGHT_BACKOFF_MS },
                                    });
                                }
                            } else {
                                // Real failure: nothing is refreshing. Mark
                                // dismissed (spendable, protected), keep the
                                // warnings armed, and tell the user it's safe.
                                if (e2) {
                                    setArkArkoorPromptState({ ...c2, [firstId]: { ...e2, status: 'dismissed', dismissedAt: Date.now() } });
                                }
                                const exp = (e2?.observedAt ?? Date.now()) + ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000;
                                try { scheduleVtxoExpiryWarnings(firstId, exp, sats ?? undefined); } catch (schedErr) {
                                    console.warn('[arkoor auto-refresh] re-schedule after failure threw:', schedErr);
                                }
                                SimpleToast.show('These sats are safe and spendable. You can refresh them from Capsules.', SimpleToast.LONG);
                            }
                        })
                        .finally(release);
                    return;
                }

                // Plenty of life left: do nothing, silently.
                //
                // The ASP's refresh fee is base 0 plus a ppm ladder keyed on
                // blocks REMAINING, not on age: 0 ppm under 288 blocks (~2
                // days), 2000 ppm to 1008 (~7 days), 4000 ppm to 2016 (~14
                // days), 5000 ppm above that. Live table read 2026-09-12 with
                // `bark dev ark-info https://ark.second.tech`. A capsule that
                // arrives carrying a full vtxo_expiry_delta (4032 blocks, ~28
                // days) therefore sits in the TOP band, so refreshing it on
                // sight pays 0.5% to extend an expiry that was already nearly
                // full: 500 sats on a 100k deposit, observed live. Without this
                // guard the hook did exactly that, and the Learn-more screen
                // tells users the opposite ("waiting for a reminder is cheaper
                // than refreshing on sight").
                //
                // Leave it to the foreground sweep, which owns the 28h-to-1-week
                // band and picks the capsule up once it drifts in, by which time
                // the same refresh costs 0.2% or nothing. Marked 'dismissed'
                // (spendable, protected, expiry warnings armed) rather than
                // 'refreshed', so the prune keeps the alarms until a real
                // replacement lands. No toast and no notice: nothing happened
                // that the user needs to act on, and the notice below would tell
                // the holder of a 28-day capsule to spend it before it expires.
                //
                // Gated on a KNOWN blocksLeft. Legacy arkoors report
                // expiryHeight 0, and the sweep skips those outright
                // (`v.expiryHeight <= 0`), so an unknown expiry must keep
                // auto-refreshing here or nothing ever refreshes it. Dust is
                // excluded too: a sub-floor capsule still wants the dust sweep
                // below, however much life it has.
                //
                // NARROWED: `safeToAutoRefresh` above no longer excludes a
                // capsule for having plenty of life, because the reason to
                // refresh an arkoor is custody rather than expiry. So this is
                // now reached only when the refresh estimate says the round
                // would pull OTHER capsules in as well, on a capsule that is
                // also long-lived. It stays a silent skip: dragging unrelated
                // capsules into a round is a worse outcome than leaving this
                // one for the foreground sweep to pick up, and a 28-day capsule
                // must not be handed the notice below telling the user to spend
                // it before it expires.
                if (aboveRefreshBand && !belowFloor) {
                    recordEvent({ kind: 'arkoor-prompt', outcome: 'no-refresh-needed', vtxoIdPrefix, sats: sats ?? undefined });
                    const curLong = useAuthStore.getState().arkArkoorPromptState;
                    const exLong = curLong[firstId];
                    if (exLong) {
                        setArkArkoorPromptState({
                            ...curLong,
                            [firstId]: { ...exLong, status: 'dismissed', dismissedAt: Date.now() },
                        });
                    }
                    release();
                    return;
                }

                // Before the notice: can the wallet fold this capsule in with
                // the other dust instead? A Lightning receive is paid out of the
                // ASP's VTXO pool and can arrive as several sub floor pieces (a
                // 700 sat receive landed as a 300 and a 400), and each piece
                // reaches this branch alone and unrefreshable. Together they are
                // a dust only batch, which is the shape the ASP accepts. Telling
                // the user to spend capsules the wallet is about to combine
                // would be both alarming and wrong, so the sweep wins.
                // Requires a known chain tip: without it a capsule that reports
                // a real expiry height cannot be checked against the round
                // window, and guessing there is what poisons a batch.
                if (belowFloor && typeof tip === 'number') {
                    const liveVtxos = useAuthStore.getState().arkVtxos ?? [];
                    const refreshingIds = new Set(
                        useAuthStore.getState().arkRefreshingVtxoIds ?? [],
                    );
                    const dustPlan = buildDustSweepPlan({
                        vtxos: liveVtxos.map((v) => ({
                            id: v.id,
                            sats: v.sats,
                            blocksUntilExpiry:
                                v.expiryHeight > 0 ? v.expiryHeight - tip : null,
                            stateTag: v.exiting ? 'exiting' : v.state,
                            alreadyRefreshing: refreshingIds.has(v.id),
                        })),
                        exitInProgress: useAuthStore.getState().arkExitInProgress,
                        minRefreshSats: ARK_REFRESH_MIN_SATS,
                    });
                    if (dustPlan.sweep && dustPlan.ids.includes(firstId)) {
                        recordEvent({ kind: 'arkoor-prompt', outcome: 'auto-refresh', vtxoIdPrefix, sats: sats ?? undefined });
                        // Optimistic, same as the single capsule path above: keep
                        // it out of the next decision pass while the round runs.
                        const curSweep = useAuthStore.getState().arkArkoorPromptState;
                        const exSweep = curSweep[firstId];
                        if (exSweep) {
                            setArkArkoorPromptState({
                                ...curSweep,
                                [firstId]: { ...exSweep, status: 'refreshed' },
                            });
                        }
                        SimpleToast.show(
                            `Received ${amountPhrase}. Combining your small capsules to keep them longer.`,
                            SimpleToast.SHORT,
                        );
                        // The sweep owns its own in-flight lock, pacing and
                        // error reporting, so this is fire and forget. If it
                        // cannot submit right now the foreground tick retries.
                        void maybeSweepDustArkVtxos(liveVtxos, tip);
                        release();
                        return;
                    }
                }

                // NOTICE path (too small to refresh, or the estimate would pull
                // other capsules in, a safety fallback we did not observe in QA
                // but refuse to auto-fire on). This shows an Alert, so re-check
                // foreground AFTER the await: if the app backgrounded during the
                // estimate, leave the capsule 'pending' and re-decide on next
                // foreground rather than queue a phantom modal.
                if (AppState.currentState !== 'active') { release(); return; }

                // Distinguish "too small to refresh" from "too close to expiry
                // to refresh safely" (the exit-runway floor) so the activity log
                // is not mislabelled for a large near-expiry capsule.
                const noticeOutcome = belowExitRunway && !belowFloor ? 'too-soon-notice' : 'too-small-notice';
                recordEvent({ kind: 'arkoor-prompt', outcome: noticeOutcome, vtxoIdPrefix, sats: sats ?? undefined });
                const cur = useAuthStore.getState().arkArkoorPromptState;
                const ex = cur[firstId] ?? { observedAt: Date.now(), sats: sats ?? undefined };
                setArkArkoorPromptState({ ...cur, [firstId]: { ...ex, status: 'dismissed', dismissedAt: Date.now() } });
                const exp = (ex.observedAt ?? Date.now()) + ARK_ARKOOR_ASSUMED_DAYS * 24 * 60 * 60 * 1000;
                try { scheduleVtxoExpiryWarnings(firstId, exp, sats ?? undefined); } catch (schedErr) {
                    console.warn('[arkoor auto-refresh] notice re-schedule threw:', schedErr);
                }
                const timeLeft = formatCapsuleTimeLeft(vtxo.expiryHeight, tip, ex.observedAt);
                // NO MODAL. A toast, and the OS alarms scheduled just above.
                //
                // Everything that used to justify interrupting the user here is
                // gone. A received capsule now refreshes on sight, so the only
                // ways to reach this point are that the capsule is below the
                // ASP's refresh floor and the dust sweep could not fold it in,
                // or that the fee estimate says the round would pull unrelated
                // capsules along. Both are small-value cases, and neither is
                // something the user can do anything about in the next second.
                //
                // Blocking the app on launch to say "spend these 400 sats" was
                // out of all proportion to the amount at stake, and it was the
                // only signal in the app that demanded a tap before the user
                // could see their balance. The expiry reminders above are the
                // real warning channel: they are OS alarms, they fire whether
                // or not the app is open, and they now start 7 days out. The
                // Capsules tab carries the per-capsule state for anyone who
                // wants to act sooner.
                const reason = belowFloor
                    ? 'too small to refresh on its own'
                    : 'not refreshable on its own right now';
                SimpleToast.show(
                    `Received ${amountPhrase}, ${reason}. Spend them in a payment` +
                        `${timeLeft ? ` within ${timeLeft}` : ' before they expire'}.`,
                    SimpleToast.LONG,
                );
                release();
            } catch (outerErr: any) {
                console.warn('[arkoor auto-refresh] decision threw:', outerErr?.message ?? outerErr);
                release();
            }
        })();
    }, [arkArkoorPromptState, isArkAuth, arkVtxos, appIsActive, setArkArkoorPromptState]);
}
