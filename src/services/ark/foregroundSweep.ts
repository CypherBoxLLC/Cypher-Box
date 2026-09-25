import useAuthStore from '@Cypher/stores/authStore';
import { recordEvent } from '@Cypher/stores/eventLogStore';

import { AVG_BLOCK_MINUTES } from './chainTip';
import {
    ARK_EXIT_RUNWAY_HOURS,
    ARK_REFRESH_MIN_SATS,
    ARK_SWEEP_MAX_RUNWAY_HOURS,
    ARK_SERVER_URL,
    ESPLORA_URLS,
} from './config';
import { buildDustSweepPlan } from './dustSweep';
import {
    ArkRefreshInFlightError,
    estimateArkRefreshFee,
    fetchArkPendingRoundStates,
    refreshArkVtxosDelegatedAndSync,
} from './refresh';
import { refreshFloorBlocks } from './exitTriage';
import { classifyArkNetworkFault } from './networkFault';
import { getArkWalletHandle } from './walletHandle';
import type { ArkVtxoView } from './vtxos';

/**
 * Foreground maintenance sweep — the always-on safety net that refreshes VTXOs
 * approaching expiry so nothing refreshable is silently lost.
 *
 * Design:
 *
 *  - Runs from the useArkSync tick (no separate timer), foreground only.
 *  - Refresh-eligibility BAND (the exit-runway rule): only a VTXO whose
 *    time-to-expiry is between ARK_EXIT_RUNWAY_HOURS (28h = 24h unilateral-exit
 *    runway + 4h grace) and ARK_SWEEP_MAX_RUNWAY_HOURS (1 week). Below the floor
 *    we must NOT refresh — a delegated round that hangs would eat the exit
 *    window; the user should spend/exit instead (expiry warnings + escalation
 *    own that zone). Above a week there is no reason to spend the fee yet.
 *  - Dust: sub-ARK_REFRESH_MIN_SATS inputs never ride along in this batch (one
 *    sub-floor input makes bark reject the whole round). They are handled by
 *    maybeSweepDustArkVtxos below, which folds them into ONE capsule in a dust
 *    only round, the single shape the ASP is known to accept.
 *  - Covers regular + arkoor VTXOs uniformly (any kind, real expiry).
 *
 * Why this is safe now (it deadlocked in July on the self-signed path): the
 * delegated path never Locks a VTXO (bark 0.6.0 keeps it Spendable), so there
 * is no trapped state and no re-lock deadlock; and the cross-caller in-flight
 * lock inside refreshArkVtxosDelegated forbids concurrent rounds. A single
 * delegated round that hangs shows `ongoing`, so the sweep SKIPS it (pauses,
 * never loops) and the funds stay spendable/exitable.
 *
 * Safeguards:
 *   S1 — exclude ids already mid-refresh (arkRefreshingVtxoIds), so a capsule
 *        whose round has not finalised is never re-targeted.
 *   S2 — widen the retry gap after consecutive failures (ASP/esplora outage)
 *        so we don't submit-and-fail on a fixed cadence for hours.
 */

// One sweep per wallet at a time (this flag) plus the shared in-flight lock in
// refresh.ts. Module-level, per JS process.
let sweepInFlight = false;
let lastSweepAt = 0;
let consecutiveFailures = 0;
// Same pacing, kept separately so a dust sweep and a band sweep do not consume
// each other's gap. `sweepInFlight` is deliberately SHARED: one submission at a
// time per wallet, whichever kind it is.
let lastDustSweepAt = 0;
let dustFailures = 0;
/**
 * Wall clock before which NEITHER sweep may submit, set when the chain source
 * refuses us on quota. Shared for the same reason `sweepInFlight` is: the quota
 * belongs to the connection, not to one sweep, so a rejection earned by either
 * has to silence both.
 *
 * Separate from the failure counters because a quota rejection is a different
 * kind of failure. An ordinary error might succeed next tick; a 429 says the
 * provider is fine and is refusing THIS IP until its window rolls, and retrying
 * into that spends the quota needed to recover.
 */
let rateLimitedUntil = 0;
// Base pacing between sweep submissions. Only actual submissions consume it;
// empty ticks (nothing in-band) re-run the cheap in-memory selection freely.
const FG_SWEEP_MIN_GAP_MS = 5 * 60 * 1000;
// S2: cap the backed-off gap so the sweep still retries a few times an hour
// during a long outage (the fail-streak escalation is the user-facing signal).
const FG_SWEEP_MAX_GAP_MS = 60 * 60 * 1000;
/**
 * How long to stand down after a quota rejection.
 *
 * An hour, because Blockstream's unauthenticated cap is stated per hour (700
 * requests/hour per IP), so the window we are waiting on is an hour wide.
 * Anything shorter is a guess that spends quota to discover it was too short.
 *
 * Safe against the deadline this sweep exists to meet: it fires on capsules
 * inside ARK_SWEEP_MAX_RUNWAY_HOURS (a week) of expiry, so an hour of silence
 * costs at most one attempt out of dozens still available.
 */
const FG_SWEEP_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

function blocksForHours(hours: number): number {
    return Math.round((hours * 60) / AVG_BLOCK_MINUTES);
}

/**
 * Fold the wallet's dust capsules into one, unprompted.
 *
 * WHY THIS IS SEPARATE FROM THE BAND SWEEP ABOVE
 *
 * The band sweep is driven by EXPIRY: it acts on capsules in their last week
 * and skips everything else, dust included. That leaves a hole exactly where
 * users get hurt. A Lightning receive is paid out of the ASP's VTXO pool and can
 * arrive as several sub floor pieces (a 700 sat receive landed as a 300 and a
 * 400, reported to Second.tech 2026-09), and those pieces are arkoor, so they
 * report expiryHeight 0 and the band never even sees them. Nothing automatic
 * could rescue them: the receive prompt refuses them as too small to refresh
 * alone, this sweep counted them as stranded, and only the manual "Dust refresh"
 * button on the Capsules tab could act. Users do not find that button.
 *
 * The trigger here is SIZE, not expiry: as soon as the wallet holds enough dust
 * to make a batch the ASP will take, fold it into one capsule that is large
 * enough to look after itself from then on.
 *
 * The batch is dust only, always. That is the shape confirmed live on mainnet
 * (2026-08-20, two 400s into one, on the same bark core we ship today). Dust is
 * still never mixed into a batch of healthy capsules: one sub floor input has
 * made the ASP reject an entire round, and taking healthy capsules down with the
 * dust is a strictly worse failure than leaving the dust alone.
 *
 * Shares `sweepInFlight` and the pending round check with the band sweep, so the
 * wallet never has two submissions racing, and gets its own pacing so a wallet
 * that sits just under the total does not re-submit on every tick.
 */
export async function maybeSweepDustArkVtxos(
    spendable: ArkVtxoView[],
    tip: number,
    strandedInBand = 0,
): Promise<void> {
    if (sweepInFlight) return;
    // Callable on its own from the background wake, so it repeats the two
    // preconditions the band sweep checks before delegating to it.
    if (getArkWalletHandle() == null) return;
    const store = useAuthStore.getState();
    if (store.arkRefreshStuck) return;
    const refreshing = new Set(store.arkRefreshingVtxoIds);

    const plan = buildDustSweepPlan({
        vtxos: spendable.map((v) => ({
            id: v.id,
            sats: v.sats,
            // expiryHeight 0 is arkoor: bark does not surface the ASP's trust
            // window, so the height is unknown rather than imminent. null tells
            // the rule to include it, which is the whole point here.
            blocksUntilExpiry: v.expiryHeight > 0 ? v.expiryHeight - tip : null,
            // A capsule mid unilateral exit is committed on chain already.
            stateTag: v.exiting ? 'exiting' : v.state,
            alreadyRefreshing: refreshing.has(v.id),
        })),
        exitInProgress: store.arkExitInProgress,
        minRefreshSats: ARK_REFRESH_MIN_SATS,
    });

    if (!plan.sweep) {
        // Only a wallet that HOLDS dust it cannot sweep is worth a feed entry.
        // "Not enough dust yet" is the normal resting state of most wallets and
        // would just be noise; report the genuinely stuck shapes.
        const stuck = plan.reason === 'single-capsule' || plan.reason === 'below-min-total';
        if (stuck || strandedInBand > 0) {
            recordEvent({
                kind: 'ark-bg-refresh',
                trigger: 'foreground',
                outcome: 'dust_stranded',
                elapsedMs: 0,
                vtxoCount: stuck ? plan.candidateCount : strandedInBand,
            });
        }
        return;
    }

    const now = Date.now();
    if (now < rateLimitedUntil) return;
    const gap = Math.min(FG_SWEEP_MIN_GAP_MS * (dustFailures + 1), FG_SWEEP_MAX_GAP_MS);
    if (now - lastDustSweepAt < gap) return;

    // CLAIM THE SLOT BEFORE ANY await.
    //
    // Same defect the band sweep below carried, and worse here: the latch
    // used to be set after the pending-round fetch AND the fee estimate, so
    // two network round trips sat between reading `sweepInFlight` and
    // writing it. Every caller arriving in that window read false and went
    // on to submit, and the window is widest exactly when it must not be,
    // because a slow chain source lengthens both calls.
    //
    // Measured on the band sweep on device 2026-09-09: 174 submissions in
    // 12 minutes, every one refused by a rate-limited chain source. This
    // path has two awaits rather than one, so it is wider still.
    //
    // Everything below sits inside the try so none of the early returns can
    // leave the latch stuck on.
    sweepInFlight = true;
    try {

        const pending = await fetchArkPendingRoundStates();
        if (pending.some((r) => r.ongoing)) {
            console.log('[Ark dust sweep] skip: a round is already ongoing');
            return;
        }

        // The real gate. The size rule above is a pre-filter; only bark can price the
        // round, and the fee is what decides whether the swept capsule lands above
        // the refresh floor or straight back in dust. Same shape as the receive
        // prompt's single capsule decision, for the same reason.
        let feeSats: number;
        let spendsOnlyOurDust: boolean;
        try {
            const est = await estimateArkRefreshFee(plan.ids);
            feeSats = est.feeSats;
            const ours = new Set(plan.ids);
            spendsOnlyOurDust = est.vtxosSpent.every((id) => ours.has(id));
        } catch (estErr: any) {
            // Wallet not ready or a transient network fault. Leave the dust alone and
            // let a later tick price it again; do not count this as a failure, it
            // never reached the ASP.
            console.warn('[Ark dust sweep] fee estimate failed, will retry:', estErr?.message ?? estErr);
            return;
        }

        if (!spendsOnlyOurDust) {
            // The round would drag capsules in that we did not choose, which is the
            // mixed batch we refuse to build. Never seen in QA; refusing costs
            // nothing and the alternative risks healthy capsules.
            console.warn('[Ark dust sweep] skip: the estimate would spend capsules outside the dust batch');
            return;
        }

        const outputSats = plan.totalSats - feeSats;
        if (outputSats < ARK_REFRESH_MIN_SATS) {
            console.log(
                '[Ark dust sweep] skip: output', outputSats,
                'sats would still be below the', ARK_REFRESH_MIN_SATS, 'sat refresh floor',
            );
            recordEvent({
                kind: 'ark-bg-refresh',
                trigger: 'foreground',
                outcome: 'dust_stranded',
                elapsedMs: 0,
                vtxoCount: plan.ids.length,
            });
            return;
        }

        // Latch already claimed above, before the awaits. Only the pacing
        // clock is stamped here, so a tick that bailed out earlier does not
        // consume the next window.
        lastDustSweepAt = now;
        console.log(
            '[Ark dust sweep] firing for', plan.ids.length, 'capsule(s), total',
            plan.totalSats, 'sats, fee', feeSats, 'sats, output', outputSats,
            'sats; excluded=', plan.excludedCount,
        );
        try {
            await refreshArkVtxosDelegatedAndSync(plan.ids, plan.totalSats);
            dustFailures = 0;
            recordEvent({
                kind: 'ark-bg-refresh',
                trigger: 'foreground',
                outcome: 'success',
                elapsedMs: Date.now() - now,
                vtxoCount: plan.ids.length,
            });
        } catch (err: any) {
            if (err instanceof ArkRefreshInFlightError) {
                console.log('[Ark dust sweep] skipped: refresh already in flight');
            } else if (
                classifyArkNetworkFault(err, { chainUrls: ESPLORA_URLS, arkUrl: ARK_SERVER_URL }) ===
                'chain-source-rate-limited'
            ) {
                // A quota rejection is a REFUSAL, not a transient failure. The
                // provider is up and refusing this IP until its window rolls, so
                // retrying inside it spends the quota needed to recover.
                rateLimitedUntil = Date.now() + FG_SWEEP_RATE_LIMIT_BACKOFF_MS;
                console.warn(
                    '[Ark dust sweep] chain source is rate limiting this connection; standing down for',
                    Math.round(FG_SWEEP_RATE_LIMIT_BACKOFF_MS / 60000), 'min',
                );
            } else {
                dustFailures += 1;
                console.warn('[Ark dust sweep] failed:', err?.message ?? err);
                recordEvent({
                    kind: 'ark-bg-refresh',
                    trigger: 'foreground',
                    outcome: 'error',
                    elapsedMs: Date.now() - now,
                    vtxoCount: plan.ids.length,
                    errorMsg: String(err?.message ?? err).slice(0, 200),
                });
            }
        }
    } finally {
        sweepInFlight = false;
    }
}

/**
 * Consider firing the sweep. Cheap and idempotent: safe to call every sync tick.
 * `spendable` is useArkSync's fresh spendable VTXO list; `tip` the chain tip.
 * Fire-and-forget from the caller (it manages its own in-flight + pacing).
 */
export async function maybeSweepDueArkVtxos(
    spendable: ArkVtxoView[],
    tip: number | null,
): Promise<void> {
    // User preference gate, checked HERE rather than at the call site so a
    // future caller cannot reintroduce an ungated automatic spend. This is the
    // only path in the app that spends the user's money with no user action at
    // all, so it is the one that needed an off switch.
    //
    // Deliberately does NOT gate maybeSweepDustArkVtxos below. That sweep costs
    // a couple of sats on a sub-500-sat capsule and exists to stop dust being
    // permanently stranded, so switching it off would add a loss path to save
    // nothing. Reminders are not gated here either; they are free and they are
    // what is left telling the user to act once this is off.
    if (!useAuthStore.getState().arkAutoRefreshEnabled) {
        return;
    }
    if (sweepInFlight) return;
    if (getArkWalletHandle() == null) return;
    if (typeof tip !== 'number') return;

    const store = useAuthStore.getState();
    // A wedged round is owned by the stuck-swap flow; never pile on.
    if (store.arkRefreshStuck) return;

    // Fallback only. The real floor is per capsule and depth-aware (see below);
    // this flat 28h stands in when a capsule reports no depth or the wallet has
    // not learned the server's exit delta yet.
    const flatFloorBlocks = blocksForHours(ARK_EXIT_RUNWAY_HOURS); // 28h
    const ceilBlocks = blocksForHours(ARK_SWEEP_MAX_RUNWAY_HOURS); // 1 week
    const exitDeltaBlocks = store.arkVtxoExitDeltaBlocks ?? null;
    const refreshing = new Set(store.arkRefreshingVtxoIds);

    // Selection (in-memory, cheap): band + dust + state + not-in-flight.
    const refreshable: ArkVtxoView[] = [];
    let strandedDust = 0;
    for (const v of spendable) {
        // Only clean Spendable capsules. `spendable` can still carry Locked /
        // mid-exit / HTLC states; those are not refreshable.
        if (v.state.toLowerCase() !== 'spendable') continue;
        if (v.expiryHeight <= 0) continue; // unknown expiry (arkoor height 0)
        if (refreshing.has(v.id)) continue; // S1: already mid-refresh
        const blocksLeft = v.expiryHeight - tip;
        // Exit-runway floor, from THIS capsule's own depth rather than a flat
        // 28h. The flat value is exitDelta + grace and counts no confirmation
        // budget, so it was the right number only for depth 0: a deep tree was
        // being refreshed with far less runway than its own exit needs, and a
        // stalled refresh there costs the exit too. At the mainnet delta of 144
        // this is strictly stricter than the flat floor for any depth >= 1.
        const floorBlocks = refreshFloorBlocks(
            v.exitDepth,
            exitDeltaBlocks,
            flatFloorBlocks,
            ceilBlocks,
        );
        // The floor is a veto ONLY for a capsule that actually has a unilateral
        // exit to protect, which means a round output.
        //
        // The floor's whole argument is "leave it alone so a slow refresh does
        // not cost the exit". An arkoor has no exit until it is refreshed into
        // a round, so for one of those the floor protects nothing and enforcing
        // it just leaves the funds in the server's custody until they expire.
        // Refusing to refresh is the risk there, not refreshing.
        //
        // Matched positively on `round` rather than by listing the kinds to
        // exclude, because the SDK's `kind` does not return the values its own
        // docstring claims: it yields Pubkey / ServerHtlcRecv / ServerHtlcSend
        // where the docs say board / round / arkoor. An unrecognised kind
        // therefore falls through to being refreshed, which is the safe
        // direction: the cost of refreshing early is a fee, the cost of not
        // refreshing is the capsule.
        const hasOwnExitTree = /round/i.test(v.kind ?? '');
        if (hasOwnExitTree && blocksLeft < floorBlocks) continue; // below exit-runway floor: leave alone
        if (!hasOwnExitTree && blocksLeft < floorBlocks && __DEV__) {
            console.log(
                '[Ark sweep] refreshing', v.id.slice(0, 8), 'below the',
                floorBlocks, 'block floor anyway: kind=', v.kind,
                'has no exit tree to protect, blocksLeft=', blocksLeft,
            );
        }
        if (blocksLeft > ceilBlocks) continue; // more than a week out: not yet
        if (v.sats < ARK_REFRESH_MIN_SATS) {
            strandedDust += 1; // in-band but sub-floor: cannot refresh on its own
            continue;
        }
        refreshable.push(v);
    }

    if (refreshable.length === 0) {
        // Nothing in band. Dust is not simply "stranded" any more: a dust ONLY
        // batch that clears the sweep total is the one shape the ASP accepts,
        // so try that before reporting a problem. Runs on the whole spendable
        // set, not the in-band selection above: the dust a Lightning receive
        // leaves is arkoor, which reports no expiry height at all and is
        // therefore invisible to the band. See dustSweep.ts.
        await maybeSweepDustArkVtxos(spendable, tip, strandedDust);
        return;
    }

    // S2 backoff: only now (we have work) enforce pacing between submissions.
    const now = Date.now();
    if (now < rateLimitedUntil) return;
    const gap = Math.min(FG_SWEEP_MIN_GAP_MS * (consecutiveFailures + 1), FG_SWEEP_MAX_GAP_MS);
    if (now - lastSweepAt < gap) return;

    // CLAIM THE SLOT BEFORE ANY await.
    //
    // The latch used to be set after the pending-rounds fetch below, which put
    // a network round trip between reading `sweepInFlight` and writing it.
    // Every caller that arrived during that fetch read false, waited, and then
    // submitted. Worse, the window is widest exactly when it must not be: when
    // the chain source is slow, the fetch takes longer, so more callers get in,
    // and every extra submission spends more of the quota that made it slow.
    //
    // Measured on device 2026-09-09: 174 submissions in 12 minutes, about one
    // every two seconds while each one took 18 seconds to fail, all of them on
    // Blockstream's 429. A restart cleared it only because it emptied the pile
    // of in-flight calls.
    //
    // Everything from here to the finally must therefore be inside the try, so
    // no early return can leave the latch stuck on.
    const ids = refreshable.map((v) => v.id);
    const totalSats = refreshable.reduce((sum, v) => sum + v.sats, 0);

    sweepInFlight = true;
    const startedAt = now;
    try {
        // Belt-and-suspenders on top of refresh.ts's own guard: skip if a round
        // is genuinely ongoing so we don't waste a submit + log noise.
        const pending = await fetchArkPendingRoundStates();
        if (pending.some((r) => r.ongoing)) {
            console.log('[Ark sweep] skip: a round is already ongoing');
            return;
        }

        // Only stamp the pacing clock once we are actually going to submit.
        // Stamping it above would let a skipped tick eat the next window.
        lastSweepAt = Date.now();
        console.log(
            '[Ark sweep] firing for', ids.length, 'vtxo(s), total', totalSats,
            'sats; strandedDust=', strandedDust,
        );
        await refreshArkVtxosDelegatedAndSync(ids, totalSats);
        consecutiveFailures = 0;
        recordEvent({
            kind: 'ark-bg-refresh',
            trigger: 'foreground',
            outcome: 'success',
            elapsedMs: Date.now() - startedAt,
            vtxoCount: ids.length,
        });
        if (strandedDust > 0) {
            recordEvent({
                kind: 'ark-bg-refresh',
                trigger: 'foreground',
                outcome: 'dust_stranded',
                elapsedMs: 0,
                vtxoCount: strandedDust,
            });
        }
    } catch (err: any) {
        if (err instanceof ArkRefreshInFlightError) {
            // A round started between our check and the submit. Not a failure;
            // don't inflate the backoff. Next eligible tick retries.
            console.log('[Ark sweep] skipped: refresh already in flight');
        } else if (
            classifyArkNetworkFault(err, { chainUrls: ESPLORA_URLS, arkUrl: ARK_SERVER_URL }) ===
            'chain-source-rate-limited'
        ) {
            // A quota rejection is a REFUSAL, not a transient failure. The
            // provider is up and is refusing this IP until its window rolls,
            // so every retry inside that window spends the quota needed to
            // recover and pushes the recovery further out.
            //
            // Stand down for the width of the window rather than inflating
            // consecutiveFailures, which tops out at FG_SWEEP_MAX_GAP_MS only
            // after several failures and would let the next few attempts land
            // inside the same exhausted hour.
            rateLimitedUntil = Date.now() + FG_SWEEP_RATE_LIMIT_BACKOFF_MS;
            console.warn(
                '[Ark sweep] chain source is rate limiting this connection; standing down for',
                Math.round(FG_SWEEP_RATE_LIMIT_BACKOFF_MS / 60000), 'min',
            );
            recordEvent({
                kind: 'ark-bg-refresh',
                trigger: 'foreground',
                outcome: 'error',
                elapsedMs: Date.now() - startedAt,
                vtxoCount: ids.length,
                errorMsg: 'rate-limited by chain source; backing off',
            });
        } else {
            consecutiveFailures += 1;
            console.warn('[Ark sweep] failed:', err?.message ?? err);
            recordEvent({
                kind: 'ark-bg-refresh',
                trigger: 'foreground',
                outcome: 'error',
                elapsedMs: Date.now() - startedAt,
                vtxoCount: ids.length,
                errorMsg: String(err?.message ?? err).slice(0, 200),
            });
        }
    } finally {
        sweepInFlight = false;
    }
}
