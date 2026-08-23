/**
 * Pure helper: which reserve figure the exit-fee gate measures against.
 *
 * Deliberately free of imports so it stays unit-testable without the native
 * bark module, matching exitFundingPlan.ts and refreshBatch.ts.
 */

/**
 * Which reserve figure the exit-fee gate, the shortfall and all the funding
 * copy should measure against.
 *
 * `arkExitFeeReserveSats` is the amount the user armed, and it is a snapshot of
 * a decision made at one moment. `computeExitFeeReserveSats` is what an exit is
 * estimated to cost RIGHT NOW, and it moves with the wallet: capsule count, and
 * far more sharply, exit depth, which is linear in the reserve and was measured
 * varying 25x inside a single wallet.
 *
 * The screen used to let an armed value REPLACE the recommendation outright:
 *
 *     armed > 0 ? armed : recommended
 *
 * so an armed figure silently went stale as the wallet grew. Observed on device
 * 2026-08-20: armed 3,654, on-chain 6,259, recommendation 233,120. The gate
 * reported the reserve fully funded and the shortfall as 0, on the same screen
 * that recommended 233,120, leaving the user 227k short of the app's own
 * estimate while being told they were ready. `reserveBelowRecommended` already
 * detected exactly this and only produced a warning the gate ignored.
 *
 * Taking the greater of the two keeps user agency in the safe direction (arming
 * MORE than recommended is a deliberate fee-spike buffer and is honoured) and
 * removes it in the dangerous one (an armed value can no longer claim the exit
 * is funded when the estimate says otherwise).
 *
 * Returns 0 when neither is known, which is the pre-compute state: callers gate
 * on `> 0` so a 0 target means "do not gate yet", not "nothing needed".
 */
export function resolveExitReserveTarget(input: {
    armedSats: number | null | undefined;
    recommendedSats: number | null | undefined;
}): number {
    const armed = Math.max(0, Math.floor(input.armedSats ?? 0));
    const recommended = Math.max(0, Math.floor(input.recommendedSats ?? 0));
    return Math.max(armed, recommended);
}
