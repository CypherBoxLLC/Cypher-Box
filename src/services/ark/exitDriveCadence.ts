/**
 * How often the exit drive should actually run.
 *
 * THE PROBLEM
 *
 * The drive polls hard for an event whose block height it already knows. Once
 * every leaf is confirmed and sitting in AwaitingDelta, `claimableHeight` is
 * populated and fixed, and for the next vtxoExitDelta blocks (~24h) there is
 * exactly one question worth asking: has the tip passed it. The drive instead
 * ran a full syncArkWallet + progressExits + syncExits + listClaimableExits +
 * allVtxos + balance every 120 seconds for that entire window, and
 * `progressExits` had nothing to progress during any of it.
 *
 * Measured on the 2026-08-22 mainnet exit: 44 hours total, of which roughly 40
 * were spent in AwaitingDelta with nothing to broadcast. At 120s that is ~1,200
 * full drives to observe two block heights arriving. Blockstream's
 * unauthenticated cap is 700 requests/hour/IP, and it is per IP, so a user
 * behind CGNAT shares it with strangers. On 2026-08-24 that cap was hit and the
 * wallet would not open at all. See #194.
 *
 * THE FIX, AND WHY IT IS A FLAT INTERVAL RATHER THAN A GRADUATED ONE
 *
 * Back the waiting phase off to a single long interval. Three phases with
 * genuinely different needs previously shared one timer:
 *
 *   broadcasting  urgent, racing expiry, keep the fast cadence
 *   waiting       ~95% of wall clock, nothing to do until the tip moves
 *   claimable     one drainExits, fire promptly
 *
 * The obvious refinement is to taper: back off hard while ripening is hours
 * away and tighten as it approaches. That needs a chain tip, and DURING AN EXIT
 * THERE IS NO FREE ONE.
 *
 *   - `arkChainTipHeight` in the store is frozen for the duration of an exit,
 *     because the sync loop returns before refreshing it (#204).
 *   - `ExitState.inner.tipHeight` on the exit records is ALSO frozen. bark
 *     stamps it once when the state is entered and never rewrites it: the
 *     AwaitingDelta arm returns its state unchanged while `tip <
 *     claimable_height`, and bark only persists a state that differs from the
 *     stored one. Verified against bark 0.6.1 and confirmed on device, where
 *     one capsule read 963510 across four captures spanning 21 hours while the
 *     chain advanced to 963795. Only the Claimable transition restamps it.
 *
 * A taper driven off either value computes a CONSTANT blocks-remaining of about
 * vtxoExitDelta and therefore never tapers, so it would be dead code wearing
 * the label of a live optimisation. This module does not pretend otherwise.
 *
 * The cost of the flat interval is that a claim can fire up to one interval
 * after its capsule ripens. That is safe: past its CSV an exit output is an
 * ordinary UTXO only this wallet can spend, with no deadline and nobody to race.
 *
 * The real fix is to stop using the full drive as the unit of polling: check the
 * tip with one `/blocks/tip/height` request on a tight cadence, and run the full
 * drive only when the tip has crossed a `claimableHeight`. That is ~1 request
 * per check instead of ~20, stays responsive at ripening, and unfreezes #204 as
 * a side effect. It is a larger change than this one and wants verification
 * against a live multi-day exit, so it is tracked as #219.
 *
 * WHY DECIDING NEEDS NO REQUESTS
 *
 * The decision reads a snapshot the PREVIOUS drive already fetched. Every field
 * comes from calls the drive makes anyway for its claim-batching decision, so
 * the cost of deciding is zero.
 *
 * Pure and import-free, matching exitClaimBatch.ts and changeRefresh.ts.
 */

/** State observed on the last drive. Costs nothing: the drive already had it. */
export type ExitDriveSnapshot = {
    /** Capsules ready to sweep now. */
    claimableCount: number;
    /** Capsules confirmed and waiting out the CSV, with a known ripening height. */
    awaitingCount: number;
    /** Capsules still broadcasting, so no ripening height yet. */
    processingCount: number;
};

export type ExitDrivePhase = 'broadcasting' | 'claimable' | 'waiting' | 'unknown';

/** Fast cadence, unchanged from the original flat throttle. */
export const EXIT_DRIVE_FAST_MS = 120_000;
/** Every capsule is waiting out its CSV. Nothing to do until the chain moves. */
export const EXIT_DRIVE_WAITING_MS = 30 * 60_000;

export type ExitDriveDecision = {
    run: boolean;
    phase: ExitDrivePhase;
    /** Interval this phase warrants, for the log and the next comparison. */
    waitMs: number;
};

export function decideExitDriveCadence(args: {
    last: ExitDriveSnapshot | null;
    now: number;
    lastRunAt: number;
}): ExitDriveDecision {
    const { last, now, lastRunAt } = args;
    const elapsed = now - lastRunAt;
    const fast = (phase: ExitDrivePhase): ExitDriveDecision => ({
        run: elapsed >= EXIT_DRIVE_FAST_MS,
        phase,
        waitMs: EXIT_DRIVE_FAST_MS,
    });

    // No snapshot yet (first drive of a session, or a cold launch mid-exit).
    // Run: we cannot reason about a phase we have never observed.
    if (last == null) {
        return { run: true, phase: 'unknown', waitMs: EXIT_DRIVE_FAST_MS };
    }

    // Anything still broadcasting is racing expiry and needs the app's
    // attention every tick, because each tree level needs the app to relay the
    // next. This is the phase the old flat throttle was actually tuned for, and
    // it keeps that cadence. Checked FIRST: a straggler still needs relaying
    // even when other capsules have already ripened.
    if (last.processingCount > 0) return fast('broadcasting');

    // Something is ready to sweep. Fire promptly: the claim is the whole point
    // and waiting on it strands recovered value.
    if (last.claimableCount > 0) return fast('claimable');

    // Everything is confirmed and waiting out its CSV. Nothing this app can do
    // changes anything until the chain advances past a claimableHeight.
    if (last.awaitingCount > 0) {
        return { run: elapsed >= EXIT_DRIVE_WAITING_MS, phase: 'waiting', waitMs: EXIT_DRIVE_WAITING_MS };
    }

    // An exit is flagged active but the snapshot shows no capsule in any known
    // phase. Erring toward more requests is wrong for THIS issue and right for
    // not stalling an exit: a stalled exit costs the user far more than a quota.
    return fast('unknown');
}
