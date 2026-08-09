import { getArkWalletHandle, getCachedArkMnemonic } from './walletHandle';
import { fetchArkBalance } from './balance';
import { fetchArkVtxos } from './vtxos';
import { writeArkAutoBackup } from './backup';
import { recordEvent } from '@Cypher/stores/eventLogStore';
import useAuthStore from '@Cypher/stores/authStore';
import type { FeeEstimate, RoundState } from '@secondts/bark-react-native';

export type ArkRefreshFeeView = {
    feeSats: number;
    vtxosSpent: string[];
};

export type ArkRefreshResult = {
    /** Round ID returned by the SDK, or null if no round was scheduled. */
    roundId: string | null;
};

function requireHandle() {
    const handle = getArkWalletHandle();
    if (!handle) {
        throw new Error('Ark wallet not open — cannot refresh VTXOs');
    }
    return handle;
}

/**
 * Thrown when a refresh submission is rejected because another round is
 * already in flight. One wallet participating in multiple concurrent
 * rounds reliably wedges them in `ongoing` state (observed live
 * 2026-07-07: three parallel single-capsule rounds from back-to-back
 * arkoor prompts sat ongoing for 8.6 hours until manually cancelled).
 * Callers catch this to show a "refresh already running" message instead
 * of a generic failure.
 */
export class ArkRefreshInFlightError extends Error {
    constructor(pendingCount: number) {
        super('A refresh is already in progress. Wait for it to finish before starting another.');
        this.name = 'ArkRefreshInFlightError';
        this.pendingCount = pendingCount;
    }
    readonly pendingCount: number;
}

// In-process gate. `refreshVtxos()` blocks for the round's full duration
// (up to ~1h on mainnet), so this flag alone serializes submissions within
// one JS process; the pendingRoundStates pre-check below extends the same
// guarantee across app restarts (a round submitted by a previous process
// still blocks new submissions until it completes or is cancelled).
let refreshSubmissionInFlight = false;

/**
 * Fee preview for refreshing the given VTXOs. Surfaces `feeSats` as a plain
 * number so call sites don't have to deal with bigint. `vtxosSpent` is
 * returned verbatim from the SDK — informational, usually equals the input.
 */
export async function estimateArkRefreshFee(
    vtxoIds: string[],
): Promise<ArkRefreshFeeView> {
    const handle = requireHandle();
    const estimate: FeeEstimate = await handle.estimateRefreshFee(vtxoIds);
    return {
        feeSats: Number(estimate.feeSats),
        vtxosSpent: estimate.vtxosSpent,
    };
}

/**
 * Interactive refresh — joins the next Ark round and re-boards the given
 * VTXOs, extending their expiry by another full lifetime.
 *
 * This is a blocking call: it resolves once the round completes (seconds to
 * low minutes depending on round cadence). The caller should keep a
 * spinner / disabled state up until it resolves.
 *
 * SDK returns `undefined` when the round ran but produced no new VTXOs for us
 * (unusual but possible for edge cases like dust-filtered inputs). We
 * normalise that to `null` in the return type so callers don't have to
 * handle JS undefined.
 */
export async function refreshArkVtxos(
    vtxoIds: string[],
    totalSats?: number,
): Promise<ArkRefreshResult> {
    const handle = requireHandle();

    // Serialize rounds: one refresh at a time, per wallet. The in-process
    // flag catches same-process races; the pendingRoundStates probe catches
    // rounds left in flight by a previous process. Only `ongoing` rounds
    // block — `ongoing=false` (finalising) rounds have terminated
    // server-side, their inputs are already spent, and the next sync
    // ingests them regardless.
    if (refreshSubmissionInFlight) {
        throw new ArkRefreshInFlightError(1);
    }
    const pending = await fetchArkPendingRoundStates();
    const ongoingCount = pending.filter((r) => r.ongoing).length;
    if (ongoingCount > 0) {
        console.log(
            '[Ark refresh] submission blocked:', ongoingCount,
            'round(s) already ongoing',
        );
        throw new ArkRefreshInFlightError(ongoingCount);
    }

    console.log('[Ark refresh] refreshVtxos() calling for', vtxoIds.length, 'vtxo(s):', vtxoIds.map((id) => id.slice(0, 12) + '…'));
    const t0 = Date.now();
    // Activity log: correlationId links the started/finished pair so the
    // UI can show "Refreshing… → Refresh complete" as a single timeline
    // entry. Round ID from the SDK is intentionally NOT used (privacy +
    // it can be undefined). Totals fall back to 0 when the caller
    // didn't pass them — the kind+wallet still carry the signal.
    const correlationId = `${t0.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    recordEvent({
        kind: 'ark-refresh-started',
        vtxoCount: vtxoIds.length,
        totalSats: totalSats ?? 0,
        correlationId,
    });
    refreshSubmissionInFlight = true;
    try {
        const roundId = await handle.refreshVtxos(vtxoIds);
        console.log(
            '[Ark refresh] refreshVtxos() resolved in', Math.round((Date.now() - t0) / 1000), 's, roundId=',
            roundId ?? '(undefined)',
        );
        recordEvent({
            kind: 'ark-refresh-finished',
            correlationId,
            result: 'success',
            durationMs: Date.now() - t0,
        });
        // Any successful round breaks the failure streak that drives the
        // refresh-failing-near-expiry escalation in useArkSync.
        useAuthStore.getState().setArkRefreshFailStreak(0);
        return { roundId: roundId ?? null };
    } catch (err: any) {
        // BarkError variants carry detail in `err.inner.errorMessage` rather than
        // `err.message` (which only reports the variant tag, e.g. "BarkError.Internal").
        // Surface the inner detail so we can see why bark actually rejected the call.
        const inner = err?.inner?.errorMessage ?? err?.inner?.message ?? null;
        const tag = err?.tag ?? null;
        console.warn(
            '[Ark refresh] refreshVtxos() threw after', Math.round((Date.now() - t0) / 1000),
            's: tag=', tag, 'inner=', inner, 'message=', err?.message ?? String(err),
        );
        recordEvent({
            kind: 'ark-refresh-finished',
            correlationId,
            result: 'failure',
            durationMs: Date.now() - t0,
        });
        // Count consecutive failed submissions across every refresh path
        // (Capsules tab, notification tap, background sweep all land
        // here). The pre-submission ArkRefreshInFlightError guard above
        // doesn't reach this catch, so "already running" rejections
        // don't inflate the streak. useArkSync escalates once the streak
        // crosses its threshold while a VTXO is near expiry.
        const store = useAuthStore.getState();
        store.setArkRefreshFailStreak(store.arkRefreshFailStreak + 1);
        throw err;
    } finally {
        refreshSubmissionInFlight = false;
    }
}

/**
 * Convenience: refresh + sync + refetch balance/vtxos in one shot so the
 * caller can await a single promise before tearing down any loading UI.
 *
 * The `wallet.sync()` call is critical after `refreshVtxos()` — the round
 * finalizes server-side and the ASP emits the new VTXO, but the local
 * datadir doesn't ingest any of that until we explicitly sync. Without
 * it, `allVtxos()` still returns the pre-refresh VTXO as Spendable (the
 * old one never flips to Spent, and the new post-refresh VTXO never
 * appears). Balance can look partially-updated because the fee side is
 * tracked locally, which is what makes this bug confusing.
 *
 * Esplora tip deliberately NOT refetched here — that's cheap and already
 * on the 30s poll; no need to block the user on it.
 */
export async function refreshArkVtxosAndSync(
    vtxoIds: string[],
    totalSats?: number,
): Promise<ArkRefreshResult> {
    const handle = requireHandle();
    const result = await refreshArkVtxos(vtxoIds, totalSats);
    // Pull the round outcome into the local datadir before we re-read.
    await handle.sync();
    await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
    // G2: eager backup so the just-refreshed state is captured now, not on
    // the up-to-60s auto-backup tick. A reinstall in that gap would otherwise
    // lose the new (non-seed-derivable) VTXO. Cached mnemonic (no biometric
    // prompt), fire-and-forget with a swallowed error, mirroring the tick.
    const eagerMnemonic = getCachedArkMnemonic();
    if (eagerMnemonic) {
        writeArkAutoBackup(eagerMnemonic).catch((e: any) =>
            console.warn('[Ark refresh] eager backup failed (non-fatal):', e?.message ?? e),
        );
    }
    return result;
}

export type ArkDelegatedRefreshResult = {
    /**
     * RoundState the ASP returned when it ACCEPTED the delegation, or null if
     * the SDK scheduled nothing. Note this is "accepted", not "completed": the
     * server finishes the round later and the refreshed VTXO only appears after
     * a subsequent `sync()`.
     */
    roundState: RoundState | null;
};

/**
 * Delegated refresh — the mobile-appropriate path. Hands the given VTXOs to
 * the ASP to re-board on our behalf in the next round.
 *
 * Unlike self-signed `refreshArkVtxos` (which blocks for the whole round, up
 * to ~1h, and needs the app foregrounded the entire time), this returns as
 * soon as the ASP ACCEPTS the delegation (seconds). The server then carries
 * the round to completion with no client presence, so the app can background
 * immediately. Confirmed reliable by Second.tech.
 *
 * IMPORTANT: resolving here means "delegation accepted", NOT "VTXO refreshed".
 * The refreshed VTXO materialises only after the round finalises server-side
 * and a later `sync()` ingests it. That later sync is also where the client
 * VALIDATES the new VTXO (the liveness/verification step the trust model
 * requires).
 *
 * Serialization: we reuse the same ongoing-round pre-check as the self-signed
 * path (one wallet cannot be in two rounds at once). We do NOT hold the
 * `refreshSubmissionInFlight` flag for the round's duration the way the
 * blocking path does, because this call returns long before the round ends;
 * the `pendingRoundStates` ongoing-check is what prevents overlap across the
 * server-side round.
 */
export async function refreshArkVtxosDelegated(
    vtxoIds: string[],
    totalSats?: number,
): Promise<ArkDelegatedRefreshResult> {
    const handle = requireHandle();

    // Cross-caller submission guard. `refreshSubmissionInFlight` is shared
    // with the self-signed path and now also with delegated maintenance, so
    // an arkoor auto-refresh, a Capsules tap-refresh, and a background wake
    // cannot all submit at once. It closes the window between the pending-
    // round check below and the ASP marking the new round `ongoing`: without
    // it, two callers both read 0 ongoing and start two single-wallet rounds,
    // which wedge each other server-side for hours (the exact deadlock the
    // old auto-refresh was removed to avoid).
    if (refreshSubmissionInFlight) {
        throw new ArkRefreshInFlightError(0);
    }
    // Block only when a round is genuinely still ongoing server-side. A
    // finalising (`ongoing=false`) round has terminated and the next sync
    // ingests it, so it must not block a fresh delegation.
    const pending = await fetchArkPendingRoundStates();
    const ongoingCount = pending.filter((r) => r.ongoing).length;
    if (ongoingCount > 0) {
        console.log(
            '[Ark refresh] delegated submission blocked:', ongoingCount,
            'round(s) already ongoing',
        );
        throw new ArkRefreshInFlightError(ongoingCount);
    }
    refreshSubmissionInFlight = true;

    console.log(
        '[Ark refresh] refreshVtxosDelegated() calling for', vtxoIds.length,
        'vtxo(s):', vtxoIds.map((id) => id.slice(0, 12) + '…'),
    );
    const t0 = Date.now();
    const correlationId = `${t0.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    recordEvent({
        kind: 'ark-refresh-started',
        vtxoCount: vtxoIds.length,
        totalSats: totalSats ?? 0,
        correlationId,
    });
    try {
        const roundState = await handle.refreshVtxosDelegated(vtxoIds);
        console.log(
            '[Ark refresh] refreshVtxosDelegated() accepted in',
            Math.round((Date.now() - t0) / 1000), 's',
        );
        // "finished" here = the ASP accepted the delegation, NOT that the VTXO
        // is refreshed. Actual completion is observed on the next sync.
        recordEvent({
            kind: 'ark-refresh-finished',
            correlationId,
            result: 'success',
            durationMs: Date.now() - t0,
        });
        // bark 0.6.0: the submitted VTXOs stay `Spendable` (no longer marked
        // `Locked`), so track their ids here to drive the per-capsule
        // "Refreshing" animation until the round finalises. useArkSync prunes
        // them once they leave the wallet or nothing is left in a round.
        const store = useAuthStore.getState();
        store.setArkRefreshingVtxoIds(
            Array.from(new Set([...store.arkRefreshingVtxoIds, ...vtxoIds])),
        );
        // Acceptance breaks the failure streak that drives the
        // refresh-failing-near-expiry escalation in useArkSync.
        store.setArkRefreshFailStreak(0);
        return { roundState: roundState ?? null };
    } catch (err: any) {
        // BarkError carries detail in `err.inner.errorMessage`, not `err.message`.
        const inner = err?.inner?.errorMessage ?? err?.inner?.message ?? null;
        const tag = err?.tag ?? null;
        console.warn(
            '[Ark refresh] refreshVtxosDelegated() threw after',
            Math.round((Date.now() - t0) / 1000),
            's: tag=', tag, 'inner=', inner, 'message=', err?.message ?? String(err),
        );
        recordEvent({
            kind: 'ark-refresh-finished',
            correlationId,
            result: 'failure',
            durationMs: Date.now() - t0,
        });
        const store = useAuthStore.getState();
        store.setArkRefreshFailStreak(store.arkRefreshFailStreak + 1);
        throw err;
    } finally {
        // Held only across the submit (seconds, until accept). Once accepted
        // the round is `ongoing`, so the pending-round check guards it from
        // here; releasing lets the next legitimate submission proceed.
        refreshSubmissionInFlight = false;
    }
}

/**
 * Convenience: delegated refresh + sync + refetch balance/vtxos, mirroring
 * `refreshArkVtxosAndSync` for the self-signed path. The sync pulls the new
 * in-round state into the local datadir so the capsule row flips to its
 * "Refreshing" treatment without waiting for the 30s useArkSync tick. The
 * round still completes server-side later; the refreshed VTXO appears on a
 * subsequent sync (which is also where the client validates it).
 */
export async function refreshArkVtxosDelegatedAndSync(
    vtxoIds: string[],
    totalSats?: number,
): Promise<ArkDelegatedRefreshResult> {
    const handle = requireHandle();
    const result = await refreshArkVtxosDelegated(vtxoIds, totalSats);
    await handle.sync();
    await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
    // G2: eager backup so the just-refreshed state is captured now, not on
    // the up-to-60s auto-backup tick. A reinstall in that gap would otherwise
    // lose the new (non-seed-derivable) VTXO. Cached mnemonic (no biometric
    // prompt), fire-and-forget with a swallowed error, mirroring the tick.
    const eagerMnemonic = getCachedArkMnemonic();
    if (eagerMnemonic) {
        writeArkAutoBackup(eagerMnemonic).catch((e: any) =>
            console.warn('[Ark refresh] eager backup failed (non-fatal):', e?.message ?? e),
        );
    }
    return result;
}

/**
 * Background maintenance via delegation — asks the SDK to refresh whatever
 * VTXOs are due (its own `getVtxosToRefresh` policy) and hand them to the ASP
 * on our behalf. This is the unattended background engine: the app wakes on a
 * silent push, calls this, then backgrounds again while the server runs the
 * round(s).
 *
 * The SDK selects and submits internally (no vtxoIds arg). Like the delegated
 * refresh above, resolving means the delegation was accepted, not that any
 * VTXO is refreshed yet; the next `sync()` reconciles + validates.
 *
 * Errors are surfaced to the caller (the background trigger records telemetry
 * and decides whether to notify), unlike `progressArkPendingRounds` which
 * swallows.
 */
export async function maintenanceArkDelegated(): Promise<void> {
    const handle = requireHandle();
    // Same cross-caller guard as refreshArkVtxosDelegated: the background wake
    // must not submit a maintenance round while another submission is mid-
    // flight or a round is already ongoing (previously this path had no check
    // at all).
    if (refreshSubmissionInFlight) {
        throw new ArkRefreshInFlightError(0);
    }
    const pending = await fetchArkPendingRoundStates();
    const ongoingCount = pending.filter((r) => r.ongoing).length;
    if (ongoingCount > 0) {
        throw new ArkRefreshInFlightError(ongoingCount);
    }
    refreshSubmissionInFlight = true;
    const t0 = Date.now();
    console.log('[Ark refresh] maintenanceDelegated() calling');
    try {
        await handle.maintenanceDelegated();
        console.log(
            '[Ark refresh] maintenanceDelegated() accepted in',
            Math.round((Date.now() - t0) / 1000), 's',
        );
    } catch (err: any) {
        const inner = err?.inner?.errorMessage ?? err?.inner?.message ?? null;
        const tag = err?.tag ?? null;
        console.warn(
            '[Ark refresh] maintenanceDelegated() threw after',
            Math.round((Date.now() - t0) / 1000),
            's: tag=', tag, 'inner=', inner, 'message=', err?.message ?? String(err),
        );
        throw err;
    } finally {
        refreshSubmissionInFlight = false;
    }
}

/**
 * Drive any pending rounds forward.
 *
 * THIS IS THE STUCK-VTXO RECOVERY PATH. Per Bark dev (Erik) on 2026-04-30:
 *
 *   "If you close mid-app this process will try to recover.
 *    - If you already signed everything and the round succeeds it will pick it up.
 *    - If you were kicked from the round you will get a failed movement and your
 *      vtxos will be unlocked."
 *
 * That recovery only happens when SOMETHING calls `progressPendingRounds()`
 * (the SDK's "advance the state machine" entry point) on a regular cadence.
 * Before this call existed in our codebase, a refresh round interrupted by
 * an app-kill / network blip / JS-thread stall would leave the VTXO Locked
 * in our local SQLite forever — even though the round had succeeded or
 * failed server-side. The "fix" users reached for was Reset Ark wallet
 * state, which nukes the datadir and erases the VTXO entirely (because
 * Ark VTXO state is not seed-derivable).
 *
 * Calling this every sync cycle lets the SDK reconcile any orphaned
 * pending rounds:
 *   - Round completed server-side → SDK ingests the new VTXO, old one
 *     flips to Spent, balance updates.
 *   - Round failed / wallet kicked → SDK emits a failed movement,
 *     unlocks the input VTXO so the user can retry.
 *
 * Errors are swallowed: this is advisory progress, not a critical operation.
 * Failure to advance one cycle is fine; the next cycle retries.
 */
export async function progressArkPendingRounds(): Promise<void> {
    const handle = getArkWalletHandle();
    if (!handle) return;
    try {
        await handle.progressPendingRounds();
    } catch (err: any) {
        console.warn(
            '[Ark refresh] progressPendingRounds threw (advisory, continuing):',
            err?.message ?? err,
        );
    }
}

/**
 * Snapshot of which rounds the SDK currently considers pending.
 *
 * `ongoing: true`  → the ASP / SDK is still working the round; wait.
 * `ongoing: false` → the round has terminated server-side but our local DB
 *                    hasn't yet ingested the result. Next sync should clear it;
 *                    if it doesn't, this is a candidate for `cancelPendingRound`.
 *
 * Used today for observability (the [Ark sync] log line shows pending count).
 * Will become the gate for the user-facing "Cancel stuck refresh" action
 * once that UI lands.
 *
 * Returns [] on any error / no handle so callers don't have to check.
 */
export async function fetchArkPendingRoundStates(): Promise<RoundState[]> {
    const handle = getArkWalletHandle();
    if (!handle) return [];
    try {
        return await handle.pendingRoundStates();
    } catch (err: any) {
        console.warn(
            '[Ark refresh] pendingRoundStates threw:',
            err?.message ?? err,
        );
        return [];
    }
}

/**
 * Round cadence (seconds between rounds) from the ASP's static config.
 *
 * Per Erik (Bark team): mainnet runs a round every 1h, signet every 5m. The
 * client locks the VTXO immediately on `refreshVtxos()` but the round
 * itself only fires on the server's interval, so worst-case wait is one
 * full `roundIntervalSecs` from the moment the user tapped Refresh.
 *
 * The SDK does NOT expose `nextRoundAt` / `lastRoundAt`, so we surface this
 * as the upper-bound ETA ("Refreshing… ≤1h") in the UI rather than a
 * spurious live countdown.
 *
 * Cached per session — round interval is server config and doesn't change
 * between calls. Caller should fetch once after the wallet handle is open.
 * Returns `null` on any error / no handle so callers don't have to branch.
 */
export async function fetchArkRoundIntervalSecs(): Promise<number | null> {
    const handle = getArkWalletHandle();
    if (!handle) return null;
    try {
        const info = await handle.arkInfo();
        if (!info) return null;
        return Number(info.roundIntervalSecs);
    } catch (err: any) {
        console.warn(
            '[Ark refresh] arkInfo threw:',
            err?.message ?? err,
        );
        return null;
    }
}

/**
 * Fetch the ASP's minimum board amount in sats. A top-up below this confirms
 * on-chain but the server rejects `boardAll()` with BarkError.Internal
 * ("board amount ... is less than minimum board amount required by server"),
 * so the deposit never becomes a VTXO and the app retries forever. The UI
 * gates Ark top-ups on this value. Returns `null` on any error / no handle so
 * callers can fall back to a sane constant.
 */
export async function fetchArkMinBoardSats(): Promise<number | null> {
    const handle = getArkWalletHandle();
    if (!handle) return null;
    try {
        const info = await handle.arkInfo();
        if (!info) return null;
        return Number(info.minBoardAmountSats);
    } catch (err: any) {
        console.warn(
            '[Ark] arkInfo (minBoard) threw:',
            err?.message ?? err,
        );
        return null;
    }
}

/**
 * Cancel a specific pending round. Wraps the SDK call to give callers a
 * uniform error-shape and keep the import surface consistent with the
 * other refresh helpers.
 *
 * Per Erik: cancelling unlocks the input VTXOs so the user can retry. The
 * server may refuse if the round is already finalised (unilateral close),
 * in which case `wallet.sync()` will pick up the result.
 */
export async function cancelArkPendingRound(roundId: number): Promise<void> {
    const handle = requireHandle();
    try {
        await handle.cancelPendingRound(roundId);
    } catch (err: any) {
        // BarkError variants carry the bark-side reason in
        // `err.inner.errorMessage` rather than `err.message`. Surface
        // the inner detail so caller logs / telemetry capture WHY
        // cancellation was refused (round already past commit, server-
        // side state mismatch, etc.) instead of the opaque
        // "BarkError.Internal" string. Same shape as the improved
        // refreshVtxos() error logging.
        const inner = err?.inner?.errorMessage ?? err?.inner?.message ?? null;
        const tag = err?.tag ?? null;
        console.warn(
            '[Ark refresh] cancelPendingRound threw: roundId=', roundId,
            'tag=', tag, 'inner=', inner, 'message=', err?.message ?? String(err),
        );
        throw err;
    }
}
