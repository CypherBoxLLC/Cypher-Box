/**
 * Should the change from an arkoor send be folded back into a round?
 *
 * WHY THIS EXISTS
 *
 * `exitDepth` is the length of a VTXO capsule's genesis chain, and it is
 * exactly the number of transactions a unilateral exit has to broadcast and
 * confirm for that capsule. Per Second.tech (confirmed 2026-08-22), TRUC relay
 * policy allows one unconfirmed parent and one child, and the CPFP anchor takes
 * the child slot, so those transactions confirm one after another. Depth is
 * therefore both the fee and the wall clock of an exit.
 *
 * Every arkoor spend appends a level to the change. A round resets it. Nothing
 * currently folds change back: `send.ts` ends with a local state re-read, and
 * `useArkoorReceivePrompt` is scoped to capsules that ARRIVE, not to change from
 * the user's own spend. So depth accumulates for anyone who spends, until
 * `foregroundSweep` reaches the capsule in the last week before expiry.
 *
 * WHY AT SEND TIME
 *
 * The app is definitionally open. The user initiated the send, they are holding
 * the phone, the wallet is unlocked. Every other refresh trigger has to solve
 * "how do we reach a user who is not looking"; this one does not, which is why
 * it needs none of the notification machinery.
 *
 * WHY A DEPTH TRIGGER RATHER THAN REFRESHING EVERY SEND
 *
 * `baseFeeSats` is charged per ROUND, so refreshing after every send is a fee on
 * every send. A threshold charges only the user whose own spending created the
 * depth, and leaves everyone else alone.
 *
 * Measured 2026-08-22 on one wallet, split by state: the live (Spendable)
 * capsules sat at depths [2, 2, 3, 3, 3, 3, 15, 17], median 3. The alarming
 * numbers quoted elsewhere (median 9, max 49) came from 178 already-SPENT
 * capsules, which are transaction history rather than a wallet. So the resting
 * state of a normally-used wallet is 2 to 3, and a threshold of 5 rarely fires:
 * it takes several consecutive sends with no round in between.
 *
 * At roughly 316 vB per tree transaction (measured on the same exit: 11 CPFP
 * children, 3,585 sats total, 1 sat/vB), a threshold of 5 caps a single
 * capsule's exit-tree cost near 1,580 vB.
 *
 * WHAT IT REFUSES TO DO, AND WHY
 *
 * The guards below mirror `foregroundSweep`'s selection, minus its one-week
 * ceiling. That ceiling exists because when the trigger is EXPIRY there is no
 * reason to spend a fee early. When the trigger is DEPTH there is, so it does
 * not apply here. Every other guard does, and for the same reasons:
 *
 *   - below `ARK_REFRESH_MIN_SATS`, one sub-floor input makes the ASP reject the
 *     whole round, so a dust change capsule cannot be refreshed alone
 *   - below the exit-runway floor, a delegated round that hangs would eat the
 *     user's exit window; that zone belongs to spend-or-exit, not to refresh
 *   - during a unilateral exit, a cooperative round would spend a coin already
 *     committed on-chain
 *
 * Pure and import-free, matching exitClaimBatch.ts and refreshBatch.ts, so the
 * rule can be tested without standing up a wallet.
 */

/**
 * Depth above which change is folded back into a round.
 *
 * 5, not 3: the resting state is 2 to 3, so 3 would fire on the first send and
 * turn this into a per-send fee. 5 leaves headroom for normal spending and only
 * fires on a run of sends with no round between them.
 */
export const ARK_CHANGE_REFRESH_MAX_DEPTH = 5;

export type ChangeRefreshInput = {
    /** `exitDepth` of the change capsule. */
    exitDepth: number;
    /** Value of the change capsule, in sats. */
    sats: number;
    /** Blocks until it expires; null when the height is unknown or unreadable. */
    blocksUntilExpiry: number | null;
    /** bark state tag, flattened to its variant string. */
    stateTag: string;
    /** Already submitted to a round by another caller. */
    alreadyRefreshing: boolean;
    /** A unilateral exit is active on this wallet. */
    exitInProgress: boolean;
    /** Per-input round minimum (ARK_REFRESH_MIN_SATS). */
    minSats: number;
    /** Runway floor below which auto-refresh is unsafe (ARK_EXIT_RUNWAY_HOURS in blocks). */
    minRunwayBlocks: number;
    /** Depth threshold; defaults to ARK_CHANGE_REFRESH_MAX_DEPTH. */
    maxDepth?: number;
};

export type ChangeRefreshDecision = {
    refresh: boolean;
    reason:
        | 'refresh'
        | 'shallow-enough'
        | 'exit-in-progress'
        | 'not-spendable'
        | 'already-refreshing'
        | 'unknown-expiry'
        | 'too-near-expiry'
        | 'below-refresh-minimum';
};

export function decideChangeRefresh(input: ChangeRefreshInput): ChangeRefreshDecision {
    const maxDepth = input.maxDepth ?? ARK_CHANGE_REFRESH_MAX_DEPTH;

    // Hard exclusions first. Each of these makes a round either impossible or
    // actively harmful, so they outrank the depth question entirely.
    if (input.exitInProgress) return { refresh: false, reason: 'exit-in-progress' };
    if (input.stateTag.toLowerCase() !== 'spendable') {
        return { refresh: false, reason: 'not-spendable' };
    }
    if (input.alreadyRefreshing) return { refresh: false, reason: 'already-refreshing' };

    // An unreadable expiry cannot be checked against the runway floor, and the
    // floor is what stops a hung round eating an exit window. Assume the worst.
    if (input.blocksUntilExpiry == null || !Number.isFinite(input.blocksUntilExpiry)) {
        return { refresh: false, reason: 'unknown-expiry' };
    }
    if (input.blocksUntilExpiry < input.minRunwayBlocks) {
        return { refresh: false, reason: 'too-near-expiry' };
    }

    // Dust cannot ride along: one sub-floor input makes the ASP reject the whole
    // round. Reported before the depth check so a deep dust capsule is named as
    // dust, which is the actionable half. Deep AND unrefreshable is a real
    // combination: the two depth-15/17 capsules in the measured wallet were both
    // 400 sats, and they got deep precisely because they could never be
    // refreshed alone.
    if (input.sats < input.minSats) {
        return { refresh: false, reason: 'below-refresh-minimum' };
    }

    if (input.exitDepth <= maxDepth) return { refresh: false, reason: 'shallow-enough' };

    return { refresh: true, reason: 'refresh' };
}
