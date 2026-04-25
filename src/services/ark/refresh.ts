import { getArkWalletHandle } from './walletHandle';
import { fetchArkBalance } from './balance';
import { fetchArkVtxos } from './vtxos';
import type { FeeEstimate } from '@secondts/bark-react-native';

export type ArkRefreshFeeView = {
    feeSats: number;
    vtxosSpent: string[];
};

export type ArkRefreshResult = {
    /** Round ID returned by the SDK, or null if no round was scheduled. */
    roundId: string | null;
};

function requireHandle() {
    const handle = getArkWalletHandle();
    if (!handle) {
        throw new Error('Ark wallet not open — cannot refresh VTXOs');
    }
    return handle;
}

/**
 * Fee preview for refreshing the given VTXOs. Surfaces `feeSats` as a plain
 * number so call sites don't have to deal with bigint. `vtxosSpent` is
 * returned verbatim from the SDK — informational, usually equals the input.
 */
export async function estimateArkRefreshFee(
    vtxoIds: string[],
): Promise<ArkRefreshFeeView> {
    const handle = requireHandle();
    const estimate: FeeEstimate = await handle.estimateRefreshFee(vtxoIds);
    return {
        feeSats: Number(estimate.feeSats),
        vtxosSpent: estimate.vtxosSpent,
    };
}

/**
 * Interactive refresh — joins the next Ark round and re-boards the given
 * VTXOs, extending their expiry by another full lifetime.
 *
 * This is a blocking call: it resolves once the round completes (seconds to
 * low minutes depending on round cadence). The caller should keep a
 * spinner / disabled state up until it resolves.
 *
 * SDK returns `undefined` when the round ran but produced no new VTXOs for us
 * (unusual but possible for edge cases like dust-filtered inputs). We
 * normalise that to `null` in the return type so callers don't have to
 * handle JS undefined.
 */
export async function refreshArkVtxos(
    vtxoIds: string[],
): Promise<ArkRefreshResult> {
    const handle = requireHandle();
    console.log('[Ark refresh] refreshVtxos() calling for', vtxoIds.length, 'vtxo(s):', vtxoIds.map((id) => id.slice(0, 12) + '…'));
    const t0 = Date.now();
    try {
        const roundId = await handle.refreshVtxos(vtxoIds);
        console.log(
            '[Ark refresh] refreshVtxos() resolved in', Math.round((Date.now() - t0) / 1000), 's, roundId=',
            roundId ?? '(undefined)',
        );
        return { roundId: roundId ?? null };
    } catch (err: any) {
        console.warn('[Ark refresh] refreshVtxos() threw after', Math.round((Date.now() - t0) / 1000), 's:', err?.message ?? err);
        throw err;
    }
}

/**
 * Convenience: refresh + sync + refetch balance/vtxos in one shot so the
 * caller can await a single promise before tearing down any loading UI.
 *
 * The `wallet.sync()` call is critical after `refreshVtxos()` — the round
 * finalizes server-side and the ASP emits the new VTXO, but the local
 * datadir doesn't ingest any of that until we explicitly sync. Without
 * it, `allVtxos()` still returns the pre-refresh VTXO as Spendable (the
 * old one never flips to Spent, and the new post-refresh VTXO never
 * appears). Balance can look partially-updated because the fee side is
 * tracked locally, which is what makes this bug confusing.
 *
 * Esplora tip deliberately NOT refetched here — that's cheap and already
 * on the 30s poll; no need to block the user on it.
 */
export async function refreshArkVtxosAndSync(
    vtxoIds: string[],
): Promise<ArkRefreshResult> {
    const handle = requireHandle();
    const result = await refreshArkVtxos(vtxoIds);
    // Pull the round outcome into the local datadir before we re-read.
    await handle.sync();
    await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
    return result;
}
