/**
 * Expired capsules: which ones can still be recovered, and one recovery at a
 * time.
 *
 * WHAT EXPIRY TAKES AWAY
 *
 * A capsule (VTXO) past its expiry height has lost its unilateral exit. The
 * round's timelock has run out, so the server may sweep the round's on-chain
 * output into its own wallet, and the exit transactions the wallet holds stop
 * working once it does. Ark send and Emergency Exit are gone for that capsule.
 *
 * WHAT IS LEFT, AND WHY IT IS NOT OURS TO PROMISE
 *
 * Second.tech still honours expired capsules today. Its docs
 * (second.tech/docs/learn/lifetime) list refresh, Lightning send and offboard
 * as working after expiry, with no time window. Erik (Second) to the owner,
 * 2026-09-21: "We don't have an expiry limit. You can currently offboard
 * expired VTXOs permanently. However, there is no guarantee we maintain this
 * policy in the future." Live case: a 79,571-sat VTXO that expired on
 * 2026-07-14 was offboarded in full 69 days later.
 *
 * So recovery is a policy, not a protocol right. After the sweep the sats sit
 * in Second's wallet and come back only because Second chooses to pay them
 * out, which makes an expired capsule custodial until it is recovered. Three
 * consequences for the app:
 *
 *   1. Expired capsules never count toward the spendable balance
 *      (applyExpiredVtxoFilter in balance.ts).
 *   2. Each one gets a recovery action, and the copy says it depends on
 *      Second.tech, is not guaranteed, and should be used right away.
 *   3. The expiry date stays the deadline in every reminder and explainer.
 *
 * No SDK import here, so the rules below stay unit-testable. The screens pass
 * in the limits from config.ts.
 */

/**
 * Whether a capsule's expiry height has passed.
 *
 * `expiryHeight` 0 means the SDK reported none (some arkoor capsules), which is
 * "unknown", not "expired". An unknown tip is also never read as expired: the
 * cost of guessing wrong is offering a recovery for a live capsule, or hiding
 * the refresh button on one.
 */
export function isPastExpiryHeight(expiryHeight: number, tipHeight: number | null | undefined): boolean {
    if (!(expiryHeight > 0)) return false;
    if (typeof tipHeight !== 'number' || !(tipHeight > 0)) return false;
    return expiryHeight <= tipHeight;
}

export type ExpiredCapsuleRecoverability =
    /** Big enough to refresh on its own. */
    | 'recoverable'
    /**
     * Below the refresh floor. A refresh would hand back dust (or be refused),
     * and moving it on-chain costs more than it holds, so no action is offered.
     */
    | 'too-small';

/**
 * Whether an expired capsule gets a recovery action.
 *
 * Keyed off the refresh floor (ARK_REFRESH_MIN_SATS), the same line the rows
 * already draw between dust and a normal capsule, so an expired row never
 * offers what the same capsule would refuse while it was live. The floor is a
 * parameter to keep this module free of the SDK.
 */
export function expiredCapsuleRecoverability(sats: number, refreshMinSats: number): ExpiredCapsuleRecoverability {
    return sats >= refreshMinSats ? 'recoverable' : 'too-small';
}

// --- One recovery at a time -------------------------------------------------

/**
 * Single-flight latch for expired-capsule recovery.
 *
 * On 2026-09-20 one tap on an expired capsule fired nine offboards in a row.
 * The funds landed in the user's own on-chain wallet, so nothing was lost, but
 * nine broadcasts for one tap is exactly the failure a money path must not
 * have. React state cannot stop it: two taps inside one render both read the
 * old value. This flag is set synchronously, before the first await, and it is
 * module-level so it also outlives the Capsules tab unmounting mid-recovery
 * (the same reason cancellingState.ts is module-level).
 *
 * It covers the whole flow, including the confirmation dialog, so a second tap
 * cannot stack a second dialog behind the first.
 */
let recoveryInFlight = false;

/**
 * Take the latch. Returns false when a recovery is already running, in which
 * case the caller must do nothing (not even open a dialog).
 */
export function beginExpiredRecovery(): boolean {
    if (recoveryInFlight) return false;
    recoveryInFlight = true;
    return true;
}

/** Release the latch. Call from a `finally` so a throw cannot leave it held. */
export function endExpiredRecovery(): void {
    recoveryInFlight = false;
}

export function isExpiredRecoveryInFlight(): boolean {
    return recoveryInFlight;
}
