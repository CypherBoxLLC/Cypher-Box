/**
 * The "Re-check" action for capsules the Ark server has called spent.
 *
 * Asks the server and the chain again, then lets the WALLET decide. The server
 * round-trip is `syncArkWallet()`: the SDK offers no "is this capsule spent"
 * query, and sync is the call that ingests whatever the server now knows about
 * this wallet's capsules (round finalisations, force-exits, recovery mailbox).
 * The chain read is a fresh tip, so the expiry shown next to the capsule is
 * current. Then the list is re-read, and `fetchArkVtxos` applies the one
 * pruning rule there is: an id leaves only when bark itself records the
 * capsule as Spent/Exited or holds a finished exit record for it (see
 * ./serverSpentList.ts). The server repeating itself changes nothing, and a
 * server that is down changes nothing either.
 *
 * Never throws; the outcome says what happened so the screen can word it.
 */

import useAuthStore from '@Cypher/stores/authStore';

import { fetchChainTipHeight, getChainTipFetchedAt } from './chainTip';
import { syncArkWallet } from './sync';
import { fetchArkVtxos } from './vtxos';

export type ServerSpentRecheck = {
    /**
     *   confirmed  the wallet now records at least one listed capsule as spent
     *              (those ids were pruned)
     *   unchanged  server and chain were reached, nothing new
     *   failed     the server or the capsule read could not be reached
     *   nothing    the list was empty to begin with
     */
    outcome: 'confirmed' | 'unchanged' | 'failed' | 'nothing';
    /** Ids pruned by this re-check. */
    confirmedIds: string[];
    /** Ids still on the list afterwards. */
    remainingIds: string[];
};

export async function recheckArkServerSpentVtxos(): Promise<ServerSpentRecheck> {
    const before = [...(useAuthStore.getState().arkServerSpentVtxoIds ?? [])];
    if (before.length === 0) return { outcome: 'nothing', confirmedIds: [], remainingIds: [] };

    let serverReached = false;
    try {
        serverReached = await syncArkWallet();
    } catch (err: any) {
        console.warn('[Ark server-spent] re-check: wallet sync failed:', err?.message ?? err);
    }
    try {
        const tip = await fetchChainTipHeight();
        if (tip != null) useAuthStore.getState().setArkChainTipHeight(tip, getChainTipFetchedAt());
    } catch (err: any) {
        console.warn('[Ark server-spent] re-check: chain tip failed:', err?.message ?? err);
    }

    let readOk = false;
    try {
        const list = await fetchArkVtxos();
        if (list) {
            readOk = true;
            useAuthStore.getState().setArkVtxos(list.spendable);
        }
    } catch (err: any) {
        console.warn('[Ark server-spent] re-check: capsule read failed:', err?.message ?? err);
    }

    const after = new Set((useAuthStore.getState().arkServerSpentVtxoIds ?? []).map((id) => id.toLowerCase()));
    const confirmedIds = before.filter((id) => !after.has(id.toLowerCase()));
    const remainingIds = before.filter((id) => after.has(id.toLowerCase()));
    console.log(
        '[Ark server-spent] re-check:', serverReached ? 'server reached' : 'server NOT reached',
        '; confirmed', confirmedIds.length, 'of', before.length,
    );
    if (confirmedIds.length > 0) return { outcome: 'confirmed', confirmedIds, remainingIds };
    if (!serverReached || !readOk) return { outcome: 'failed', confirmedIds, remainingIds };
    return { outcome: 'unchanged', confirmedIds, remainingIds };
}
