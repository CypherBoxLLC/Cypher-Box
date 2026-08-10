/**
 * Helpers for bark 0.16.x (bark 0.6.1) tagged-enum state fields.
 *
 * bark 0.6.1 changed `Vtxo.state` and `ExitVtxo.state` from plain strings to
 * UniFFI tagged-enum objects: `{ tag: "Spendable", ... }` /
 * `{ tag: "Processing", ... }`. Code that read them as strings
 * (`String(v.state)`, `v.state.toLowerCase()`) now gets "[object Object]" and
 * silently breaks state comparisons. These helpers normalise back to the
 * variant-name string and keep the exit-liveness semantics in one place.
 */

/**
 * Variant-name string of a bark tagged-enum state (e.g. "Spendable",
 * "Processing"). Defensive: passes a plain string through unchanged, so it also
 * copes with an older SDK shape or already-normalised values.
 */
export function barkStateTag(state: unknown): string {
    if (typeof state === 'string') return state;
    if (state && typeof state === 'object' && 'tag' in state) {
        return String((state as { tag: unknown }).tag);
    }
    return String(state);
}

/**
 * Terminal exit states (bark 0.6.1 `ExitState`): the exit has finished and the
 * vtxo no longer needs driving.
 *   Claimed          - swept on-chain, done.
 *   VtxoAlreadySpent - the vtxo was already spent, so the exit is moot.
 *   Canceled         - exit aborted.
 * Everything else (Start, Processing, AwaitingDelta, Claimable,
 * ClaimInProgress) is an IN-PROGRESS exit. We test "not terminal" rather than an
 * allow-list of active states on purpose: a new or renamed in-progress state
 * must never be mis-read as complete, which is the failure mode that retired an
 * exit early and deleted a wallet mid-exit (2026-07-31).
 */
const EXIT_TERMINAL_TAGS = new Set(['Claimed', 'VtxoAlreadySpent', 'Canceled']);

/**
 * True while an exit vtxo is still in flight: it locks the vtxo out of the
 * spendable set and keeps the exit drive running. A claimable exit is always
 * active, even if a future SDK state slips past the terminal set.
 */
export function isActiveExit(exit: { state: unknown; isClaimable?: boolean }): boolean {
    if (exit?.isClaimable === true) return true;
    return !EXIT_TERMINAL_TAGS.has(barkStateTag(exit?.state));
}
