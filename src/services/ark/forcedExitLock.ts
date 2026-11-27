/**
 * Keep a forced exit's capsules, and only those, out of every cooperative
 * spend.
 *
 * WHY NOT THE WALLET-WIDE LOCK
 *
 * `assertNoActiveArkExit` refuses every send, swap, refresh and offboard while
 * an exit is live, because bark keeps an exiting capsule Spendable and a
 * cooperative spend would race the exit on the same coin. For an exit the user
 * started that is the right trade. For an exit the user never asked for (bark
 * 0.9.0 routes a capsule another party force-exited on-chain into the exit
 * flow by itself, see ./forcedExit.ts) it froze the whole wallet for the ~24h
 * timelock plus the claim, indefinitely with an empty fee wallet, while every
 * other capsule crept toward expiry. One forced capsule must not do that.
 *
 * HOW THE SCOPED LOCK WORKS
 *
 * bark 0.9.0's `lockVtxos` marks a capsule `Locked`, and bark's own coin
 * selection (sends, Lightning, offboard by amount, maintenance refresh) picks
 * only `Spendable` capsules, so a locked one is left alone by every flow where
 * bark chooses the inputs. The exit subsystem works from its own records and
 * does not read the capsule's state, so the forced exit keeps progressing and
 * is drained as before; when it finishes bark marks the capsule Exited, which
 * replaces the lock. Verified against the bark-0.9.0 source (`lock_vtxos`
 * writes `VtxoState::Locked`, `spendable_vtxos` is Spendable-only,
 * `start_exit_for_vtxos` "doesn't touch the VTXO's own state",
 * `mark_vtxos_as_exited` accepts Locked).
 *
 * Calls where the APP names the inputs (`refreshVtxos(ids)`, `offboardVtxos(ids)`)
 * are not filtered by bark, so those paths refuse a forced id, and the
 * amount-based paths check the fee estimate's coin selection as a belt on top
 * of the lock: see ./forcedExitGuard.ts, the store-only half.
 *
 * The lock is persisted in bark's database, and re-locking is a no-op, so this
 * module only remembers what it has already asked for in this process.
 */

import { barkStateTag } from './barkState';
import { getArkWalletHandle } from './walletHandle';

const lower = (id: unknown) => String(id ?? '').toLowerCase();

/** Ids this process has confirmed locked (or found already beyond locking). */
const lockedIds = new Set<string>();

export function isForcedExitVtxoLocked(id: string): boolean {
    return lockedIds.has(lower(id));
}

/**
 * Ask bark to lock each forced capsule. Never throws. A capsule bark reports
 * as already Locked, Exited or Spent counts as done (nothing bark picks can
 * reach it); one that could neither be locked nor read is reported in
 * `failed`, and callers that let bark pick inputs must not run while any id is
 * in that list.
 */
export async function lockForcedExitVtxos(
    vtxoIds: readonly string[],
): Promise<{ locked: string[]; failed: string[] }> {
    const locked: string[] = [];
    const failed: string[] = [];
    const handle = getArkWalletHandle();
    for (const raw of vtxoIds) {
        const id = String(raw);
        if (lockedIds.has(lower(id))) {
            locked.push(id);
            continue;
        }
        if (!handle) {
            failed.push(id);
            continue;
        }
        try {
            // No holder: bark's subsystems lock as Action or Movement, and the
            // matching unlock is theirs. This lock is the app's and is only ever
            // replaced by bark marking the capsule Exited.
            await handle.lockVtxos([id], undefined);
            lockedIds.add(lower(id));
            locked.push(id);
            console.log('[Ark forced-exit] locked capsule out of coin selection:', id.slice(0, 12));
            continue;
        } catch (err: any) {
            // Only a Spendable capsule can be locked. A refusal is expected
            // when a previous process already locked it, or the exit finished.
            try {
                const v = await handle.getVtxoById(id);
                const tag = barkStateTag(v?.state).toLowerCase();
                if (tag === 'locked' || tag === 'exited' || tag === 'spent') {
                    lockedIds.add(lower(id));
                    locked.push(id);
                    continue;
                }
            } catch { /* fall through to failed */ }
            console.warn('[Ark forced-exit] could not lock capsule:', id.slice(0, 12), err?.message ?? err);
            failed.push(id);
        }
    }
    return { locked, failed };
}

export function resetForcedExitLocksForTests(): void {
    lockedIds.clear();
}
