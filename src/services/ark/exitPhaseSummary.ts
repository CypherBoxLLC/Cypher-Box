/**
 * Which phase a unilateral exit is in, and what to tell the user about it.
 *
 * THE PROBLEM
 *
 * The panel showed one sentence for the entire run: "N sats pending exit.
 * Broadcasting, then a ~24h timelock. Reopen the app after that to collect."
 * The amount was honest and decremented as claims landed, but the sentence
 * never changed, so a STALLED exit and a WORKING one looked identical for two
 * days. On a path the user takes when they believe the server is hostile, the
 * only question they have is "is this progressing", and the screen could not
 * answer it.
 *
 * COSTS NOTHING NEW
 *
 * Every input here is already fetched. The panel polls `fetchArkExitVtxos()`
 * every 10s and threw away everything except the sats total, and the chain tip
 * has been live in the store since the exit drive started polling it itself
 * (#204/#219). So this is presentation over data already in hand: no extra
 * esplora requests, which matters because request budget is the exit's
 * scarcest resource.
 *
 * THE THREE PHASES, AND WHY THEY READ DIFFERENTLY
 *
 *   publishing  Some capsule is still Processing. The app is needed to
 *               broadcast the next tree level, and a level cannot be built
 *               until its parent output exists. This is the phase that needs
 *               the user REPEATEDLY, so its copy asks them to stay.
 *   waiting     Every capsule is out of the app's hands and sitting out the
 *               CSV. The chain does this work whether the app is open or not,
 *               so its copy releases the user.
 *   ready       Something is claimable. The sweep fires from the open app.
 *
 * BLOCKS ARE THE TRUTH, TIME IS THE ESTIMATE
 *
 * `claimableHeight` is exact and fixed from the moment a leaf confirms. The
 * conversion to a duration is not: block intervals are exponentially
 * distributed, so a seconds-level countdown stalls visibly and then jumps,
 * including backwards, which reads as a broken timer rather than an honest
 * estimate. So the block count leads, the duration follows as an approximation,
 * and there are no seconds anywhere. See ARK_UNILATERAL_EXIT_TRIAGE_SPEC 7.2.
 *
 * NEVER IMPLIES IT FINISHES BY ITSELF
 *
 * The drive is foreground-only. Every phase's copy has to survive the user
 * closing the app, so none of it promises completion. The countdown ends at
 * "ready to collect", never at "done".
 *
 * Pure and import-free, matching exitClaimBatch.ts, exitDriveCadence.ts and
 * exitReadyNotice.ts, so the wording and the thresholds are testable without
 * standing up the SDK or the sync loop.
 */

import loc from '../../../loc';

export type ExitPhase = 'publishing' | 'waiting' | 'ready' | 'settling';

export type ExitPhaseInput = {
    /** Capsules ready to sweep right now (`isClaimable`). */
    claimableCount: number;
    /**
     * `claimableHeight` for each capsule sitting out its CSV, from
     * `ExitState.AwaitingDelta.inner.claimableHeight`.
     */
    awaitingHeights: readonly number[];
    /** Capsules still broadcasting, so no ripening height exists yet. */
    processingCount: number;
    /**
     * Exit-tree transactions on still-broadcasting capsules whose CPFP child
     * has NOT been published yet (`AwaitingCpfpBroadcast`).
     */
    txAwaitingBroadcast?: number;
    /**
     * Exit-tree transactions already published and waiting on a block
     * (`AwaitingConfirmation` / `AwaitingInputConfirmation`).
     */
    txAwaitingConfirmation?: number;
    /** Freshest tip known, or null when no chain source answered. */
    tipHeight: number | null;
    /** Minutes per block used to turn a height into a duration. */
    blockMinutes: number;
};

export type ExitPhaseSummary = {
    phase: ExitPhase;
    /** One line naming what is happening now. */
    headline: string;
    /** Secondary line, or null when there is nothing honest to add. */
    detail: string | null;
    /** Blocks until everything is collectable. null when not yet knowable. */
    blocksRemaining: number | null;
    /** The height everything is collectable at. null when not yet knowable. */
    targetHeight: number | null;
};

/**
 * Blocks as a rough duration.
 *
 * Deliberately coarse and deliberately vague in its wording. Minutes below two
 * hours, whole hours above, and never a unit finer than a minute. "about" is
 * load-bearing: it is the difference between an estimate the user forgives for
 * drifting and a timer they treat as broken.
 */
export function approxDuration(blocks: number, blockMinutes: number): string {
    const mins = Math.max(0, Math.round(blocks * blockMinutes));
    if (mins < 1) return loc.cypherbox.services.exit_phase.under_a_minute;
    if (mins < 120) return String(loc.formatString(loc.cypherbox.services.exit_phase.about_min, { mins }));
    const hours = Math.round(mins / 60);
    if (hours < 48) return String(loc.formatString(loc.cypherbox.services.exit_phase.about_hours, { hours }));
    return String(loc.formatString(loc.cypherbox.services.exit_phase.about_days, { days: Math.round(hours / 24) }));
}

function plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
}

export function summariseExitPhase(input: ExitPhaseInput): ExitPhaseSummary {
    const claimable = Math.max(0, Math.floor(input.claimableCount || 0));
    const processing = Math.max(0, Math.floor(input.processingCount || 0));
    const heights = (input.awaitingHeights ?? [])
        .map((h) => Math.floor(Number(h) || 0))
        .filter((h) => h > 0);
    const tip = input.tipHeight != null && Number.isFinite(input.tipHeight)
        ? Math.floor(input.tipHeight)
        : null;

    // Everything is collectable once the LAST one ripens, which is also what
    // the claim batches on: one sweep, one transaction overhead, rather than
    // one per capsule. So the figure the user is shown is the same figure the
    // app is actually waiting for.
    const targetHeight = heights.length > 0 ? Math.max(...heights) : null;
    const blocksRemaining =
        targetHeight != null && tip != null ? Math.max(0, targetHeight - tip) : null;

    // Ready outranks everything: something can be collected NOW, and that is
    // true whatever else is still in flight behind it.
    if (claimable > 0) {
        const alsoWaiting = heights.length + processing;
        return {
            phase: 'ready',
            headline: String(loc.formatString(plural(claimable, loc.cypherbox.services.exit_phase.ready_headline_one, loc.cypherbox.services.exit_phase.ready_headline_other), { count: claimable })),
            detail: alsoWaiting > 0
                // Says why nothing may appear to happen yet. The batch holds
                // for the stragglers so the whole exit lands as one payment.
                ? String(loc.formatString(loc.cypherbox.services.exit_phase.ready_detail_together, { count: alsoWaiting }))
                : loc.cypherbox.services.exit_phase.ready_detail,
            blocksRemaining,
            targetHeight,
        };
    }

    // Publishing outranks waiting: if ANY capsule still needs a broadcast, the
    // app is load-bearing and the copy must not tell the user to leave.
    if (processing > 0) {
        // SUB-PROGRESS, and why it earns its place.
        //
        // Phase alone is not enough here. Broadcasting is the slowest phase and
        // the one that needs the user present, and every tree level has to
        // CONFIRM before the next can be relayed (Bitcoin Core's TRUC policy:
        // one unconfirmed parent, one child, and the CPFP anchor takes that
        // slot). So the phase legitimately sits unchanged for an hour while
        // real work happens underneath.
        //
        // Observed live 2026-08-28: three capsules went from
        // AwaitingCpfpBroadcast, to a confirmed shared parent, to one published
        // and awaiting a block, and the panel printed the same sentence
        // throughout. From the user's side that is indistinguishable from a
        // wedged exit, which is the exact confusion this panel exists to remove.
        //
        // So count transactions, not just capsules. Published means the CPFP
        // child is out: waiting on a block, or already confirmed.
        const pending = Math.max(0, Math.floor(input.txAwaitingBroadcast ?? 0));
        const inFlight = Math.max(0, Math.floor(input.txAwaitingConfirmation ?? 0));
        const totalTx = pending + inFlight;
        // "N of M" where M is only the steps visible right now. A tree reveals
        // more levels as they confirm, so this is deliberately not a total and
        // not a percentage.
        const progress = totalTx > 0
            ? `${String(loc.formatString(loc.cypherbox.services.exit_phase.publishing_progress, { inFlight, total: totalTx }))} `
            : '';
        const alsoWaiting = heights.length > 0
            ? `${String(loc.formatString(plural(heights.length, loc.cypherbox.services.exit_phase.publishing_also_waiting_one, loc.cypherbox.services.exit_phase.publishing_also_waiting_other), { count: heights.length }))} `
            : '';
        return {
            phase: 'publishing',
            headline: String(loc.formatString(plural(processing, loc.cypherbox.services.exit_phase.publishing_headline_one, loc.cypherbox.services.exit_phase.publishing_headline_other), { count: processing })),
            detail: `${progress}${alsoWaiting}${loc.cypherbox.services.exit_phase.publishing_detail_tail}`,
            // A capsule with no ripening height yet can push the finish line
            // out once its leaf confirms, so any figure here would be a floor
            // presented as an answer. Withheld rather than guessed.
            blocksRemaining: null,
            targetHeight: null,
        };
    }

    if (heights.length > 0) {
        const n = heights.length;
        const published = String(loc.formatString(plural(n, loc.cypherbox.services.exit_phase.waiting_published_one, loc.cypherbox.services.exit_phase.waiting_published_other), { count: n }));
        if (blocksRemaining == null) {
            return {
                phase: 'waiting',
                headline: published,
                // No tip means no chain source answered. Saying nothing about
                // timing is better than inventing one, and the remedy belongs
                // here because the user can act on it.
                detail: loc.cypherbox.services.exit_phase.waiting_no_chain,
                blocksRemaining: null,
                targetHeight,
            };
        }
        if (blocksRemaining === 0) {
            return {
                phase: 'waiting',
                headline: published,
                detail: loc.cypherbox.services.exit_phase.waiting_timelock_passed,
                blocksRemaining: 0,
                targetHeight,
            };
        }
        return {
            phase: 'waiting',
            headline: published,
            // Blocks first because they are certain, duration second because
            // it is not. Closes on what the app will do rather than implying
            // the funds arrive on their own.
            detail:
                `${String(loc.formatString(plural(blocksRemaining, loc.cypherbox.services.exit_phase.waiting_blocks_to_go_one, loc.cypherbox.services.exit_phase.waiting_blocks_to_go_other), { count: blocksRemaining, duration: approxDuration(blocksRemaining, input.blockMinutes) }))} ` +
                loc.cypherbox.services.exit_phase.waiting_close_app,
            blocksRemaining,
            targetHeight,
        };
    }

    // Nothing claimable, nothing waiting, nothing processing. Either the drive
    // has not read state yet this session, or the last capsules were just
    // swept and the flag has not cleared. Both are momentary, so this says
    // "checking" rather than asserting either one.
    return {
        phase: 'settling',
        headline: loc.cypherbox.services.exit_phase.settling_headline,
        detail: null,
        blocksRemaining: null,
        targetHeight: null,
    };
}
