/**
 * The per-capsule refusal for a forced exit's capsules.
 *
 * Companion to ./forcedExitLock.ts, which keeps bark's own coin selection off
 * those capsules with a lock. This module is the app-side half: calls where the
 * app names the inputs (`refreshVtxos(ids)`, `offboardVtxos(ids)`) are not
 * filtered by bark, and amount-based calls get a check on the fee estimate's
 * coin selection on top of the lock. Reads the store only (no wallet handle),
 * so the send, offboard and convert services can import it without pulling
 * the native module into their tests.
 */

import useAuthStore from '@Cypher/stores/authStore';

import loc from '../../../loc';

const lower = (id: unknown) => String(id ?? '').toLowerCase();

/** Capsules the store currently marks as exiting WITHOUT the user starting it. */
export function forcedExitIdsFromStore(): Set<string> {
    const out = new Set<string>();
    for (const v of useAuthStore.getState().arkVtxos ?? []) {
        const r = v as { id: string; exiting?: boolean; exitForced?: boolean };
        if (r.exiting && r.exitForced) out.add(lower(r.id));
    }
    return out;
}

/**
 * Refuse a cooperative call that names a forced-exit capsule among its inputs.
 * For the paths where bark does not filter by state (`refreshVtxos(ids)`,
 * `offboardVtxos(ids)`) this is the only guard; for amount-based paths it is a
 * check on the fee estimate's coin selection, on top of the lock.
 *
 * Throws with the same user-facing copy as the wallet-wide guard.
 */
export function assertNotForcedExitVtxos(
    vtxoIds: readonly string[] | null | undefined,
    action: string = loc.cypherbox.services.ark_exit.this_action,
): void {
    if (!vtxoIds || vtxoIds.length === 0) return;
    const forced = forcedExitIdsFromStore();
    if (forced.size === 0) return;
    const hit = vtxoIds.filter((id) => forced.has(lower(id)));
    if (hit.length === 0) return;
    console.warn('[Ark forced-exit] refused a cooperative spend of a forced-exit capsule:', hit.map((id) => id.slice(0, 12)).join(','));
    throw new Error(
        String(loc.formatString(loc.cypherbox.services.ark_exit.unavailable_during_exit, { action })),
    );
}
