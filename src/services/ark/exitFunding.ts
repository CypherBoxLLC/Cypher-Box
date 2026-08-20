/**
 * Exit-fee funding: size, gate, and top up the on-chain wallet that pays for
 * a unilateral (emergency) exit.
 *
 * Why this exists: `progressExits(onchain, feeRate)` (see ./exit.ts) fee-bumps
 * the exit-tree txs via CPFP, and it draws those fees from bark's SEPARATE
 * on-chain (BDK) wallet, NOT from the user's Ark (VTXO) balance. For a
 * Lightning-only user that on-chain wallet holds 0 sats, so an exit started
 * today just stalls: `progressExits` retries every sync tick with nothing to
 * broadcast. This module computes a recommended on-chain reserve, tells the UI
 * whether it's funded, and offers the cooperative-offboard ("convert") top-up.
 * The receive top-up (external BTC to `getArkOnchainAddress()`) is the
 * ASP-independent path and lives in the UI directly.
 *
 * Fee-source note: the reserve funds `progressExits` (CPFP) ONLY.
 * `drainExits` (the final sweep to the user's address) takes no on-chain
 * wallet (its fee comes off the swept output), so it is deliberately NOT part
 * of this reserve.
 */

import useAuthStore from '@Cypher/stores/authStore';

import { barkStateTag } from './barkState';
import { assertNoActiveArkExit } from './exit';
import type { ExitEconomicPolicy, ExitTriageResult, ExitTriageVtxo } from './exitTriage';
import { RESERVE_FLOOR_SATS, SPIKE_MULT, triageArkExit } from './exitTriage';
import { getArkOnchainAddress } from './receive';
import { ensureArkWalletHandleReady } from './restore';
import { getArkWalletHandle } from './walletHandle';

// --- Tunable sizing constants ----------------------------------------------
//
// The per-capsule cost model (CPFP_CHILD_VB, FALLBACK_VB_PER_VTXO, SPIKE_MULT,
// RESERVE_FLOOR_SATS) moved to ./exitTriage, which is the module that decides
// which capsules the reserve is FOR. Keeping two copies would let the number
// the user is asked to fund drift from the set it was sized over. Only the
// fee-rate fallback, which is about fetching rather than costing, stays here.

/** Fee-rate fallback (sat/vB) when the mempool fetch fails. Deliberately not
 *  tiny, since an emergency exit may run during congestion, but not the old
 *  20 either: on a flaky network the fee fetch fails often, and 20 sat/vB
 *  ballooned the recommendation (e.g. ~108k sats for a 3-VTXO exit) far past
 *  any real cost. 10 keeps a congestion hedge without the runaway over-
 *  reservation. Trade-off: if fees genuinely exceed 10 sat/vB *while* the fee
 *  API is unreachable and the user arms to this recommendation, they may
 *  under-hold; the soft gate + spike buffer absorb that. */
const RESERVE_FEE_FALLBACK_RATE = 10;

export type ExitFeeReserve = {
    /** Recommended sats to hold on-chain to fund the exit. 0 when nothing is
     *  exitable (so a nothing-to-exit wallet is never gated). */
    recommendedSats: number;
    /** Count of VTXOs the reserve was sized over: the SELECTED set, not the
     *  wallet. */
    vtxoCount: number;
    /** Fee rate (sat/vB) the recommendation was computed at. */
    feeRateSatPerVb: number;
    /** Summed exit vsize across the SELECTED VTXOs (pre-multiplier). */
    totalExitVb: number;
    /** Capsules triage dropped from the exit set. */
    excludedCount: number;
    /** Face value of those capsules, which is what the user is being asked to
     *  give up. Never allow this to be non-zero without naming them. */
    excludedSats: number;
};

export type ExitFeeConvertEstimate = {
    /** What the user asked to move from Ark. */
    grossSats: number;
    /** Cooperative-offboard + on-chain fee taken off the top. */
    feeSats: number;
    /** What actually lands in the on-chain fee wallet (gross - fee). */
    netLandingSats: number;
};

/**
 * Current FAST on-chain fee rate (sat/vB) from mempool.space. Unlike the
 * recovery path (which deliberately targets ~1h since recovery isn't urgent),
 * an exit may need to confirm during congestion, so we use `fastestFee`.
 * Always resolves, falling back to a constant on any error/timeout. Uses
 * mempool.space rather than the configured esplora (blockstream), which the
 * codebase repeatedly notes bot-blocks bark's client.
 */
export async function fetchFastFeeRateSatPerVb(): Promise<number> {
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('https://mempool.space/api/v1/fees/recommended', {
            signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) return RESERVE_FEE_FALLBACK_RATE;
        const rec = await res.json();
        const raw = Number(rec?.fastestFee);
        if (!isFinite(raw) || raw <= 0) return RESERVE_FEE_FALLBACK_RATE;
        return Math.max(1, Math.ceil(raw));
    } catch {
        return RESERVE_FEE_FALLBACK_RATE;
    }
}

/**
 * Read every capsule the exit could touch, in the flat shape ./exitTriage
 * wants.
 *
 * Reads `handle.allVtxos()` fresh: the store's `ArkVtxoView` drops
 * `exitTxWeightWu` and `exitDepth`, which are exactly the two fields the whole
 * cost model turns on, so the cached VTXO list cannot be reused. allVtxos is a
 * JS-thread-blocking UniFFI call, so keep this off the render path.
 */
async function readExitCandidates(): Promise<ExitTriageVtxo[] | null> {
    const handle = getArkWalletHandle();
    if (!handle) return null;
    try {
        const vtxos = await handle.allVtxos();
        return (vtxos ?? []).map((v) => ({
            id: v.id,
            sats: Number(v.amountSats ?? 0n),
            exitDepth: Number(v.exitDepth ?? 0),
            exitTxWeightWu: Number(v.exitTxWeightWu ?? 0n),
            expiryHeight: Number(v.expiryHeight ?? 0),
            // bark 0.6.1: `state` is a tagged-enum object; flatten to its
            // variant string so triage can compare it.
            stateTag: barkStateTag(v.state),
            registered: v.registered,
        }));
    } catch (err) {
        if (__DEV__) console.warn('[Ark exit-funding] allVtxos threw:', err);
        return null;
    }
}

/**
 * Decide which capsules an emergency exit should actually exit, and what that
 * costs. This is the function the exit-start path calls: its `selectedIds` go
 * to `startExitForVtxos`, and its `excluded` list is what the user has to be
 * shown before they commit.
 *
 * Takes no ASP call. `vtxoExitDelta` comes from the persisted cache written
 * while the server was last reachable, and a missing cache makes the temporal
 * axis assume the worst rather than skip (see ./exitTriage). That is the whole
 * point: the exit path has to work against a server that is gone.
 *
 * `economicPolicy` is how far past the economics the user has chosen to go.
 * Callers must leave it at the default until the user has been shown the loss
 * in sats and asked (spec principle 4); it is not a retry knob.
 *
 * Returns null only when there is no wallet handle or the VTXO read failed.
 */
export async function computeArkExitPlan(
    opts?: { economicPolicy?: ExitEconomicPolicy },
): Promise<ExitTriageResult | null> {
    const vtxos = await readExitCandidates();
    if (!vtxos) return null;

    const feeRateSatPerVb = await fetchFastFeeRateSatPerVb();
    const s = useAuthStore.getState();

    const plan = triageArkExit({
        vtxos,
        feeRateSatPerVb,
        chainTipHeight: s.arkChainTipHeight ?? null,
        vtxoExitDeltaBlocks: s.arkVtxoExitDeltaBlocks ?? null,
        maxVtxoExitDepth: s.arkMaxVtxoExitDepth ?? null,
        economicPolicy: opts?.economicPolicy,
    });

    if (__DEV__) {
        console.log(
            '[Ark exit-triage] selected', plan.selected.length, 'of',
            plan.selected.length + plan.excluded.length, 'capsules;',
            plan.selectedSats, 'sats in,', plan.netRecoverableSats, 'recoverable;',
            'excluded', plan.excluded.length, 'holding', plan.excludedSats, 'sats;',
            'reserve=', plan.reserveSats, 'over totalExitVb=', plan.totalExitVb,
            'at', plan.feeRateSatPerVb, 'sat/vB (claim at', plan.claimFeeRateSatPerVb,
            '); policy=', plan.economicPolicy,
            '; netLoss=', plan.netLossSats, '; overridable=', plan.overridableCount,
            plan.usedAssumedExitDelta ? '; exit delta ASSUMED' : '',
        );
        for (const e of plan.excluded) {
            console.log(
                `[Ark exit-triage] excluded ${e.id} ${e.sats} sats depth=${e.exitDepth}`,
                `perVtxoVb=${e.perVtxoVb} reason=${e.reason}`,
            );
        }
    }

    return plan;
}

/**
 * Recommended on-chain fee reserve, sized over the capsules the exit will
 * ACTUALLY exit.
 *
 * It used to sum every non-spent VTXO, which billed the user for two things
 * they never get back. Measured on the QA wallet 2026-08-20: dust that triage
 * now discards was 66% of the demanded reserve (32,120 down to 10,808), and ten
 * already-`Exited` capsules, which bark keeps returning from `allVtxos()`
 * forever, added another 14,504 sats of reserve for value that was already
 * on-chain.
 *
 * Returns `recommendedSats: 0` when the wallet handle is unset or nothing
 * survives triage, so a wallet with nothing worth exiting is never gated.
 */
export async function computeExitFeeReserveSats(): Promise<ExitFeeReserve> {
    const empty: ExitFeeReserve = {
        recommendedSats: 0,
        vtxoCount: 0,
        feeRateSatPerVb: 0,
        totalExitVb: 0,
        excludedCount: 0,
        excludedSats: 0,
    };

    const plan = await computeArkExitPlan();
    if (!plan) return empty;

    if (__DEV__) {
        console.log(
            '[Ark exit-funding] reserve:',
            plan.reserveSats, 'sats over', plan.selected.length, 'selected vtxos;',
            'totalExitVb=', plan.totalExitVb,
            'feeRate=', plan.feeRateSatPerVb, 'sat/vB; spikeMult=', SPIKE_MULT,
            '; floor=', RESERVE_FLOOR_SATS,
        );
    }

    return {
        recommendedSats: plan.reserveSats,
        vtxoCount: plan.selected.length,
        feeRateSatPerVb: plan.feeRateSatPerVb,
        totalExitVb: plan.totalExitVb,
        excludedCount: plan.excluded.length,
        excludedSats: plan.excludedSats,
    };
}

/**
 * Cache the server's exit-relevant protocol constants so the exit path never
 * has to ask for them.
 *
 * `vtxoExitDelta` is the CSV a broadcast exit output sits out before it can be
 * claimed, and it is what exit triage measures a capsule's remaining runway
 * against. The exit path is not allowed to call the ASP (a user who pressed the
 * trustless button must get the trustless path, and the server may simply be
 * gone), so this has to be fetched while the server is still reachable and
 * persisted. A missing cache is handled, not fatal: triage assumes the worst
 * plausible delta, which errs toward disclosing an exclusion rather than
 * committing reserve to a capsule the server can sweep mid-exit.
 *
 * Called once per session from the sync loop, next to the round-interval
 * fetch. Never throws.
 */
export async function fetchArkExitParams(): Promise<void> {
    const handle = getArkWalletHandle();
    if (!handle) return;
    try {
        const info = await handle.arkInfo();
        if (!info) return;
        const delta = Number(info.vtxoExitDelta);
        const maxDepth = Number(info.maxVtxoExitDepth);
        useAuthStore.getState().setArkExitParams({
            vtxoExitDeltaBlocks: Number.isFinite(delta) && delta > 0 ? delta : null,
            maxVtxoExitDepth: Number.isFinite(maxDepth) && maxDepth > 0 ? maxDepth : null,
        });
    } catch (err) {
        if (__DEV__) console.warn('[Ark exit-funding] arkInfo (exit params) threw:', err);
    }
}

/**
 * Is the Ark server reachable right now? The "convert" top-up is a cooperative
 * offboard that needs the ASP, so the UI disables it when this is false and
 * steers the user to the receive (external BTC) path instead. `arkInfo()` is an
 * ASP round-trip (mirrors fetchArkMinBoardSats in ./refresh.ts). Never throws.
 */
export async function probeAspReachable(): Promise<boolean> {
    const handle = getArkWalletHandle();
    if (!handle) return false;
    try {
        const info = await handle.arkInfo();
        return !!info;
    } catch (err) {
        if (__DEV__) console.warn('[Ark exit-funding] arkInfo probe threw:', err);
        return false;
    }
}

/**
 * Estimate a "convert" top-up: move `amountSats` from the Ark balance to the
 * on-chain fee wallet via a cooperative offboard (`sendOnchain` to the wallet's
 * own on-chain address). Sizes by NET landing so the UI can ensure the amount
 * that actually reaches the fee wallet covers the shortfall (the offboard +
 * on-chain fee come off the top).
 */
export async function estimateExitFeeConvert(
    amountSats: number,
): Promise<ExitFeeConvertEstimate> {
    assertNoActiveArkExit();
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error('Invalid amount');
    }
    const handle = await ensureArkWalletHandleReady();
    const address = await getArkOnchainAddress();
    const fe = await handle.estimateSendOnchainFee(address, BigInt(Math.floor(amountSats)));
    return {
        grossSats: Number(fe.grossAmountSats),
        feeSats: Number(fe.feeSats),
        netLandingSats: Number(fe.netAmountSats),
    };
}

/**
 * Execute a "convert" top-up: cooperative offboard of `amountSats` from Ark to
 * the on-chain fee wallet. Returns the offboard txid. Caller must ARM the
 * reserve (setArkExitFeeReserveSats) BEFORE calling, or the offboarded sats get
 * boarded straight back into a VTXO on the next sync tick.
 *
 * Precautionary only: this needs the ASP, so it cannot rescue an exit during an
 * ASP outage. The receive (external BTC) path is the ASP-independent one.
 */
export async function convertToExitFees(
    amountSats: number,
): Promise<{ txid: string; grossSats: number }> {
    assertNoActiveArkExit();
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error('Invalid amount');
    }
    const handle = await ensureArkWalletHandleReady();
    const address = await getArkOnchainAddress();
    const txid = await handle.sendOnchain(address, BigInt(Math.floor(amountSats)));
    if (__DEV__) {
        console.log(
            '[Ark exit-funding] convert offboard broadcast',
            amountSats, 'sats -> on-chain fee wallet; txid=', txid,
        );
    }
    return { txid, grossSats: amountSats };
}
