/**
 * Shared "don't auto-refresh this vtxo yet" gate.
 *
 * Every AUTOMATIC refresh path (background orchestrator, foreground urgency
 * sweep, notification-tap batch, stuck-round retry, dust consolidate) consults
 * this so the user's "Use immediately" choice is honored consistently in one
 * place. Manual, user-tapped refresh deliberately does NOT consult it. An
 * explicit tap on a specific capsule is the user changing their mind.
 */

/**
 * How long "Use immediately" holds auto-refresh off a vtxo. Well under any vtxo
 * expiry (days), so the grace lapses and the vtxo still auto-refreshes in time.
 */
export const SPEND_GRACE_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * Freshly-observed arkoors are deferred regardless of prompt state, to close
 * the race where a receive lands mid-orchestrator (the state snapshot was taken
 * before the receive movement was recorded).
 */
export const RECENT_OBSERVE_WINDOW_MS = 90_000; // 90s

type PromptEntry = {
    status?: 'pending' | 'dismissed' | 'refreshed';
    observedAt?: number;
    deferUntil?: number;
};

/**
 * Build the set of vtxo ids that automatic refresh must skip:
 *   - status 'pending'      → arkoor popup not answered yet, don't touch it
 *   - deferUntil in future  → inside the "spend immediately" grace window
 *   - observedAt within 90s → race protection for mid-orchestrator arrivals
 *
 * Note: a plain 'dismissed' whose deferUntil has elapsed (or was never set) is
 * NOT deferred. That is the point of the grace being time-boxed. Previously
 * 'dismissed' deferred permanently, which could let a "use immediately" vtxo
 * drift all the way to expiry unrefreshed.
 */
export function buildDeferredVtxoIds(
    promptState: Record<string, PromptEntry> | undefined | null,
    now: number = Date.now(),
): Set<string> {
    const ids = new Set<string>();
    if (!promptState) return ids;
    for (const [id, entry] of Object.entries(promptState)) {
        if (!entry) continue;
        if (entry.status === 'pending') {
            ids.add(id);
            continue;
        }
        if (typeof entry.deferUntil === 'number' && entry.deferUntil > now) {
            ids.add(id);
            continue;
        }
        if (typeof entry.observedAt === 'number' && now - entry.observedAt < RECENT_OBSERVE_WINDOW_MS) {
            ids.add(id);
        }
    }
    return ids;
}
