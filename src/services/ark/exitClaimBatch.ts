/**
 * When should the exit claim sweep fire?
 *
 * `drainExits([])` already sweeps every currently-claimable capsule into ONE
 * transaction, so cost is per-claim, not per-capsule, and the whole exit can
 * land as a single UTXO at the destination. Claiming the moment the first
 * capsule ripens instead pays a separate fee for every one of them and
 * fragments the result. Seen on a five-capsule exit: 225 sats to move 877, with
 * four more queued behind it, on a fee wallet that had already fallen from 3654
 * to 699 sats, and 2,961 recovered sats delivered as five separate UTXOs.
 *
 * Capsules ripen apart because each has its own exit branch and its own CSV,
 * timed from when THAT branch's transaction confirmed. One block between two
 * confirmations is enough to split the batch.
 *
 * Waiting is safe: past its CSV a claimable exit output is an ordinary UTXO
 * that only this wallet can spend, with no deadline and nobody to race. What is
 * NOT safe is waiting forever, so a wedged capsule cannot hold the rest hostage.
 *
 * BLOCKS, NOT A TIMER. The ripening schedule is known in advance:
 * `ExitState.AwaitingDelta.inner.claimableHeight` is populated the moment a
 * leaf confirms, and it does not move. So "has everything ripened" is a
 * question about the chain tip, not about elapsed time, and answering it with a
 * clock gets it wrong in exactly the case that matters.
 *
 * Measured on the 2026-08-17/20 exit, the three capsules still in flight
 * reported claimableHeight 963101, 963142 and 963145. That is a 44-block spread,
 * about 7.3 hours. Against a 6-hour wall-clock ceiling the window expires
 * roughly 80 minutes BEFORE the last capsule ripens, with one of the three
 * claimable, so the sweep fires early and the exit lands as two UTXOs instead
 * of one. No ceiling tuned in hours fixes this in general: block intervals are
 * stochastic, and the spread is a property of when each branch confirmed.
 *
 * So: when every straggler's ripening height is known, hold until the tip
 * reaches the last of them. That wait provably terminates, because the heights
 * are fixed and the chain only moves forward. The wall-clock backstop stays for
 * the case it is actually good for, a straggler whose ripening height we do NOT
 * know (still broadcasting, or the tip is unreadable), where there is no
 * schedule to wait on and something has to bound the wait.
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
    /** How long to wait for stragglers whose ripening height is UNKNOWN. */
    maxWaitMs: number;
    /**
     * Current chain tip, or null when every provider failed. A null tip means
     * the schedule cannot be evaluated at all, so the wall-clock backstop
     * governs.
     */
    tipHeight?: number | null;
    /**
     * Known `claimableHeight` of each straggler, from
     * `ExitState.AwaitingDelta.inner.claimableHeight`. Stragglers with no known
     * height are counted in `unknownScheduleCount` instead.
     */
    pendingClaimableHeights?: readonly number[];
    /**
     * Stragglers with no readable ripening height, e.g. still Processing so no
     * leaf has confirmed yet. These are what the wall-clock backstop is for.
     */
    unknownScheduleCount?: number;
};

export type ExitClaimBatchDecision = {
    /** Sweep now. */
    claim: boolean;
    /** Start (or keep) the batching window at this epoch ms, null to clear it. */
    batchSince: number | null;
    /** Why, for the drive log. */
    reason:
        | 'nothing-claimable'
        | 'all-ready'
        | 'window-expired'
        | 'waiting'
        | 'waiting-for-schedule';
    /**
     * Blocks until the last straggler ripens, when the schedule is known. Feeds
     * an honest "2 blocks to go" countdown instead of a fake seconds timer.
     */
    blocksUntilAllReady?: number;
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

    const tip =
        typeof input.tipHeight === 'number' && Number.isFinite(input.tipHeight)
            ? Math.floor(input.tipHeight)
            : null;
    const heights = (input.pendingClaimableHeights ?? []).filter(
        (h) => typeof h === 'number' && Number.isFinite(h) && h > 0,
    );
    const unknownSchedule = Math.max(
        0,
        input.unknownScheduleCount ?? stillProgressingCount - heights.length,
    );

    // Every straggler's ripening height is known and the tip is readable, so
    // the wait has a definite end. Hold for it however long the chain takes.
    if (tip != null && unknownSchedule === 0 && heights.length > 0) {
        const lastHeight = Math.max(...heights);
        const blocksUntilAllReady = lastHeight - tip;
        if (blocksUntilAllReady > 0) {
            return {
                claim: false,
                batchSince: since,
                reason: 'waiting-for-schedule',
                blocksUntilAllReady,
            };
        }
        // The tip has passed every scheduled height but the stragglers still
        // are not claimable, so they need confirmations bark has not seen yet,
        // or they are wedged. There is no schedule left to wait on; fall
        // through to the bounded wait.
    }

    // Either a straggler has no known ripening height, or the schedule has run
    // out and something is stuck. Bounded wait, then go without it.
    if (now - since >= maxWaitMs) {
        return { claim: true, batchSince: since, reason: 'window-expired' };
    }

    return { claim: false, batchSince: since, reason: 'waiting' };
}
