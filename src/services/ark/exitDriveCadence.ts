/**
 * What the exit drive should do on this tick.
 *
 * THE PROBLEM
 *
 * The drive polls hard for an event whose block height it already knows. Once
 * every leaf is confirmed and sitting in AwaitingDelta, `claimableHeight` is
 * populated and fixed, and for the next vtxoExitDelta blocks (~24h) there is
 * exactly one question worth asking: has the tip passed it.
 *
 * Answering it used to cost a full syncArkWallet + progressExits + syncExits +
 * listClaimableExits + allVtxos + balance, roughly 20 requests, because the full
 * drive WAS the unit of polling. Measured on the 2026-08-22 mainnet exit: 44
 * hours, roughly 40 of them waiting. Blockstream's unauthenticated cap is 700
 * requests/hour/IP and it is shared behind CGNAT.
 *
 * THE FIX
 *
 * Separate "has anything changed" from "do the work". Checking the tip is one
 * request. The full drive runs only when the answer is yes.
 *
 *   broadcasting  full drive, fast. Each tree level needs the app to relay the
 *                 next, so this is the phase that genuinely needs attention.
 *   waiting       tip poll only, paced by blocks remaining. A full drive when
 *                 the tip crosses the soonest claimableHeight, or on the floor
 *                 below.
 *   claimable     full drive, fast. The claim is the point.
 *
 * WHY THIS NEEDED A LIVE TIP FIRST
 *
 * An earlier attempt tapered the full drive by blocks remaining and could not
 * work, because no live tip existed during an exit: `arkChainTipHeight` is
 * frozen (#204) and `ExitState.inner.tipHeight` is stamped once on entry and
 * never advances. Both give a constant blocks-remaining. Polling the tip
 * ourselves is what makes the taper real, and writing it to the store is what
 * closes #204 as a side effect.
 *
 * REQUEST BUDGET, over a ~24h (144 block) wait
 *
 *   before, 120s flat        ~720 full drives      ~14,400 requests
 *   30 min flat (shipped)     ~48 full drives         ~960 requests
 *   this                     ~180 tip polls + 4        ~260 requests
 *
 * and it is responsive at the end rather than up to 30 minutes late, because
 * the poll tightens to 2 minutes as ripening approaches.
 *
 * Pure and import-free, matching exitClaimBatch.ts and changeRefresh.ts.
 */

/** State observed on the last FULL drive. Costs nothing: it already had it. */
export type ExitDriveSnapshot = {
    /** Capsules ready to sweep now. */
    claimableCount: number;
    /** `claimableHeight` of each capsule waiting out its CSV. */
    awaitingHeights: readonly number[];
    /** Capsules still broadcasting, so no ripening height yet. */
    processingCount: number;
};

export type ExitDrivePhase = 'broadcasting' | 'claimable' | 'waiting' | 'unknown';

/** Everything except a tip poll. */
export type ExitDriveAction = 'full' | 'tip' | 'skip';

/** Full-drive cadence for the phases that need one every tick. */
export const EXIT_DRIVE_FAST_MS = 120_000;

/** Tip-poll cadence, by blocks until the soonest ripening. One request each. */
export const TIP_POLL_NEAR_MS = 120_000;
export const TIP_POLL_MID_MS = 5 * 60_000;
export const TIP_POLL_FAR_MS = 10 * 60_000;

/**
 * A full drive at least this often while waiting, whatever the tip says.
 *
 * bark's AwaitingDelta arm calls `check_confirmed` on every progressExits and
 * drops back to Processing if the exit transaction has vanished in a reorg.
 * Polling only the tip gives that up, so this is the floor that bounds how long
 * a reorg can go unnoticed.
 *
 * Six hours rather than one is a deliberate trade. An hourly floor costs ~480
 * requests over a 24h wait and would dominate the budget this change exists to
 * cut. The exposure it buys back is bounded and mild: a missed reorg delays the
 * exit until the next full drive, it does not lose funds, and the transaction
 * is buried deeper with every hour that passes.
 */
export const FULL_DRIVE_FLOOR_MS = 6 * 60 * 60_000;

export type ExitDrivePlan = {
    action: ExitDriveAction;
    phase: ExitDrivePhase;
    /** Interval this phase warrants, for the log. */
    waitMs: number;
    /** Blocks until the SOONEST ripening, when it can be computed. */
    blocksToNext: number | null;
    /** Why, for the drive log. */
    reason: string;
};

export function decideExitDrivePlan(args: {
    last: ExitDriveSnapshot | null;
    /** Freshest tip known, from the poll. null when it could not be read. */
    tipHeight: number | null;
    now: number;
    lastFullRunAt: number;
    lastTipPollAt: number;
}): ExitDrivePlan {
    const { last, tipHeight, now, lastFullRunAt, lastTipPollAt } = args;
    const sinceFull = now - lastFullRunAt;
    const sinceTip = now - lastTipPollAt;

    const full = (phase: ExitDrivePhase, reason: string): ExitDrivePlan => ({
        action: sinceFull >= EXIT_DRIVE_FAST_MS ? 'full' : 'skip',
        phase,
        waitMs: EXIT_DRIVE_FAST_MS,
        blocksToNext: null,
        reason,
    });

    // No snapshot yet (first drive of a session, or a cold launch mid-exit).
    // Run: we cannot reason about a phase we have never observed.
    if (last == null) {
        return { action: 'full', phase: 'unknown', waitMs: EXIT_DRIVE_FAST_MS, blocksToNext: null, reason: 'no-snapshot' };
    }

    // Anything still broadcasting needs the app every tick, because each tree
    // level must be relayed before the next can go. Checked FIRST: a straggler
    // still needs relaying even when other capsules have already ripened.
    if (last.processingCount > 0) return full('broadcasting', 'still-broadcasting');

    // Something is ready to sweep. The claim is the whole point.
    if (last.claimableCount > 0) return full('claimable', 'claim-ready');

    const heights = last.awaitingHeights.filter((h) => Number.isFinite(h) && h > 0);
    if (heights.length === 0) {
        // Active exit, but no capsule in any phase we recognise. Erring toward
        // more requests is wrong for THIS issue and right for not stalling an
        // exit: a stalled exit costs the user far more than a quota.
        return full('unknown', 'no-known-schedule');
    }

    // Reorg floor. Placed inside the waiting branch because it is the only
    // phase that would otherwise go hours without calling progressExits.
    if (sinceFull >= FULL_DRIVE_FLOOR_MS) {
        return { action: 'full', phase: 'waiting', waitMs: EXIT_DRIVE_FAST_MS, blocksToNext: null, reason: 'reorg-floor' };
    }

    const soonest = Math.min(...heights);

    // No usable tip: the poll failed, or has not run yet. Do not guess a
    // cadence from a number we do not have.
    if (tipHeight == null || !Number.isFinite(tipHeight)) {
        return {
            action: sinceTip >= TIP_POLL_NEAR_MS ? 'tip' : 'skip',
            phase: 'waiting',
            waitMs: TIP_POLL_NEAR_MS,
            blocksToNext: null,
            reason: 'tip-unknown',
        };
    }

    // Something ripened. This is the whole reason the poll exists.
    if (tipHeight >= soonest) {
        return { action: 'full', phase: 'waiting', waitMs: EXIT_DRIVE_FAST_MS, blocksToNext: 0, reason: 'tip-crossed' };
    }

    const blocksToNext = soonest - tipHeight;
    const waitMs =
        blocksToNext > 20 ? TIP_POLL_FAR_MS : blocksToNext >= 6 ? TIP_POLL_MID_MS : TIP_POLL_NEAR_MS;

    return {
        action: sinceTip >= waitMs ? 'tip' : 'skip',
        phase: 'waiting',
        waitMs,
        blocksToNext,
        reason: 'awaiting-ripening',
    };
}
