/**
 * Pure helper that builds the VTXO set to submit to an Ark refresh round.
 *
 * The ASP's "round minimum" gate operates on the AGGREGATE input value,
 * not per-input, so dust capsules CAN ride along in a round as long as
 * the batch as a whole clears the threshold. This helper encodes the
 * filler logic: gather everything imminent (including dust), and if the
 * total is below the round minimum, top up with the smallest non-dust
 * longer-expiry fillers until we clear it. If even all available fillers
 * leave us short, the batch is "stranded" — the caller surfaces that to
 * the user instead of submitting a round bark will reject.
 *
 * Used by the notification-tap auto-refresh path in
 * src/screens/Strike/CheckingAccountNew/ArkCapsules.tsx. The
 * background-refresh orchestrator at
 * src/services/ark/backgroundRefresh.ts has its own version of this
 * logic (it also has to consult cached chain tip, mid-round arkoor
 * deferrals, and a final-mile deferral re-check on top of categorisation
 * — too much extra to fold into a pure helper). Keep both call sites in
 * sync conceptually: same priority order, same dust handling, same
 * stranded-detection semantics.
 */

export interface BatchVtxoInput {
    id: string;
    sats: number;
    /** Days until expiry; <=0 means past-expiry (excluded from the batch). */
    daysLeft: number;
    /** When true the VTXO is mid-round (Locked); excluded from the batch. */
    pendingRound?: boolean;
    /** When true expiryHeight is 0 / chain tip unknown; excluded. */
    unknownExpiry?: boolean;
}

export interface BuildRefreshBatchInputs {
    /** All projected VTXO rows the screen knows about. */
    vtxos: ReadonlyArray<BatchVtxoInput>;
    /**
     * Ids the user has explicitly deferred via the Arkoor receive prompt
     * ("Use immediately") and shouldn't be auto-rolled into a refresh.
     * Pass undefined / empty Set when no deferral state applies.
     */
    deferredIds?: ReadonlySet<string>;
    /** Inclusive upper bound on daysLeft for the short-expiry trigger set. */
    batchDays: number;
    /** Round minimum the ASP rejects below (per the active config). */
    minBatchSats: number;
    /**
     * Dust threshold (per-VTXO). Below this a capsule can't sit alone in
     * a round but can ride along when the aggregate clears `minBatchSats`.
     */
    dustThresholdSats: number;
}

export interface BuildRefreshBatchResult {
    /** Ordered VTXO ids to submit. Empty when nothing imminent. */
    ids: string[];
    /** Aggregate input sats of the batch. */
    totalSats: number;
    /** How many non-dust longer-expiry VTXOs were added as fillers. */
    fillerCount: number;
    /** True when the imminent set is non-empty but aggregate < minBatchSats even with all fillers. */
    stranded: boolean;
    /** Number of imminent (within `batchDays`) VTXOs included in the batch. */
    triggerCount: number;
    /** Aggregate sats of just the imminent (non-filler) VTXOs in the batch. */
    triggerSats: number;
    /** How many candidates were skipped because they were Locked. */
    skippedPendingCount: number;
    /** How many candidates were skipped because the user deferred them. */
    skippedDeferredCount: number;
}

type Candidate = { id: string; sats: number; daysLeft: number };

/**
 * Build a refresh batch from the given VTXO inputs. Pure: no IO, no
 * store reads. Caller threads through deferred state + config constants.
 */
export function buildRefreshBatch(input: BuildRefreshBatchInputs): BuildRefreshBatchResult {
    const { vtxos, deferredIds, batchDays, minBatchSats, dustThresholdSats } = input;

    const shortExpiry: Candidate[] = [];
    const longExpiryNonDust: Candidate[] = [];
    let skippedPendingCount = 0;
    let skippedDeferredCount = 0;

    for (const v of vtxos) {
        if (v.pendingRound) {
            skippedPendingCount++;
            continue;
        }
        if (v.unknownExpiry) continue;
        if (v.daysLeft <= 0) continue;
        if (deferredIds && deferredIds.has(v.id)) {
            skippedDeferredCount++;
            continue;
        }
        const cand: Candidate = { id: v.id, sats: v.sats, daysLeft: v.daysLeft };
        if (v.daysLeft < batchDays) {
            shortExpiry.push(cand);
        } else if (v.sats > dustThresholdSats) {
            longExpiryNonDust.push(cand);
        }
    }

    const batch: Candidate[] = [...shortExpiry];
    const triggerCount = shortExpiry.length;
    const triggerSats = shortExpiry.reduce((a, c) => a + c.sats, 0);
    let totalSats = triggerSats;
    let fillerCount = 0;

    if (totalSats > 0 && totalSats < minBatchSats) {
        // Filler priority: soonest-to-expire first (more "expiry value"
        // per fee sat spent — a filler at 16d gains ~14 days from a
        // refresh, a filler at 30d gains ~0), then smallest sats within
        // the same tier (minimises the healthy capsule value dragged
        // into a dust-driven round).
        const fillers = [...longExpiryNonDust].sort((a, b) => {
            if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
            return a.sats - b.sats;
        });
        for (const f of fillers) {
            batch.push(f);
            totalSats += f.sats;
            fillerCount++;
            if (totalSats >= minBatchSats) break;
        }
    }

    const stranded = triggerCount > 0 && totalSats > 0 && totalSats < minBatchSats;

    return {
        ids: batch.map((c) => c.id),
        totalSats,
        fillerCount,
        stranded,
        triggerCount,
        triggerSats,
        skippedPendingCount,
        skippedDeferredCount,
    };
}
