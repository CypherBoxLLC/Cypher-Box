/**
 * Tell the user, once, about an exit they did not start. The rules live in
 * ./forcedExit.ts; this is the side that reads the store, prices the fee need
 * and shows the Alert. Called by the sync loop with the exit records it has
 * already fetched, so it costs no extra bark call beyond the fee pricing.
 *
 * An Alert, not a toast: the user has to do something (keep the app open, top
 * up fees) and a toast is gone before that can be read. Nothing here changes
 * what the drive does with the exit.
 */

import { Alert } from 'react-native';

import useAuthStore from '@Cypher/stores/authStore';

import { AVG_BLOCK_MINUTES } from './chainTip';
import { computeExitFeeNeedForVtxos } from './exitFunding';
import {
    buildForcedExitNotice,
    pickForcedExitsToNotice,
    sumExitSats,
    type ExitRecordLike,
} from './forcedExit';
import { getLastOnchainBalanceSats } from './walletHandle';
import loc from '../../../loc';

/** Exposed for the sync loop's log line and for tests. Never throws. */
export async function noticeForcedExits(exits: readonly ExitRecordLike[]): Promise<string[]> {
    const s = useAuthStore.getState();
    const toNotice = pickForcedExitsToNotice(
        exits,
        { startedIds: s.arkExitStartedVtxoIds ?? [], exitStartedAt: s.arkExitStartedAt ?? null },
        s.arkForcedExitNoticedVtxoIds ?? [],
    );
    if (toNotice.length === 0) return [];
    const ids = toNotice.map((e) => String(e.vtxoId));
    // Recorded BEFORE anything that can fail below, so a throw cannot make the
    // sync loop show the same notice on every tick.
    s.addArkForcedExitNoticedVtxoIds(ids);

    const sats = sumExitSats(toNotice);
    console.warn(
        '[Ark exit] forced exit: ', ids.length, 'capsule(s),', sats,
        'sats entered the exit flow without being started on this device;',
        ids.map((id) => id.slice(0, 12)).join(','),
    );

    let need: Awaited<ReturnType<typeof computeExitFeeNeedForVtxos>> = null;
    try {
        need = await computeExitFeeNeedForVtxos(ids);
    } catch (err: any) {
        console.warn('[Ark exit] forced exit: fee need could not be priced:', err?.message ?? err);
    }
    const st = useAuthStore.getState();
    const held =
        st.arkBalanceDetail?.onchainBoardingSats ??
        getLastOnchainBalanceSats()?.confirmedSats ??
        0;

    try {
        const { title, body } = buildForcedExitNotice({
            sats,
            count: toNotice.length,
            destination: st.arkExitDestinationAddress ?? null,
            waitBlocks: need?.collectableInBlocks ?? null,
            blockMinutes: AVG_BLOCK_MINUTES,
            feeHeldSats: Number(held) || 0,
            feeNeededSats: need?.reserveSats ?? null,
        });
        Alert.alert(title, body, [{ text: loc._.ok }]);
    } catch (err: any) {
        console.warn('[Ark exit] forced exit: notice failed:', err?.message ?? err);
    }
    return ids;
}
