import { getArkWalletHandle } from './walletHandle';
import { fetchArkBalance } from './balance';
import { fetchArkVtxos } from './vtxos';
import { recordEvent } from '@Cypher/stores/eventLogStore';
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
        return { roundId: roundId ?? null };
    } catch (err: any) {
        console.warn('[Ark refresh] refreshVtxos() threw after', Math.round((Date.now() - t0) / 1000), 's:', err?.message ?? err);
        recordEvent({
            kind: 'ark-refresh-finished',
            correlationId,
            result: 'failure',
            durationMs: Date.now() - t0,
        });
        throw err;
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
    return result;
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
    await handle.cancelPendingRound(roundId);
}
