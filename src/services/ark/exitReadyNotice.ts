/**
 * When should the app tell the user their exit is ready to finish?
 *
 * THE PROBLEM
 *
 * An exit needs the user to open the app once, at a moment nobody can guess.
 * On 2026-08-19 a claim landed within one block of ripening purely because
 * someone happened to be awake and holding the phone. The drive is
 * foreground-only, so a user who closes the app has no way of knowing when to
 * come back, and the panel's own copy used to promise the funds swept
 * themselves.
 *
 * ONE NOTIFICATION, AT THE HEIGHT THE BATCH IS ALREADY WAITING FOR
 *
 * The tempting design is one alarm per capsule, as each becomes claimable.
 * That is wrong. `decideExitClaimBatch` deliberately holds the sweep until
 * every capsule has ripened, so the whole exit lands as one UTXO paying one
 * transaction overhead instead of N. A per-capsule alarm therefore fires, the
 * user opens the app, the batch correctly holds, and nothing visible happens.
 * Then it happens again.
 *
 * Measured on the 2026-08-22 mainnet exit, 7 capsules holding 4,990 sats:
 *
 *   aa2c257e  800  leaf @963390  claimable @963534
 *   d4ec1101  700  leaf @963390  claimable @963534
 *   1f6627c2  698  leaf @963390  claimable @963534
 *   9211887d  698  leaf @963455  claimable @963599
 *   a6e24d2f  698  leaf @963455  claimable @963599
 *   bc672cb8  698  leaf @963455  claimable @963599
 *   ec46d966  698  leaf @963508  claimable @963652
 *
 * The batch fires at 963652. A per-capsule schedule would have fired at
 * 963534, then 963599, then 963652: two of the three are pure noise. So the
 * trigger is `max(claimableHeight)` across everything still ripening, which is
 * the same number `decideExitClaimBatch` reports as `blocksUntilAllReady`.
 *
 * THE TARGET IS PROVISIONAL WHILE ANYTHING IS STILL BROADCASTING
 *
 * A capsule that has not confirmed its leaf has no `claimableHeight` yet, and
 * its eventual height can land AFTER the current maximum. In that run
 * `ec46d966` confirmed last and pushed the batch height from 963599 out to
 * 963652. So the target has to be re-evaluated as leaves confirm, not computed
 * once. Every height in the table is leaf-confirm plus exactly 144, which is
 * three independent confirmations of `vtxoExitDelta = 144`, so once the last
 * leaf confirms the answer is known a full 24 hours ahead.
 *
 * BLOCKS ARE THE TRUTH, THE DATE IS AN ESTIMATE
 *
 * The OS schedules alarms against a clock, and the trigger is a block height,
 * so the height has to be converted. Block intervals are exponentially
 * distributed, so the wait for N blocks has a standard deviation of sqrt(N)
 * intervals: at 144 blocks out that is about two hours either side.
 *
 * The two failure directions are not symmetric. Late costs a little delay on
 * funds that have no deadline and nobody racing them, since past its CSV a
 * claimable exit output is an ordinary UTXO only this wallet can spend. Early
 * spends the single interruption this feature is allowed, on nothing. So the
 * estimate is deliberately biased one standard deviation late. See
 * `blocksToFireIn`.
 *
 * It also self-corrects. Every tip poll re-derives the date from the live tip,
 * and re-arming replaces the alarm rather than adding one, so an estimate that
 * drifts while the app was closed is fixed the moment it opens again. An alarm
 * that does fire early prompts exactly the action that repairs it.
 *
 * Pure and import-free, matching exitClaimBatch.ts and exitDriveCadence.ts, so
 * the rule can be tested without standing up the sync loop or the OS layer.
 */

export type ExitReadyNoticeInput = {
    /** Capsules ready to sweep right now. */
    claimableCount: number;
    /**
     * `claimableHeight` of each capsule waiting out its CSV, from
     * `ExitState.AwaitingDelta.inner.claimableHeight`.
     */
    awaitingHeights: readonly number[];
    /** Capsules still broadcasting, so no ripening height yet. */
    processingCount: number;
    /** Freshest tip known. null when every provider failed. */
    tipHeight: number | null;
    /** Current epoch ms. */
    now: number;
    /** What is currently armed with the OS, null when nothing is. */
    armed: { targetHeight: number; fireAtMs: number } | null;
    /** ms per block used to turn a height into a date. */
    blockMs: number;
};

export type ExitReadyNoticeDecision = {
    /** Arm (or replace) the alarm, drop it, or leave it exactly as it is. */
    action: 'arm' | 'cancel' | 'keep';
    /** Height the batch is waiting for, null when none is known. */
    targetHeight: number | null;
    /** Epoch ms to fire at. Only set for 'arm'. */
    fireAtMs: number | null;
    /**
     * True while a straggler is still broadcasting, so `targetHeight` can
     * still move out. Recorded for the drive log: it is the difference
     * between an estimate that will be refined and one that is final.
     */
    provisional: boolean;
    /** Why, for the drive log. */
    reason:
        | 'no-exit'
        | 'claim-imminent'
        | 'no-schedule'
        | 'tip-unknown'
        | 'already-ripe'
        | 'first-arm'
        | 'target-moved'
        | 'estimate-moved'
        | 'unchanged';
};

/**
 * How far the date has to move before the alarm is replaced.
 *
 * The estimate is re-derived on every tip poll, which is as often as every two
 * minutes near the end. Re-arming on each of those would churn the OS alarm
 * for nothing: when blocks arrive on schedule the ABSOLUTE date barely moves,
 * because one fewer block remaining and ten more minutes elapsed cancel out.
 * Only a sustained drift, blocks genuinely running fast or slow, accumulates
 * past this and earns a replacement.
 */
export const NOTICE_RESCHEDULE_EPSILON_MS = 15 * 60_000;

/**
 * Blocks to price the alarm at, given how many actually remain.
 *
 * Block arrival is Poisson, so waiting for N blocks has a mean of N intervals
 * and a standard deviation of sqrt(N) of them. Adding one sigma puts the alarm
 * late roughly five times out of six instead of early half the time.
 *
 * The margin shrinks as the target approaches, which is what makes it cheap:
 * 12 extra blocks at 144 out, 2 at 4 out, and it is re-derived on every poll,
 * so a user with the app open near the end gets a nearly exact estimate.
 */
export function blocksToFireIn(blocksRemaining: number): number {
    if (!(blocksRemaining > 0)) return 0;
    return blocksRemaining + Math.sqrt(blocksRemaining);
}

export function decideExitReadyNotice(input: ExitReadyNoticeInput): ExitReadyNoticeDecision {
    const { claimableCount, processingCount, tipHeight, now, armed, blockMs } = input;

    const heights = (input.awaitingHeights ?? []).filter(
        (h) => typeof h === 'number' && Number.isFinite(h) && h > 0,
    );

    const nothing = (
        reason: ExitReadyNoticeDecision['reason'],
    ): ExitReadyNoticeDecision => ({
        action: 'cancel',
        targetHeight: null,
        fireAtMs: null,
        provisional: false,
        reason,
    });

    // No exit in flight at all, so any alarm left over from a finished one has
    // to go: it would otherwise announce funds that already landed.
    if (claimableCount <= 0 && heights.length === 0 && processingCount <= 0) {
        return nothing('no-exit');
    }

    // Everything that was going to ripen has. `decideExitClaimBatch` sweeps on
    // this very tick, with the app open by definition, so there is nothing
    // left to call the user back for.
    if (heights.length === 0 && processingCount <= 0) {
        return nothing('claim-imminent');
    }

    // Stragglers exist but none has confirmed its leaf, so no ripening height
    // is known. Promise nothing rather than guess a date; the next drive that
    // sees a confirmed leaf arms it.
    if (heights.length === 0) {
        return nothing('no-schedule');
    }

    const targetHeight = Math.max(...heights);
    const provisional = processingCount > 0;

    const keep = (
        reason: ExitReadyNoticeDecision['reason'],
    ): ExitReadyNoticeDecision => ({
        action: 'keep',
        targetHeight,
        fireAtMs: armed?.fireAtMs ?? null,
        provisional,
        reason,
    });

    // The tip is unreadable, so there is no honest way to date the alarm.
    // Leave whatever is armed alone: the last good estimate beats no alarm,
    // and beats one derived from a number we do not have.
    if (tipHeight == null || !Number.isFinite(tipHeight)) return keep('tip-unknown');

    const blocksRemaining = targetHeight - Math.floor(tipHeight);

    // The tip has passed the target but bark has not caught up yet, which
    // means the app is open and driving. Anything armed is due about now
    // anyway, and re-arming it here would only push it back out.
    if (blocksRemaining <= 0) return keep('already-ripe');

    const fireAtMs = now + Math.round(blocksToFireIn(blocksRemaining) * blockMs);

    const arm = (
        reason: ExitReadyNoticeDecision['reason'],
    ): ExitReadyNoticeDecision => ({
        action: 'arm',
        targetHeight,
        fireAtMs,
        provisional,
        reason,
    });

    if (armed == null) return arm('first-arm');
    // A late leaf confirming pushes the batch out, which is the case the
    // provisional target exists for. Always re-arm on it.
    if (armed.targetHeight !== targetHeight) return arm('target-moved');
    if (Math.abs(fireAtMs - armed.fireAtMs) >= NOTICE_RESCHEDULE_EPSILON_MS) {
        return arm('estimate-moved');
    }
    return keep('unchanged');
}
