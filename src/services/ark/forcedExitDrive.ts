/**
 * Drive an exit the user did not start, without putting the wallet into exit
 * mode.
 *
 * useArkSync's exit block runs only while `arkExitInProgress` is up, and that
 * flag is also what locks every spend (`assertNoActiveArkExit`) and skips the
 * normal sync path (refreshes, Lightning drives, boards). A forced exit (bark
 * 0.9.0 force-exit scan, see ./forcedExit.ts) must still be progressed,
 * synced and claimed, so this is the same drive with the flag left down: lock
 * the forced capsules out of coin selection (./forcedExitLock.ts), then
 * progressExits, syncExits, the claim-batching decision and the claim, paced
 * by the same cadence rule as the user drive. The normal sync path runs after
 * it on the same tick, so the rest of the wallet keeps working.
 *
 * Deliberately NOT here: the exit flags and their completion handling (nothing
 * to clear), the exit-ready OS alarm (the one-off notice tells the user to
 * reopen the app), the activity-log pair (no correlation id). The tip is not
 * polled either: the normal path refreshes `arkChainTipHeight` every tick.
 *
 * Never throws; the sync tick must go on to the normal path whatever happens.
 */

import useAuthStore from '@Cypher/stores/authStore';

import { barkStateTag, isActiveExit } from './barkState';
import {
    claimArkExitsToAddress,
    fetchArkExitVtxos,
    fetchClaimableExitVtxos,
    progressArkExits,
    syncArkExits,
} from './exit';
import { decideExitClaimBatch } from './exitClaimBatch';
import { decideExitDrivePlan, type ExitDriveSnapshot } from './exitDriveCadence';
import { fetchArkExitDriveFeeRate, fetchClaimFeeRateSatPerVb } from './exitFunding';
import type { ExitRecordLike } from './forcedExit';
import { lockForcedExitVtxos } from './forcedExitLock';
import { getArkWalletHandle } from './walletHandle';

/** Same window the user drive gives stragglers before claiming without them. */
const FORCED_CLAIM_BATCH_MAX_WAIT_MS = 6 * 60 * 60 * 1000;

let snapshot: ExitDriveSnapshot | null = null;
let lastFullRunMs = 0;
let batchSince: number | null = null;

export function resetForcedExitDriveForTests(): void {
    snapshot = null;
    lastFullRunMs = 0;
    batchSince = null;
}

export type ForcedExitDriveOutcome = {
    action: 'skipped' | 'driven' | 'no-handle';
    lockedCount: number;
    lockFailedCount: number;
    claimTxid: string | null;
};

export async function driveForcedExits(
    forced: readonly ExitRecordLike[],
): Promise<ForcedExitDriveOutcome> {
    const none: ForcedExitDriveOutcome = { action: 'no-handle', lockedCount: 0, lockFailedCount: 0, claimTxid: null };
    if (forced.length === 0 || !getArkWalletHandle()) return none;

    // First, and every tick: the lock is what keeps bark's own coin selection
    // off these capsules while the rest of the wallet stays usable.
    const { locked, failed } = await lockForcedExitVtxos(forced.map((e) => String(e.vtxoId)));
    if (failed.length > 0) {
        console.warn('[Ark forced-exit] ', failed.length, 'capsule(s) not locked; maintenance is held until they are');
    }

    const now = Date.now();
    const store = useAuthStore.getState();
    const plan = decideExitDrivePlan({
        last: snapshot,
        tipHeight: store.arkChainTipHeight ?? null,
        now,
        lastFullRunAt: lastFullRunMs,
        // The normal sync path refreshes the tip every tick, so a 'tip' step is
        // never needed here and reads as a skip below.
        lastTipPollAt: now,
    });
    if (plan.action !== 'full') {
        if (__DEV__) console.log(`[Ark forced-exit] drive skipped (${plan.phase}/${plan.reason})`);
        return { action: 'skipped', lockedCount: locked.length, lockFailedCount: failed.length, claimTxid: null };
    }
    lastFullRunMs = now;

    let claimTxid: string | null = null;
    try {
        let driveFeeRate: bigint | undefined;
        try {
            driveFeeRate = await fetchArkExitDriveFeeRate();
        } catch (rateErr: any) {
            console.warn('[Ark forced-exit] drive fee-rate lookup failed, letting the SDK choose:', rateErr?.message ?? rateErr);
        }
        await progressArkExits(driveFeeRate);
        await syncArkExits();

        const records = await fetchArkExitVtxos();
        const active = records.filter((v) => isActiveExit(v));
        const claimable = await fetchClaimableExitVtxos();

        const pendingClaimableHeights: number[] = [];
        let unknownScheduleCount = 0;
        for (const v of active) {
            if (v.isClaimable) continue;
            const h = Number((v.state as { inner?: { claimableHeight?: number } })?.inner?.claimableHeight ?? 0);
            if (Number.isFinite(h) && h > 0) pendingClaimableHeights.push(h);
            else unknownScheduleCount += 1;
        }
        snapshot = {
            claimableCount: claimable.length,
            awaitingHeights: pendingClaimableHeights,
            processingCount: unknownScheduleCount,
        };

        const decision = decideExitClaimBatch({
            claimableCount: claimable.length,
            stillProgressingCount: active.filter((v) => !v.isClaimable).length,
            batchSince,
            now: Date.now(),
            maxWaitMs: FORCED_CLAIM_BATCH_MAX_WAIT_MS,
            tipHeight: useAuthStore.getState().arkChainTipHeight ?? null,
            pendingClaimableHeights,
            unknownScheduleCount,
        });
        batchSince = decision.batchSince;

        console.log(
            '[Ark forced-exit] drive:', active.length, 'active,', claimable.length, 'claimable;',
            records.map((v) => `${String(v.vtxoId).slice(0, 8)}… ${barkStateTag(v.state)}`).join(' | '),
            decision.claim ? '; claiming' : `; claim ${decision.reason}`,
        );

        if (claimable.length > 0 && decision.claim) {
            const dest = useAuthStore.getState().arkExitDestinationAddress;
            if (!dest) {
                // The backfill hook sets this from the Hot Vault; the notice
                // already told the user what to do when there is none.
                console.warn('[Ark forced-exit] claimable but no destination address is set; not claiming');
            } else {
                // Same pricing rule as the user drive: the claim races nothing
                // and its fee comes out of the claimed value.
                const claimRate = await fetchClaimFeeRateSatPerVb();
                const claim = await claimArkExitsToAddress(dest, BigInt(claimRate));
                if (claim.txid) {
                    claimTxid = claim.txid;
                    batchSince = null;
                    console.log(`[Ark forced-exit] claim broadcast txid=${claim.txid} fee=${claim.feeSats} sats`);
                }
            }
        }
    } catch (err: any) {
        console.warn('[Ark forced-exit] drive failed (will retry next tick):', err?.message ?? err);
    }
    return { action: 'driven', lockedCount: locked.length, lockFailedCount: failed.length, claimTxid };
}
