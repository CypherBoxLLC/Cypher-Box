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

import { barkStateTag } from './barkState';
import { assertNoActiveArkExit } from './exit';
import { getArkOnchainAddress } from './receive';
import { ensureArkWalletHandleReady } from './restore';
import { getArkWalletHandle } from './walletHandle';

// --- Tunable sizing constants ----------------------------------------------
//
// The reserve is grounded in the SDK's own per-VTXO exit-cost data
// (`Vtxo.exitTxWeightWu` = weight of the full unilateral exit tx chain, and
// `Vtxo.exitDepth` = number of levels in that chain), so it tracks real exit
// cost rather than a blind guess. The multipliers add headroom for the
// multi-block window an exit spans (a fee spike mid-exit is its weak spot, and
// per Bark's Peter you want runway to "refill the onchain wallet if you run
// out"). All values are intentionally conservative: over-reserving is
// harmless (the extra sats stay the user's own on-chain, and the auto-board
// pipeline boards any excess above the reserve back into Ark later), while
// under-reserving stalls the exit.

/** Per exit-tree level: the CPFP child (anchor input + funding input + change)
 *  that bumps that level. Upper-bounded; matches RECOVER_EST_VSIZE in
 *  ./recoverOnchainBoard.ts. Applied `exitDepth` times per VTXO. */
const CPFP_CHILD_VB = 150;
/** Headroom multiplier over the current fee rate, for a fee spike during the
 *  (multi-block) exit window. */
const SPIKE_MULT = 2.0;
/** Lower bound whenever there is anything to exit, so a low fee rate (or a
 *  runtime `exitTxWeightWu` of 0) still reserves enough for at least one CPFP
 *  child at a moderate rate. Kept below the 50k board minimum so it doesn't
 *  over-hoard on-chain.
 *
 *  Sized to the stated rationale (one CPFP child ~150 vB at a moderate rate
 *  with the spike buffer), not a flat 10k. The old 10k floor over-reserved
 *  small exits by 2-4x their real cost and, combined with the (soft) fee gate,
 *  made a well-funded small vault look unfundable for exit. This is guidance
 *  only now: the exit stays startable via "Start exit anyway" whenever there
 *  is any on-chain balance, so the floor no longer blocks — it just sets the
 *  auto-board hold target. */
const RESERVE_FLOOR_SATS = 5_000;
/** Fallback per-VTXO vsize used only if the SDK returns `exitTxWeightWu === 0`
 *  at runtime (the type says it's populated; guard anyway). */
const FALLBACK_VB_PER_VTXO = 200;
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
    /** Count of VTXOs the reserve was sized over. */
    vtxoCount: number;
    /** Fee rate (sat/vB) the recommendation was computed at. */
    feeRateSatPerVb: number;
    /** Summed exit vsize across the exitable VTXOs (pre-multiplier). */
    totalExitVb: number;
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
/** Claim-fee bounds. The claim is NOT the exit-tree CPFP and must not be priced
 *  like it: see fetchClaimFeeRateSatPerVb. Floor 1 because anything below the
 *  relay minimum is unrelayable; ceiling because an unbounded spike would
 *  reproduce the exact bug this exists to prevent. */
const CLAIM_RATE_MIN = 1;
const CLAIM_RATE_MAX = 5;

/**
 * Fee rate for the exit CLAIM, which is a different problem from the exit-tree
 * CPFP that `fetchFastFeeRateSatPerVb` prices.
 *
 * The CPFP children are time-critical: the exit tree has to confirm before the
 * VTXO expires, so paying for speed there is buying something real, and it is
 * paid out of the on-chain reserve.
 *
 * A claim is the opposite. It spends an output whose CSV has already matured,
 * it races nothing, and its fee comes out of the claimed value itself. Paying
 * a "fastest" rate there buys no safety and directly destroys small claims.
 *
 * Observed live 2026-08-19 on a real mainnet exit: with no rate passed, bark
 * priced a single-capsule claim at 779 sats against a 698 sat output and
 * refused to build it ("Claim Fee Exceeds Output: Cost to claim exits was
 * 0.00000779 BTC, but the total output was 0.00000698 BTC"). That is ~6.6
 * sat/vB over the measured 117.5 vB claim, at a moment when the mempool wanted
 * 1. The two claims that had already succeeded went at 1.1 and 1.9 sat/vB. The
 * failure is caught and retried every drive tick, so the exit sat in an
 * infinite retry loop that could never succeed.
 *
 * So: take the 1-hour rate, not the fastest, and clamp it.
 */
export async function fetchClaimFeeRateSatPerVb(): Promise<number> {
    const clamp = (n: number) =>
        Math.min(CLAIM_RATE_MAX, Math.max(CLAIM_RATE_MIN, Math.ceil(n)));
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('https://mempool.space/api/v1/fees/recommended', {
            signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) return CLAIM_RATE_MIN;
        const rec = await res.json();
        const raw = Number(rec?.hourFee ?? rec?.economyFee);
        if (!isFinite(raw) || raw <= 0) return CLAIM_RATE_MIN;
        return clamp(raw);
    } catch {
        // Unreachable fee API. Floor rather than the reserve's congestion hedge:
        // an over-priced claim does not fail slowly, it fails permanently.
        return CLAIM_RATE_MIN;
    }
}

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
 * Compute the recommended on-chain fee reserve for a full-wallet exit.
 *
 * Reads `handle.allVtxos()` fresh (the store's `ArkVtxoView` drops
 * `exitTxWeightWu` / `exitDepth`, so the cached VTXO list can't be reused).
 * (allVtxos is a JS-thread-blocking UniFFI call; call this off the render
 * path.) Filters to non-spent VTXOs, mirroring the wallet-exit set that
 * `startExitForEntireWallet` marks.
 *
 * Returns `recommendedSats: 0` when the wallet handle is unset or there is
 * nothing exitable.
 */
export async function computeExitFeeReserveSats(): Promise<ExitFeeReserve> {
    const empty: ExitFeeReserve = {
        recommendedSats: 0,
        vtxoCount: 0,
        feeRateSatPerVb: 0,
        totalExitVb: 0,
    };

    const handle = getArkWalletHandle();
    if (!handle) return empty;

    let vtxos;
    try {
        vtxos = await handle.allVtxos();
    } catch (err) {
        if (__DEV__) console.warn('[Ark exit-funding] allVtxos threw:', err);
        return empty;
    }

    const exitable = (vtxos ?? []).filter(
        // bark 0.6.1: `state` is a tagged-enum object; read its variant string.
        // Same semantics as before: exclude already-spent vtxos from the
        // exit-fee estimate.
        (v) => barkStateTag(v.state).toLowerCase() !== 'spent',
    );
    if (exitable.length === 0) return empty;

    let totalExitVb = 0;
    for (const v of exitable) {
        const chainVb = Math.ceil(Number(v.exitTxWeightWu ?? 0n) / 4);
        const perVtxoVb =
            Math.max(chainVb, FALLBACK_VB_PER_VTXO) +
            Math.max(0, Number(v.exitDepth ?? 0)) * CPFP_CHILD_VB;
        totalExitVb += perVtxoVb;
    }

    const feeRateSatPerVb = await fetchFastFeeRateSatPerVb();
    const computed = Math.ceil(totalExitVb * feeRateSatPerVb * SPIKE_MULT);
    const recommendedSats = Math.max(RESERVE_FLOOR_SATS, computed);

    if (__DEV__) {
        console.log(
            '[Ark exit-funding] reserve:',
            recommendedSats, 'sats over', exitable.length, 'vtxos;',
            'totalExitVb=', totalExitVb,
            'feeRate=', feeRateSatPerVb, 'sat/vB; spikeMult=', SPIKE_MULT,
        );
    }

    return {
        recommendedSats,
        vtxoCount: exitable.length,
        feeRateSatPerVb,
        totalExitVb,
    };
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
