/**
 * Which capsules a unilateral exit should actually exit, and what that costs.
 *
 * Pure and import-free on purpose, so it stays unit-testable without the native
 * bark module, matching exitFundingPlan.ts, refreshBatch.ts, exitReserveTarget.ts
 * and autoBoardDecision.ts.
 *
 * WHY THIS EXISTS
 *
 * `startExitForEntireWallet()` marks every VTXO and `computeExitFeeReserveSats`
 * sums every non-spent VTXO, so an exit chases capsules it can never recover and
 * bills the user for the privilege. Measured 2026-08-20 on the QA wallet at
 * 1 sat/vB: exiting all 8 live capsules costs 16,060 sats of exit-tree fees to
 * rescue 4,990 sats of value, and two 400-sat capsules are 10,656 of that (66%)
 * while holding 16% of the value. Excluding those two takes the demanded reserve
 * from 32,120 to 10,808.
 *
 * The failure mode is not the claim. `drainExits` batches, so a small capsule
 * adds roughly one input (~76 vB) and returns its value; it pays for itself at
 * claim time. The damage is that dust silently consumes the CPFP reserve the
 * healthy capsules need, and with no ordering policy, which capsules get
 * stranded when the reserve runs dry is undefined.
 *
 * THE THRESHOLD IS NOT A SAT AMOUNT
 *
 * A 400-sat capsule at exitDepth 17 costs 5,645 vB and is hopeless. A 400 at
 * depth 2 costs 632 vB and is merely marginal. The rule is computed per capsule
 * from `exitDepth` and `exitTxWeightWu`. ARK_REFRESH_MIN_SATS (500) is the
 * REFRESH floor and is the wrong tool here.
 *
 * TWO POTS, NEVER ONE THRESHOLD
 *
 * The exit-tree cost is charged to the on-chain reserve the user funds
 * separately. The claim cost comes out of the capsule itself. Summing them into
 * a single number would misprice both, so they are tracked separately all the
 * way through.
 */

// --- Cost model ------------------------------------------------------------
//
// Single source of truth for per-capsule exit cost. exitFunding.ts imports
// these rather than keeping its own copy, so the reserve the user is asked to
// fund and the triage that decides what the reserve is for can never disagree.

/** Per exit-tree level: the CPFP child (anchor input + funding input + change)
 *  that bumps that level. Upper-bounded; matches RECOVER_EST_VSIZE in
 *  ./recoverOnchainBoard.ts. Applied `exitDepth` times per capsule. */
export const CPFP_CHILD_VB = 150;

/** Fallback per-capsule vsize used only when the SDK reports
 *  `exitTxWeightWu === 0`. Measured across 196 capsules on 2026-08-19: zero
 *  report 0, including all 117 unregistered ones. Guard anyway. */
export const FALLBACK_VB_PER_VTXO = 200;

/** Headroom multiplier over the current fee rate, for a fee spike during the
 *  multi-block exit window. */
export const SPIKE_MULT = 2.0;

/** Lower bound whenever there is anything to exit, so a low fee rate still
 *  reserves enough for at least one CPFP child at a moderate rate. Kept below
 *  the 50k board minimum so it does not over-hoard on-chain. */
export const RESERVE_FLOOR_SATS = 5_000;

/** Marginal vsize one more capsule adds to a batched `drainExits` claim.
 *  Measured 2026-08-19/20: a standalone 1-in-1-out claim is 117.5 vB
 *  (224 bytes, 470 wu) and each extra input adds ~76. The marginal figure is
 *  the right one because the app always claims through one batched
 *  `drainExits`, so the transaction overhead is paid once for the whole exit,
 *  not once per capsule. */
export const CLAIM_INPUT_VB = 76;

/** Blocks of confirmation runway assumed per exit-tree level.
 *
 *  MODELLED, not measured. Each level spends the level above it, so a level
 *  cannot be broadcast until its parent confirms, and the drive that broadcasts
 *  them is foreground-only and rate-limited by the chain source. One block per
 *  level would assume every CPFP child lands in the next block with the app
 *  open throughout, which the 2026-08-17/20 exit did not manage. Six blocks
 *  (about an hour) per level keeps the temporal axis conservative in the safe
 *  direction: it excludes a capsule slightly too early rather than committing
 *  reserve to one the server can sweep mid-exit. */
export const BLOCKS_PER_EXIT_LEVEL = 6;

/** Floor on the confirmation budget, so a shallow tree still gets real runway. */
export const MIN_CONFIRMATION_BUDGET_BLOCKS = 6;

/** CSV delta assumed when `ArkInfo.vtxoExitDelta` was never cached.
 *
 *  The exit path must not call the ASP (spec principle 2), so a missing cache
 *  cannot be resolved at exit time. Observed mainnet value is 144. Assuming the
 *  worst plausible delta rather than skipping the check means doubling it, the
 *  same 2x posture SPIKE_MULT takes toward fee rates. A capsule excluded on the
 *  assumed delta is named to the user, so the cost of being wrong here is a
 *  disclosed exclusion, not a silent loss. */
export const ASSUMED_EXIT_DELTA_BLOCKS = 288;

/** How far under water a capsule may be and still be worth exiting.
 *
 *  A capsule is worth exiting outright when the reserve it consumes is less
 *  than what it returns. Almost nothing clears that bar: at 1 sat/vB, in the
 *  cheapest fee market in years, the BEST capsule in the measured wallet (698
 *  sats, depth 2) spends 632 of reserve to return 622. So a strict
 *  cost-under-value rule would exclude the entire wallet and the emergency exit
 *  would do nothing.
 *
 *  The honest line is degree, not sign. Refusing to exit a capsule that spends
 *  632 to return 622 abandons 622 sats to the server to save 10 sats of
 *  reserve, which is worse for the user in every direction. Refusing one that
 *  spends 5,645 to return 324 saves seventeen times what it costs. This
 *  multiple is where those two cases separate: spend up to twice what comes
 *  back, never seventeen times.
 *
 *  It is scale-aware without being fee-rate-blind, because both sides move with
 *  the fee rate and the claim side eats the value: the same 698 at depth 2 is
 *  1.0x under water at 1 sat/vB, 9.9x at 5, and returns nothing at all at 20. */
export const MAX_RESERVE_MULTIPLE = 2;

/** VTXO states that hold nothing to exit. `Exited` matters as much as `Spent`
 *  here: bark keeps returning a completed exit's VTXO from `allVtxos()` as
 *  `Exited` forever, and the reserve calc used to filter only `spent`, so ten
 *  finished exits on the measured wallet added 7,252 vB (14,504 sats of
 *  demanded reserve, 31% of the total) for capsules whose value is already
 *  on-chain. */
const TERMINAL_STATE_TAGS = new Set(['spent', 'exited']);

// --- Types -----------------------------------------------------------------

/** One capsule, flattened from the SDK's `Vtxo` at the call boundary so this
 *  module never touches bigint or the native module. */
export type ExitTriageVtxo = {
    id: string;
    sats: number;
    /** Genesis chain length. Dominates cost: measured min 2, median 9, max 49. */
    exitDepth: number;
    /** Weight units of the unilateral exit transaction chain. */
    exitTxWeightWu: number;
    /** Absolute block height the capsule expires at. 0 when unknown. */
    expiryHeight: number;
    /** `Vtxo.state` flattened to its variant name (see ./barkState). */
    stateTag: string;
    /** Server recovery-mailbox flag. Does NOT affect exitability: measured
     *  2026-08-19, all 117 unregistered capsules carry a full exit chain. */
    registered?: boolean;
};

/** Why a capsule holding value is not in the exit set. Every one of these is
 *  surfaced to the user by name and amount before they commit (spec principle
 *  3). Terminal capsules are deliberately NOT in this union: they hold nothing,
 *  the user has never seen them, and listing them would bury the exclusions
 *  that matter. The measured wallet carries 188 of them against 8 live ones. */
export type ExitExclusionReason =
    /** Structural: the SDK reports no exit chain for this capsule. */
    | 'no-exit-chain'
    /** Temporal: the server can sweep it before the exit clears its CSV. */
    | 'too-close-to-expiry'
    /** Economic: its own claim fee is at least its whole value. */
    | 'returns-nothing'
    /** Economic: the reserve it consumes dwarfs what it returns. */
    | 'reserve-dwarfs-value';

/** Disclosures that do not change the decision but the user should still see. */
export type ExitTriageNote =
    /** Chain tip or expiry height unknown, so runway could not be checked. */
    | 'expiry-unknown'
    /** Past `ArkInfo.maxVtxoExitDepth`: the server will not cosign further
     *  arkoor spends, so exit or refresh are the only remaining moves. */
    | 'beyond-server-depth-cap'
    /** Included despite costing more reserve than it returns. */
    | 'under-water';

export type ExitEconomicVerdict = 'profitable' | 'marginal' | 'uneconomic';

/**
 * How far past the economics the user has chosen to go.
 *
 * The economic axis is the only one with an override, and that is deliberate.
 * The other two exclusions are not judgement calls the user can overrule:
 * a structurally unexitable capsule has nothing to broadcast, and a capsule
 * inside its expiry runway loses BOTH itself and the reserve spent on it when
 * the server sweeps it mid-exit. Neither is a trade the user could want.
 *
 * Within the economic axis there is still one hard floor. A capsule whose own
 * claim fee is at least its whole value ('returns-nothing') cannot deliver
 * anything at any price: bark refuses to build a claim whose fee exceeds its
 * output, and the drive then rebuilds that same doomed claim forever. Forcing
 * one in does not cost the user money to rescue funds, it wedges the batch and
 * rescues nothing. So no policy includes it.
 *
 *   'profitable-only'     only capsules whose reserve cost comes back
 *   'default'             the above, plus capsules under water by less than
 *                         MAX_RESERVE_MULTIPLE
 *   'recover-everything'  the above, plus capsules whose reserve cost dwarfs
 *                         what they return. This is spec principle 4: the user
 *                         may knowingly spend more than the funds are worth,
 *                         for instance to deny a hostile server a hostage.
 *                         Callers MUST state the loss in sats before applying
 *                         it, or the "knowingly" is a fiction.
 */
export type ExitEconomicPolicy = 'profitable-only' | 'default' | 'recover-everything';

export type ExitTriageEntry = {
    id: string;
    sats: number;
    exitDepth: number;
    /** Exit-tree vsize for this capsule alone. */
    perVtxoVb: number;
    /** Reserve this capsule consumes at the given fee rate, priced at the bare
     *  rate. The SPIKE_MULT headroom is deliberately NOT applied here: it is
     *  volatility cover for the exit as a whole, and charging it per capsule
     *  inside the profitability test would double-penalise every capsule and
     *  exclude a wallet that is merely fee-sensitive. Sum over the selected set
     *  times SPIKE_MULT is `reserveSats`. */
    exitTreeCostSats: number;
    /** Fee this capsule adds to the batched claim, paid out of its own value. */
    marginalClaimSats: number;
    /** What actually reaches the user's address: value minus its claim fee. */
    netRecoveredSats: number;
    economic: ExitEconomicVerdict;
    /** Blocks until expiry, or null when the tip or expiry height is unknown. */
    blocksUntilExpiry: number | null;
    /** Blocks of runway this capsule needs: confirmation budget + CSV delta. */
    requiredRunwayBlocks: number;
    included: boolean;
    reason?: ExitExclusionReason;
    notes: ExitTriageNote[];
};

export type TriageArkExitInput = {
    vtxos: readonly ExitTriageVtxo[];
    /** Rate the exit-tree CPFP children are priced at (the fast rate). */
    feeRateSatPerVb: number;
    /** Rate the claim is priced at. A claim races nothing and its fee comes out
     *  of the claimed value, so it is a genuinely different rate from the
     *  time-critical CPFP one. Defaults to `claimRateFromExitRate`, which is
     *  what the app actually pays; a default of the raw fast rate would have
     *  triage condemn capsules the claim path would have recovered fine. */
    claimFeeRateSatPerVb?: number;
    /** Current tip. null when every chain-source provider failed. */
    chainTipHeight: number | null;
    /** Cached `ArkInfo.vtxoExitDelta`. null falls back to
     *  ASSUMED_EXIT_DELTA_BLOCKS rather than skipping the temporal axis. */
    vtxoExitDeltaBlocks: number | null;
    /** Cached `ArkInfo.maxVtxoExitDepth`, for the disclosure note only. */
    maxVtxoExitDepth?: number | null;
    /** How far past the economics the user has chosen to go. Defaults to
     *  'default'. See ExitEconomicPolicy. */
    economicPolicy?: ExitEconomicPolicy;
};

export type ExitTriageResult = {
    /** Ids to hand `startExitForVtxos`, ordered most net-recoverable first so a
     *  reserve that runs dry strands the least valuable capsules (spec 4.4). */
    selectedIds: string[];
    selected: ExitTriageEntry[];
    /** Capsules that hold value and are being left behind, largest first, so
     *  disclosure leads with the biggest amount the user is giving up. */
    excluded: ExitTriageEntry[];
    /** Spent / already-Exited capsules skipped before triage. Counted rather
     *  than listed: they hold nothing, so they are a reserve-sizing concern,
     *  not a disclosure one. */
    skippedTerminalCount: number;
    /** Face value of the selected capsules. */
    selectedSats: number;
    /** What the selected capsules actually deliver, after their claim fees. */
    netRecoverableSats: number;
    /** Face value the user is being asked to abandon. */
    excludedSats: number;
    /** Summed exit vsize over the SELECTED capsules only (spec 4.3). */
    totalExitVb: number;
    /** Recommended on-chain reserve for the selected set. 0 when nothing is
     *  selected, so a nothing-to-exit wallet is never gated. */
    reserveSats: number;
    /** Selected capsules that cost more reserve than they return. */
    underWaterCount: number;
    /**
     * Sats the selected set spends beyond what it recovers, 0 when it is not
     * under water. This is the number the user has to be shown before a
     * 'recover-everything' exit, since it IS the loss they are accepting.
     */
    netLossSats: number;
    /**
     * Capsules excluded purely on the economic ratio, which a
     * 'recover-everything' policy would bring back. Lets the UI offer the
     * override only when it would actually change something.
     */
    overridableCount: number;
    /** Face value of those capsules. */
    overridableSats: number;
    economicPolicy: ExitEconomicPolicy;
    feeRateSatPerVb: number;
    claimFeeRateSatPerVb: number;
    /** True when the temporal axis ran on ASSUMED_EXIT_DELTA_BLOCKS. */
    usedAssumedExitDelta: boolean;
};

// --- Cost model helpers ----------------------------------------------------

/**
 * Exit-tree vsize for one capsule: the chain itself plus a CPFP child per
 * level. This is the term that varies 25x inside a single wallet, and it is why
 * a sat-denominated dust threshold cannot express the rule.
 */
export function perVtxoExitVb(v: Pick<ExitTriageVtxo, 'exitDepth' | 'exitTxWeightWu'>): number {
    const chainVb = Math.ceil(Math.max(0, Number(v.exitTxWeightWu) || 0) / 4);
    const depth = Math.max(0, Math.floor(Number(v.exitDepth) || 0));
    return Math.max(chainVb, FALLBACK_VB_PER_VTXO) + depth * CPFP_CHILD_VB;
}

/**
 * Reserve for a given total exit vsize. Zero vsize means nothing to exit and
 * must return 0, NOT the floor, or a wallet with nothing exitable would be
 * gated on a 5,000 sat reserve it has no use for.
 */
export function reserveSatsForExitVb(totalExitVb: number, feeRateSatPerVb: number): number {
    if (totalExitVb <= 0) return 0;
    const rate = Math.max(0, Number(feeRateSatPerVb) || 0);
    return Math.max(RESERVE_FLOOR_SATS, Math.ceil(totalExitVb * rate * SPIKE_MULT));
}

/**
 * Blocks a capsule needs between now and its expiry for an exit to be safe:
 * long enough for its tree to confirm, and then to sit out the CSV delta. Below
 * this the server can sweep the capsule while the exit is still timelocked, so
 * the user loses both the capsule and the reserve spent chasing it.
 */
export function requiredRunwayBlocks(exitDepth: number, exitDeltaBlocks: number): number {
    const depth = Math.max(0, Math.floor(Number(exitDepth) || 0));
    const confirmationBudget = Math.max(
        MIN_CONFIRMATION_BUDGET_BLOCKS,
        depth * BLOCKS_PER_EXIT_LEVEL,
    );
    return confirmationBudget + Math.max(0, Math.floor(exitDeltaBlocks));
}

/** Bounds on the CLAIM fee rate, which is a different problem from the exit-tree
 *  CPFP rate the reserve is sized at.
 *
 *  The CPFP children are time-critical: the tree has to confirm before the
 *  capsule expires, so paying for speed there buys something real, out of the
 *  reserve. A claim is the opposite. It spends an output whose CSV has already
 *  matured, it races nothing, and its fee comes out of the claimed value. Worse,
 *  an over-priced claim does not fail slowly, it fails permanently: bark refuses
 *  to build a claim whose fee exceeds its output, and the drive rebuilds the
 *  same doomed claim forever. Observed live 2026-08-19 at 779 sats against a
 *  698 sat output, at a moment when the mempool wanted 1. */
const CLAIM_RATE_MIN = 1;
const CLAIM_RATE_MAX = 5;

/**
 * Claim rate to price the economic axis at, derived from the exit-tree rate.
 * Clamped, because triage that prices claims at the fastest rate would call a
 * healthy capsule unrecoverable during any fee spike.
 */
export function claimRateFromExitRate(feeRateSatPerVb: number): number {
    const rate = Math.ceil(Math.max(0, Number(feeRateSatPerVb) || 0));
    return Math.min(CLAIM_RATE_MAX, Math.max(CLAIM_RATE_MIN, rate));
}

// --- Triage ----------------------------------------------------------------

/**
 * Partition every capsule on the three axes of spec 4.2 and size the reserve to
 * what survives. Pure: no IO, no store reads, no SDK calls. The caller reads
 * `allVtxos()`, flattens, and threads through the cached chain tip and ArkInfo
 * deltas.
 */
export function triageArkExit(input: TriageArkExitInput): ExitTriageResult {
    const feeRate = Math.max(0, Number(input.feeRateSatPerVb) || 0);
    const claimRate =
        input.claimFeeRateSatPerVb == null
            ? claimRateFromExitRate(feeRate)
            : Math.max(0, Number(input.claimFeeRateSatPerVb) || 0);
    const policy: ExitEconomicPolicy = input.economicPolicy ?? 'default';

    const usedAssumedExitDelta =
        input.vtxoExitDeltaBlocks == null || !Number.isFinite(input.vtxoExitDeltaBlocks);
    const exitDelta = usedAssumedExitDelta
        ? ASSUMED_EXIT_DELTA_BLOCKS
        : Math.max(0, Math.floor(input.vtxoExitDeltaBlocks as number));

    const tip =
        typeof input.chainTipHeight === 'number' && Number.isFinite(input.chainTipHeight)
            ? Math.floor(input.chainTipHeight)
            : null;

    const maxDepth =
        typeof input.maxVtxoExitDepth === 'number' && input.maxVtxoExitDepth > 0
            ? input.maxVtxoExitDepth
            : null;

    const selected: ExitTriageEntry[] = [];
    const excluded: ExitTriageEntry[] = [];
    let skippedTerminalCount = 0;

    for (const v of input.vtxos ?? []) {
        const sats = Math.max(0, Math.floor(Number(v.sats) || 0));
        const perVb = perVtxoExitVb(v);
        const marginalClaimSats = Math.ceil(CLAIM_INPUT_VB * claimRate);
        const netRecoveredSats = sats - marginalClaimSats;
        const exitTreeCostSats = Math.ceil(perVb * feeRate);

        const notes: ExitTriageNote[] = [];
        if (maxDepth != null && v.exitDepth > maxDepth) notes.push('beyond-server-depth-cap');

        const blocksUntilExpiry =
            tip != null && v.expiryHeight > 0 ? v.expiryHeight - tip : null;
        const runway = requiredRunwayBlocks(v.exitDepth, exitDelta);

        const economic: ExitEconomicVerdict =
            netRecoveredSats <= 0
                ? 'uneconomic'
                : exitTreeCostSats <= netRecoveredSats
                  ? 'profitable'
                  : exitTreeCostSats <= netRecoveredSats * MAX_RESERVE_MULTIPLE
                    ? 'marginal'
                    : 'uneconomic';

        const base = {
            id: v.id,
            sats,
            exitDepth: Math.max(0, Math.floor(Number(v.exitDepth) || 0)),
            perVtxoVb: perVb,
            exitTreeCostSats,
            marginalClaimSats,
            netRecoveredSats,
            economic,
            blocksUntilExpiry,
            requiredRunwayBlocks: runway,
        };

        const exclude = (reason: ExitExclusionReason) => {
            excluded.push({ ...base, included: false, reason, notes });
        };

        // Structural. A terminal capsule holds nothing, so it is dropped before
        // triage rather than reported as an exclusion. It still matters: the
        // old reserve calc filtered only `spent`, so ten finished exits on the
        // measured wallet added 7,252 vB of demanded reserve for value already
        // sitting on-chain.
        if (TERMINAL_STATE_TAGS.has(String(v.stateTag ?? '').toLowerCase())) {
            skippedTerminalCount++;
            continue;
        }
        if (perVb <= 0 || (Number(v.exitTxWeightWu) <= 0 && Number(v.exitDepth) <= 0)) {
            exclude('no-exit-chain');
            continue;
        }

        // Temporal. A hard exclusion, not a warning: an exit that does not clear
        // its CSV before expiry loses the capsule AND the reserve spent on it.
        if (blocksUntilExpiry != null) {
            if (blocksUntilExpiry <= runway) {
                exclude('too-close-to-expiry');
                continue;
            }
        } else {
            // Unknown runway is not evidence of a problem, and refusing to exit
            // on a failed tip read would disarm the emergency button for a
            // network fault. Include and disclose.
            notes.push('expiry-unknown');
        }

        // Economic. The only axis the user can overrule, and even here a
        // capsule that cannot return anything at all is never included.
        if (netRecoveredSats <= 0) {
            exclude('returns-nothing');
            continue;
        }
        if (economic === 'uneconomic') {
            if (policy !== 'recover-everything') {
                exclude('reserve-dwarfs-value');
                continue;
            }
            notes.push('under-water');
        } else if (economic === 'marginal') {
            if (policy === 'profitable-only') {
                exclude('reserve-dwarfs-value');
                continue;
            }
            notes.push('under-water');
        }

        selected.push({ ...base, included: true, notes });
    }

    // Most net-recoverable first. If the reserve runs dry mid-exit the capsules
    // that got furthest are the ones worth the most, rather than whichever the
    // iterator happened to reach first.
    selected.sort((a, b) => b.netRecoveredSats - a.netRecoveredSats || a.id.localeCompare(b.id));
    excluded.sort((a, b) => b.sats - a.sats || a.id.localeCompare(b.id));

    const totalExitVb = selected.reduce((acc, e) => acc + e.perVtxoVb, 0);
    const reserveSats = reserveSatsForExitVb(totalExitVb, feeRate);
    const netRecoverableSats = selected.reduce((acc, e) => acc + e.netRecoveredSats, 0);
    const overridable = excluded.filter((e) => e.reason === 'reserve-dwarfs-value');

    return {
        selectedIds: selected.map((e) => e.id),
        selected,
        excluded,
        skippedTerminalCount,
        selectedSats: selected.reduce((acc, e) => acc + e.sats, 0),
        netRecoverableSats,
        excludedSats: excluded.reduce((acc, e) => acc + e.sats, 0),
        totalExitVb,
        reserveSats,
        underWaterCount: selected.filter((e) => e.economic !== 'profitable').length,
        netLossSats: Math.max(0, reserveSats - netRecoverableSats),
        overridableCount: overridable.length,
        overridableSats: overridable.reduce((acc, e) => acc + e.sats, 0),
        economicPolicy: policy,
        feeRateSatPerVb: feeRate,
        claimFeeRateSatPerVb: claimRate,
        usedAssumedExitDelta,
    };
}

/**
 * One-line reason text per exclusion, for the confirm dialog. Wording is the
 * product owner's to change; the contract this satisfies is that no capsule is
 * ever dropped without the user being told which one and why.
 */
export function describeExitExclusion(reason: ExitExclusionReason | undefined): string {
    switch (reason) {
        case 'no-exit-chain':
            return 'no exit chain available';
        case 'too-close-to-expiry':
            return 'too close to expiry to exit safely';
        case 'returns-nothing':
            return 'network fee is more than it holds';
        case 'reserve-dwarfs-value':
            return 'costs far more in fees than it holds';
        default:
            return 'cannot be exited';
    }
}
