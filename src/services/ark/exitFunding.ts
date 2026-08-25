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
import { ESPLORA_URLS } from './config';
import { assertNoActiveArkExit } from './exit';
import type {
    ExitEconomicPolicy,
    ExitFeeRateTable,
    ExitFeeUrgency,
    ExitTriageResult,
    ExitTriageVtxo,
} from './exitTriage';
import {
    EXIT_FEE_FALLBACK_RATES,
    RESERVE_FLOOR_SATS,
    SPIKE_MULT,
    exitFeeUrgency,
    ratesFromEsploraEstimates,
    ratesFromMempoolRecommended,
    triageArkExit,
    urgencyFromSlackBlocks,
} from './exitTriage';
import { getArkOnchainAddress } from './receive';
import { ensureArkWalletHandleReady } from './restore';
import { getArkWalletHandle } from './walletHandle';
import { runBroadcastCall } from './indeterminate';

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

/**
 * Fee rate for the exit-tree CPFP children, at the urgency the capsules
 * actually have.
 *
 * Falls back to the fastest rate present in the response, and then to the
 * congestion-hedge constant, so a malformed or partial response bids HIGH.
 * Under-bidding here risks the capsule; over-bidding only parks sats on-chain
 * that stay the user's own.
 */
/**
 * All four bands, from the best source that answers.
 *
 * Three sources, in order, because a single fee API is a single point of
 * failure and it fired on the first day: mempool.space was unreachable from
 * both the device and the dev machine on 2026-08-20, which collapsed every band
 * to one constant and undid the runway pricing entirely.
 *
 *   1. mempool.space named tiers, the richest signal
 *   2. esplora /fee-estimates, keyed by confirmation target, across the same
 *      providers the wallet already rotates (blockstream answered when
 *      mempool.space did not)
 *   3. band-aware constants, which still respect urgency rather than flattening
 *
 * Fetched as a table rather than one band at a time because pricing the exit
 * takes more than one pass (see computeArkExitPlan) and refetching between them
 * would let the market move underneath the comparison.
 */
/**
 * How old the cached chain tip may be before triage refuses to reason about
 * runway with it.
 *
 * One hour, so roughly six blocks. Normal foreground use refreshes the tip far
 * more often than this, so the threshold never fires in practice; what it
 * catches is the case it exists for, a cold launch with no connectivity
 * rehydrating a persisted tip from an arbitrarily long time ago. Six blocks of
 * drift against a runway of ~156 is tolerable slop; six hundred is not.
 */
export const MAX_TIP_AGE_FOR_TRIAGE_MS = 60 * 60 * 1000;

export async function fetchExitFeeRates(): Promise<ExitFeeRateTable> {
    const get = async (url: string): Promise<unknown | null> => {
        try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(t);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    };

    const recommended = await get('https://mempool.space/api/v1/fees/recommended');
    const fromMempool = ratesFromMempoolRecommended(recommended);
    if (fromMempool) return fromMempool;

    for (const base of ESPLORA_URLS) {
        const est = await get(`${base}/fee-estimates`);
        const fromEsplora = ratesFromEsploraEstimates(est);
        if (fromEsplora) {
            if (__DEV__) console.log('[Ark exit-funding] fee rates via esplora', base, fromEsplora);
            return fromEsplora;
        }
    }

    if (__DEV__) {
        console.warn(
            '[Ark exit-funding] every fee source unreachable; using band-aware fallback',
            EXIT_FEE_FALLBACK_RATES,
        );
    }
    return EXIT_FEE_FALLBACK_RATES;
}

/**
 * Same fetch, but says whether the answer came from the market or from
 * constants. `fetchExitFeeRates` cannot: its return type is a bare
 * Record<band, number> with nowhere to put the provenance, so a total network
 * failure was indistinguishable from a live quote at the call site. The exit
 * confirm dialog prices real money against these, so it has to know.
 */
export async function fetchExitFeeRatesWithSource(): Promise<{
    rates: ExitFeeRateTable;
    estimated: boolean;
}> {
    const rates = await fetchExitFeeRates();
    return { rates, estimated: rates === EXIT_FEE_FALLBACK_RATES };
}

export async function fetchExitTreeFeeRateSatPerVb(
    urgency: ExitFeeUrgency,
): Promise<number> {
    return (await fetchExitFeeRates())[urgency];
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
/**
 * Deadline height from the most recent plan, for the caller to persist when it
 * actually starts an exit. Module-level rather than on the result so the plan
 * type stays a pure description of the exit set.
 */
let lastExitFeeDeadlineHeight: number | null = null;

/** Deadline height the last computed plan was priced against. */
export function getLastExitFeeDeadlineHeight(): number | null {
    return lastExitFeeDeadlineHeight;
}

export async function computeArkExitPlan(
    opts?: { economicPolicy?: ExitEconomicPolicy },
): Promise<ExitTriageResult | null> {
    const vtxos = await readExitCandidates();
    if (!vtxos) return null;

    const s = useAuthStore.getState();
    // A STALE tip is worse than no tip. `arkChainTipHeight` is persisted, so a
    // cold launch offline rehydrates one that may be days old, and
    // `expiryHeight - staleTip` then overstates every capsule's runway by
    // exactly that staleness. Overstating runway is the unsafe direction on the
    // one axis that is a hard exclusion. Past the threshold we hand triage null
    // instead, which makes it disclose the gap rather than quietly trust a
    // number it cannot justify.
    const tipAgeMs =
        s.arkChainTipHeightAt != null ? Date.now() - s.arkChainTipHeightAt : Infinity;
    const tipIsFresh = s.arkChainTipHeight != null && tipAgeMs <= MAX_TIP_AGE_FOR_TRIAGE_MS;
    const chainTipHeight = tipIsFresh ? (s.arkChainTipHeight as number) : null;
    const vtxoExitDeltaBlocks = s.arkVtxoExitDeltaBlocks ?? null;

    const { rates, estimated: feeRatesEstimated } = await fetchExitFeeRatesWithSource();
    const runTriage = (feeRateSatPerVb: number) =>
        triageArkExit({
            vtxos,
            feeRateSatPerVb,
            chainTipHeight,
            vtxoExitDeltaBlocks,
            maxVtxoExitDepth: s.arkMaxVtxoExitDepth ?? null,
            economicPolicy: opts?.economicPolicy,
        });

    // Pricing and selection depend on each other: the rate decides which
    // capsules are worth exiting, and which capsules are being exited decides
    // how urgent the rate has to be. Resolved by probing rather than iterating
    // to a fixed point, because the dearest pass IS the old behaviour and is
    // therefore always a safe answer to fall back to.
    const urgentPlan = runTriage(rates.urgent);
    let plan = urgentPlan;
    let urgency = exitFeeUrgency(urgentPlan.selected);

    if (urgentPlan.selected.length === 0 && rates.relaxed < rates.urgent) {
        // Nothing survives at the dearest rate, so there is no selection to read
        // an urgency off, and taking the empty set's 'urgent' at face value
        // pins the rate high and keeps the answer permanently empty. Probe the
        // cheapest band: if anything IS exitable down there, its own runway
        // decides the real rate below.
        const cheapest = runTriage(rates.relaxed);
        if (cheapest.selected.length > 0) urgency = exitFeeUrgency(cheapest.selected);
    }

    if (rates[urgency.urgency] < rates.urgent) {
        // Price at what the runway justifies. A cheaper rate can only ADD
        // capsules, so re-read the urgency of that larger set: if a newcomer is
        // tighter than anything already counted, the cheaper rate was not
        // justified after all and the dearest pass stands.
        const cheaperPlan = runTriage(rates[urgency.urgency]);
        const recheck = exitFeeUrgency(cheaperPlan.selected);
        if (cheaperPlan.selected.length > 0 && rates[recheck.urgency] <= rates[urgency.urgency]) {
            plan = cheaperPlan;
            urgency = recheck;
        }
    }
    lastExitFeeDeadlineHeight = urgency.deadlineHeight;

    if (__DEV__) {
        console.log(
            '[Ark exit-triage] selected', plan.selected.length, 'of',
            plan.selected.length + plan.excluded.length, 'capsules;',
            plan.selectedSats, 'sats in,', plan.netRecoverableSats, 'recoverable;',
            'excluded', plan.excluded.length, 'holding', plan.excludedSats, 'sats;',
            'reserve=', plan.reserveSats, 'over totalExitVb=', plan.totalExitVb,
            'at', plan.feeRateSatPerVb, 'sat/vB (claim at', plan.claimFeeRateSatPerVb,
            '); policy=', plan.economicPolicy,
            '; urgency=', urgency.urgency, 'slack=', urgency.tightestSlackBlocks, 'blocks',
            '; rates=', JSON.stringify(rates),
            '; netLoss=', plan.netLossSats, '; overridable=', plan.overridableCount,
            plan.usedAssumedExitDelta ? '; exit delta ASSUMED' : '',
            feeRatesEstimated ? '; fee rates FALLBACK' : '',
            tipIsFresh ? '' : `; tip UNUSABLE (age ${Math.round(tipAgeMs / 60000)}m)`,
        );
        for (const e of plan.excluded) {
            console.log(
                `[Ark exit-triage] excluded ${e.id} ${e.sats} sats depth=${e.exitDepth}`,
                `perVtxoVb=${e.perVtxoVb} reason=${e.reason}`,
            );
        }
    }

    // Provenance the pure triage cannot know. Carried on the plan so the confirm
    // dialog can say which of its numbers are market-priced and which are not.
    return { ...plan, feeRatesEstimated };
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
 * Fee rate the exit drive should bid for its CPFP children RIGHT NOW.
 *
 * `progressExits` used to be called with no rate at all, so bark chose one and
 * whatever it chose had nothing to do with the reserve the user had been asked
 * to fund. That was survivable only because the reserve was sized at the
 * fastest rate and therefore almost always generous. Now that the reserve is
 * priced to the runway, the bid has to be priced the same way or the two can
 * disagree in the dangerous direction.
 *
 * Re-derived every tick from the persisted deadline height and the current tip,
 * so a capsule drifting toward its expiry starts bidding harder on its own.
 * Costs one small fee-API call and no wallet read.
 *
 * Returns undefined when there is no deadline to price against, which leaves
 * the SDK's own choice in place rather than inventing one.
 */
export async function fetchArkExitDriveFeeRate(): Promise<bigint | undefined> {
    const s = useAuthStore.getState();
    const deadline = s.arkExitFeeDeadlineHeight;
    const tip = s.arkChainTipHeight;
    if (typeof deadline !== 'number' || typeof tip !== 'number') return undefined;
    const urgency = urgencyFromSlackBlocks(deadline - tip);
    const rate = await fetchExitTreeFeeRateSatPerVb(urgency);
    if (__DEV__) {
        console.log(
            '[Ark exit-drive] bidding', rate, 'sat/vB;',
            'urgency=', urgency, 'slack=', deadline - tip, 'blocks',
        );
    }
    return BigInt(Math.max(1, Math.ceil(rate)));
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
    // 'conversion' matches the tab the user is on ("Convert from balance").
    // Deliberately not "offboard", which is bark's word and appears nowhere in
    // the UI.
    const txid = await runBroadcastCall(
        () => handle.sendOnchain(address, BigInt(Math.floor(amountSats))),
        'conversion',
    );
    if (__DEV__) {
        console.log(
            '[Ark exit-funding] convert offboard broadcast',
            amountSats, 'sats -> on-chain fee wallet; txid=', txid,
        );
    }
    return { txid, grossSats: amountSats };
}
