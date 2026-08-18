/**
 * When should the exit claim sweep fire?
 *
 * `drainExits([])` already sweeps every currently-claimable capsule into ONE
 * transaction, so cost is per-claim, not per-capsule. Claiming the moment the
 * first capsule ripens therefore pays a separate fee for every one of them.
 * Seen on a five-capsule exit: 225 sats to move 877, with four more queued
 * behind it, on a fee wallet that had already fallen from 3654 to 699 sats.
 *
 * Capsules ripen apart because each has its own exit branch and its own CSV,
 * timed from when THAT branch's transaction confirmed. One block between two
 * confirmations is enough to split the batch.
 *
 * Waiting is safe: past its CSV a claimable exit output is an ordinary UTXO
 * that only this wallet can spend, with no deadline and nobody to race. What is
 * NOT safe is waiting forever, so a wedged capsule cannot hold the rest hostage.
 *
 * Lives here rather than inline in useArkSync so the rule can be tested without
 * standing up the sync loop.
 */

export type ExitClaimBatchInput = {
    /** Capsules ready to sweep right now. */
    claimableCount: number;
    /** Active exits NOT yet claimable, i.e. stragglers still worth waiting for. */
    stillProgressingCount: number;
    /** Epoch ms when the first capsule became claimable, null before that. */
    batchSince: number | null;
    /** Current epoch ms. */
    now: number;
    /** How long to wait for stragglers before sweeping without them. */
    maxWaitMs: number;
};

export type ExitClaimBatchDecision = {
    /** Sweep now. */
    claim: boolean;
    /** Start (or keep) the batching window at this epoch ms, null to clear it. */
    batchSince: number | null;
    /** Why, for the drive log. */
    reason: 'nothing-claimable' | 'all-ready' | 'window-expired' | 'waiting';
};

export function decideExitClaimBatch(input: ExitClaimBatchInput): ExitClaimBatchDecision {
    const { claimableCount, stillProgressingCount, batchSince, now, maxWaitMs } = input;

    if (claimableCount <= 0) {
        // Nothing to sweep. Clear the window so a future capsule starts a fresh
        // one instead of inheriting stale elapsed time from a previous batch.
        return { claim: false, batchSince: null, reason: 'nothing-claimable' };
    }

    // First capsule of this batch: the window opens now.
    const since = batchSince ?? now;

    // Nothing else is coming, so batching can only cost time.
    if (stillProgressingCount === 0) {
        return { claim: true, batchSince: since, reason: 'all-ready' };
    }

    // A straggler is wedged or simply slow. Bounded wait, then go without it.
    if (now - since >= maxWaitMs) {
        return { claim: true, batchSince: since, reason: 'window-expired' };
    }

    return { claim: false, batchSince: since, reason: 'waiting' };
}
