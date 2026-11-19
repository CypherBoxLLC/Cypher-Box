/**
 * When a pending refresh round counts as stuck.
 *
 * One definition for the two places that decide it: the sync loop, which
 * raises `arkRefreshStuck` and the rescue banners, and RefreshWaitBanner,
 * which switches from its countdown to "This refresh is stuck" with a Cancel.
 * They used to disagree. The banner called a round stuck after one hour while
 * the sync loop waited for twice the round interval, so for the second hour a
 * slow but healthy round was offered for cancelling on one screen and shown as
 * in progress on the next.
 *
 * Twice the interval allows for normal jitter, a missed round, or a single
 * network blip; past it a round is not coming back without a cancel.
 */

/** Ark is mainnet-only, where the server runs a round every hour. */
export const ARK_DEFAULT_ROUND_INTERVAL_SECS = 3600;

/** Multiple of the round interval after which a pending round is stuck. */
export const ARK_STUCK_ROUND_INTERVALS = 2;

/**
 * Milliseconds a round may stay pending before it counts as stuck.
 * `roundIntervalSecs` is `wallet.arkInfo().roundIntervalSecs` (the store's
 * `arkRoundIntervalSecs`); until it has been fetched, the mainnet hour.
 */
export function arkStuckRoundThresholdMs(roundIntervalSecs: number | null | undefined): number {
    const secs = Number(roundIntervalSecs);
    const interval = Number.isFinite(secs) && secs > 0 ? secs : ARK_DEFAULT_ROUND_INTERVAL_SECS;
    return ARK_STUCK_ROUND_INTERVALS * interval * 1000;
}
