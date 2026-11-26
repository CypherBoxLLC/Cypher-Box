/**
 * Rules for the list of capsules the Ark server has called spent
 * (`arkServerSpentVtxoIds` in authStore).
 *
 * WHY THE RULES EXIST (reported by MrHodl, 0.1.14 item 1)
 *
 * bark decides spendability from its local database and never asks the server
 * whether a Spendable capsule is still unspent, so the app keeps its own list
 * of capsules the server refused as `spent`. That list used to be trusted all
 * the way: an id went in from any error text that named one, it never came
 * out, and the exit plan dropped the capsule silently, before triage, so it
 * vanished from the exit with nothing on-chain confirming the spend. A server
 * that lies, or a response about some other capsule, could make a live capsule
 * disappear from the one path that does not need the server.
 *
 * THE RULES
 *
 *   accept   A reported id is recorded only if it was an INPUT of the call
 *            that failed. The caller knows its inputs (the ids it passed, or
 *            bark's coin selection from the fee estimate); a response that
 *            names anything else is classified for the message and dropped.
 *   show     A listed capsule is excluded from the exit set with its own
 *            reason (`server-says-spent`, see exitTriage) and stays visible
 *            with its amount and expiry. It is never silently dropped.
 *   prune    An id leaves the list only when the WALLET itself observes the
 *            spend: bark marks the capsule Spent or Exited, or holds a finished
 *            exit record for it (Claimed, VtxoAlreadySpent, VtxoSwept). The
 *            server saying so again is not evidence, and neither is the
 *            server going quiet.
 *
 * Pure and import-free apart from the state helper, so the rules are testable
 * without the SDK, matching exitTriage.ts and forcedExit.ts.
 */

import { barkStateTag } from './barkState';

/** `Vtxo.state` tags that mean bark itself knows the capsule is gone. */
const SPENT_VTXO_TAGS = new Set(['spent', 'exited']);

/**
 * `ExitState` tags that end an exit with the capsule's value accounted for on
 * chain. `Canceled` is terminal too but says nothing about a spend, so it is
 * deliberately not here.
 */
const SPEND_EVIDENCE_EXIT_TAGS = new Set(['claimed', 'vtxoalreadyspent', 'vtxoswept']);

const lower = (id: unknown) => String(id ?? '').toLowerCase();

/**
 * Was the capsule the server named one the failed call actually used?
 *
 * `inputVtxoIds` is the list the caller handed to bark, or bark's own coin
 * selection as reported by the fee estimate. `null` means the caller cannot
 * name its inputs, and then nothing is accepted: the message is still shown,
 * the list is not touched.
 */
export function acceptServerSpentId(
    reportedId: string | null | undefined,
    inputVtxoIds: readonly string[] | null | undefined,
): boolean {
    if (!reportedId || !inputVtxoIds) return false;
    const wanted = lower(reportedId);
    return inputVtxoIds.some((id) => lower(id) === wanted);
}

/**
 * Which listed ids the wallet can now confirm, from its own records.
 *
 * `vtxos` is bark's `allVtxos()` flattened to id and state tag; `exits` is
 * `getExitVtxos()`. Returns the ids to remove from the list, in the list's own
 * spelling.
 */
export function serverSpentIdsWithWalletEvidence(
    serverSpentIds: readonly string[],
    vtxos: readonly { id: string; stateTag: string }[],
    exits: readonly { vtxoId: string; state: unknown }[],
): string[] {
    if (serverSpentIds.length === 0) return [];
    const confirmed = new Set<string>();
    for (const v of vtxos) {
        if (SPENT_VTXO_TAGS.has(lower(v.stateTag))) confirmed.add(lower(v.id));
    }
    for (const e of exits) {
        if (SPEND_EVIDENCE_EXIT_TAGS.has(lower(barkStateTag(e.state)))) confirmed.add(lower(e.vtxoId));
    }
    return serverSpentIds.filter((id) => confirmed.has(lower(id)));
}

/** Soonest expiry (in blocks from the tip) across the listed capsules, for the
 *  exit card's warning. null when no listed capsule has a known expiry. */
export function soonestExpiryBlocks(
    entries: readonly { blocksUntilExpiry: number | null }[],
): number | null {
    let soonest: number | null = null;
    for (const e of entries) {
        if (e.blocksUntilExpiry == null || !Number.isFinite(e.blocksUntilExpiry)) continue;
        if (soonest == null || e.blocksUntilExpiry < soonest) soonest = e.blocksUntilExpiry;
    }
    return soonest;
}
