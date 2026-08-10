import useAuthStore from '@Cypher/stores/authStore';
import { recordEvent } from '@Cypher/stores/eventLogStore';

import { AVG_BLOCK_MINUTES } from './chainTip';
import {
    ARK_EXIT_RUNWAY_HOURS,
    ARK_REFRESH_MIN_SATS,
    ARK_SWEEP_MAX_RUNWAY_HOURS,
} from './config';
import {
    ArkRefreshInFlightError,
    fetchArkPendingRoundStates,
    refreshArkVtxosDelegatedAndSync,
} from './refresh';
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
 *  - Dust: sub-ARK_REFRESH_MIN_SATS inputs are STRANDED, never ridden along
 *    (one sub-floor input makes bark reject the whole round). User spends them.
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

// Base pacing between sweep submissions. Only actual submissions consume it;
// empty ticks (nothing in-band) re-run the cheap in-memory selection freely.
const FG_SWEEP_MIN_GAP_MS = 5 * 60 * 1000;
// S2: cap the backed-off gap so the sweep still retries a few times an hour
// during a long outage (the fail-streak escalation is the user-facing signal).
const FG_SWEEP_MAX_GAP_MS = 60 * 60 * 1000;

function blocksForHours(hours: number): number {
    return Math.round((hours * 60) / AVG_BLOCK_MINUTES);
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
    if (sweepInFlight) return;
    if (getArkWalletHandle() == null) return;
    if (typeof tip !== 'number') return;

    const store = useAuthStore.getState();
    // A wedged round is owned by the stuck-swap flow; never pile on.
    if (store.arkRefreshStuck) return;

    const floorBlocks = blocksForHours(ARK_EXIT_RUNWAY_HOURS); // 28h
    const ceilBlocks = blocksForHours(ARK_SWEEP_MAX_RUNWAY_HOURS); // 1 week
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
        if (blocksLeft < floorBlocks) continue; // below exit-runway floor: leave alone
        if (blocksLeft > ceilBlocks) continue; // more than a week out: not yet
        if (v.sats < ARK_REFRESH_MIN_SATS) {
            strandedDust += 1; // in-band but sub-floor: cannot refresh on its own
            continue;
        }
        refreshable.push(v);
    }

    if (refreshable.length === 0) {
        // Surface stranded in-band dust so the user knows to spend it (rare;
        // most dust sits above the floor's runway). Cheap outcomes like an
        // empty sweep are intentionally NOT recorded to keep the feed sparse.
        if (strandedDust > 0) {
            recordEvent({
                kind: 'ark-bg-refresh',
                trigger: 'foreground',
                outcome: 'dust_stranded',
                elapsedMs: 0,
                vtxoCount: strandedDust,
            });
        }
        return;
    }

    // S2 backoff: only now (we have work) enforce pacing between submissions.
    const now = Date.now();
    const gap = Math.min(FG_SWEEP_MIN_GAP_MS * (consecutiveFailures + 1), FG_SWEEP_MAX_GAP_MS);
    if (now - lastSweepAt < gap) return;

    // Belt-and-suspenders on top of refresh.ts's own guard: skip if a round is
    // genuinely ongoing so we don't waste a submit + log noise.
    const pending = await fetchArkPendingRoundStates();
    if (pending.some((r) => r.ongoing)) {
        console.log('[Ark sweep] skip: a round is already ongoing');
        return;
    }

    sweepInFlight = true;
    lastSweepAt = now;
    const ids = refreshable.map((v) => v.id);
    const totalSats = refreshable.reduce((sum, v) => sum + v.sats, 0);
    console.log(
        '[Ark sweep] firing for', ids.length, 'vtxo(s), total', totalSats,
        'sats; strandedDust=', strandedDust,
    );
    const startedAt = now;
    try {
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
