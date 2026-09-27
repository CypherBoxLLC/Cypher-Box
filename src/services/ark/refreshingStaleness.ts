/**
 * How long the client keeps believing that a VTXO is mid-refresh.
 *
 * bark 0.6.0 leaves a submitted VTXO `Spendable` rather than `Locked`, so the
 * client tracks the ids it submitted (authStore `arkRefreshingVtxoIds`) to
 * drive the per-capsule "Refreshing" animation. The only thing that clears an
 * id is a prune inside the sync tick, behind a wallet-handle check and a chain
 * of unbounded UniFFI awaits. When that tick cannot complete, the animation
 * runs until the process is killed, which is what a user sees as a capsule
 * refreshing for an hour that turns out to have finished long before.
 *
 * This module is the net for that case, and nothing more. It is deliberately
 * pure so it can run when the wallet handle is gone and the ASP is
 * unreachable, which is precisely when it is needed.
 */

/**
 * A delegated round finalises in roughly one round interval, and our own copy
 * tells users a refresh takes about an hour. A net anywhere near those numbers
 * would cut the animation while the round is genuinely running and tell the
 * user it stopped when it did not, which is worse than the bug it fixes.
 *
 * Six hours sits far past any legitimate round. The ceiling keeps an unusual
 * server-side round interval from pushing the net out to something that never
 * fires in practice.
 */
export const REFRESHING_MAX_AGE_FLOOR_MS = 6 * 60 * 60 * 1000;
export const REFRESHING_MAX_AGE_CEILING_MS = 24 * 60 * 60 * 1000;

/** Multiple of the server's round interval used when it is known. */
export const REFRESHING_MAX_AGE_ROUND_MULTIPLE = 24;

export type RefreshingSweepInput = {
    /** Ids currently marked as refreshing. */
    tracked: readonly string[];
    /** When each id was first marked, epoch ms. Missing means "older build". */
    since: Readonly<Record<string, number>>;
    /** `wallet.arkInfo().roundIntervalSecs`, when the client has fetched it. */
    roundIntervalSecs?: number | null;
    now: number;
};

export type RefreshingSweepResult = {
    /** Ids that are still plausibly mid-round. */
    kept: string[];
    /** How many ids the sweep dropped. Non-zero means sync is failing. */
    dropped: number;
    /** The bound actually applied, for logging. */
    maxAgeMs: number;
};

export function computeRefreshingSweep(
    input: RefreshingSweepInput,
): RefreshingSweepResult {
    const roundSecs = Number(input.roundIntervalSecs ?? 0);
    const maxAgeMs = Math.min(
        REFRESHING_MAX_AGE_CEILING_MS,
        Math.max(
            REFRESHING_MAX_AGE_FLOOR_MS,
            roundSecs * 1000 * REFRESHING_MAX_AGE_ROUND_MULTIPLE,
        ),
    );

    // A missing stamp means the id was written by a build that did not record
    // one. Treat it as ancient rather than stamping it now: a user upgrading
    // while already stuck should be cleared on the first sweep, not have their
    // clock restarted by the upgrade.
    const kept = input.tracked.filter(
        (id) => input.now - (input.since[id] ?? 0) < maxAgeMs,
    );

    return { kept, dropped: input.tracked.length - kept.length, maxAgeMs };
}
