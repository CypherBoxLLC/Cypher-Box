/**
 * Pure helper that builds the VTXO set to submit to an Ark refresh round.
 *
 * A VTXO can only join a round if its OWN value is at least the per-input
 * refresh minimum (`minRefreshSats`, currently ARK_REFRESH_MIN_SATS). The
 * ASP rejects the ENTIRE round with `BarkError.Internal` if any single
 * input is below it ("vtxo amount must be at least ... to participate in a
 * round"), the same way an expired input poisons a round. So a dust
 * capsule can NOT ride along on a batch of larger ones: including it makes
 * the whole round fail, healthy inputs and all. Sub-minimum capsules are
 * therefore excluded and reported as `strandedDust`; the caller nudges the
 * user to spend them (a normal payment folds them in via coin-selection)
 * before they expire.
 *
 * Only near-expiry (within `batchDays`) VTXOs are batched, a refresh costs
 * a fee and locks the input for the round, so healthy far-from-expiry
 * capsules are left alone.
 *
 * Used by the notification-tap auto-refresh path in
 * src/screens/Strike/CheckingAccountNew/ArkCapsules.tsx. The
 * background-refresh orchestrator at src/services/ark/backgroundRefresh.ts
 * has its own copy of this categorisation (it also consults cached chain
 * tip, mid-round arkoor deferrals, and a final-mile deferral re-check).
 * Keep both call sites in sync: same per-input floor, same stranded-dust
 * semantics.
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
    /**
     * Per-input floor. A VTXO whose OWN value is below this can't join a
     * round (the ASP rejects the whole round), so it is excluded and
     * reported as stranded dust rather than batched.
     */
    minRefreshSats: number;
}

export interface BuildRefreshBatchResult {
    /** Ordered VTXO ids to submit. Empty when nothing refreshable is imminent. */
    ids: string[];
    /** Aggregate input sats of the batch. */
    totalSats: number;
    /** Number of imminent (within `batchDays`) refreshable VTXOs in the batch. */
    triggerCount: number;
    /** Aggregate sats of the batched VTXOs (== totalSats; kept for symmetry). */
    triggerSats: number;
    /**
     * Imminent VTXOs excluded because their own value is below
     * `minRefreshSats` and they can't join a round. The caller surfaces
     * these so the user spends them before they expire.
     */
    strandedDustCount: number;
    /** Aggregate sats of the stranded (sub-minimum) imminent VTXOs. */
    strandedDustSats: number;
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
    const { vtxos, deferredIds, batchDays, minRefreshSats } = input;

    const batch: Candidate[] = [];
    let strandedDustCount = 0;
    let strandedDustSats = 0;
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
        // Only near-expiry VTXOs are worth the refresh fee + round lock.
        if (v.daysLeft >= batchDays) continue;
        // Per-input floor: a sub-minimum capsule can't join a round without
        // poisoning it (bark rejects the whole round), so strand it instead
        // of batching it. The user is nudged to spend it before expiry.
        if (v.sats < minRefreshSats) {
            strandedDustCount++;
            strandedDustSats += v.sats;
            continue;
        }
        batch.push({ id: v.id, sats: v.sats, daysLeft: v.daysLeft });
    }

    const totalSats = batch.reduce((a, c) => a + c.sats, 0);

    return {
        ids: batch.map((c) => c.id),
        totalSats,
        triggerCount: batch.length,
        triggerSats: totalSats,
        strandedDustCount,
        strandedDustSats,
        skippedPendingCount,
        skippedDeferredCount,
    };
}
