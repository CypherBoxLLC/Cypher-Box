import { buildRefreshBatch, BatchVtxoInput } from '../../src/services/ark/refreshBatch';

// Per-input floor (ARK_REFRESH_MIN_SATS) and batch window (batchDays) are
// passed in by callers; hardcode representative values for the tests.
const MIN = 500;
const BATCH_DAYS = 14;

function v(
  partial: Partial<BatchVtxoInput> & { id: string; sats: number; daysLeft: number },
): BatchVtxoInput {
  return { pendingRound: false, unknownExpiry: false, ...partial };
}

describe('buildRefreshBatch: per-input floor', () => {
  it('batches near-expiry capsules at or above the floor', () => {
    const r = buildRefreshBatch({
      vtxos: [
        v({ id: 'a', sats: 500, daysLeft: 3 }),
        v({ id: 'b', sats: 10_000, daysLeft: 1 }),
      ],
      batchDays: BATCH_DAYS,
      minRefreshSats: MIN,
    });
    expect(r.ids).toEqual(['a', 'b']);
    expect(r.totalSats).toBe(10_500);
    expect(r.triggerCount).toBe(2);
    expect(r.strandedDustCount).toBe(0);
    expect(r.strandedDustSats).toBe(0);
  });

  it('strands near-expiry dust below the floor and never batches it', () => {
    const r = buildRefreshBatch({
      vtxos: [v({ id: 'dust', sats: 200, daysLeft: 2 })],
      batchDays: BATCH_DAYS,
      minRefreshSats: MIN,
    });
    expect(r.ids).toEqual([]);
    expect(r.strandedDustCount).toBe(1);
    expect(r.strandedDustSats).toBe(200);
  });

  it('refreshes the healthy ones and strands the dust in a mixed set (dust does not poison the batch)', () => {
    const r = buildRefreshBatch({
      vtxos: [
        v({ id: 'big', sats: 5_000, daysLeft: 2 }),
        v({ id: 'dust1', sats: 100, daysLeft: 2 }),
        v({ id: 'dust2', sats: 499, daysLeft: 1 }),
      ],
      batchDays: BATCH_DAYS,
      minRefreshSats: MIN,
    });
    expect(r.ids).toEqual(['big']);
    expect(r.totalSats).toBe(5_000);
    expect(r.strandedDustCount).toBe(2);
    expect(r.strandedDustSats).toBe(599);
  });

  it('leaves far-from-expiry capsules alone (no filler role)', () => {
    const r = buildRefreshBatch({
      vtxos: [
        v({ id: 'near', sats: 600, daysLeft: 3 }),
        v({ id: 'far', sats: 50_000, daysLeft: 25 }),
      ],
      batchDays: BATCH_DAYS,
      minRefreshSats: MIN,
    });
    expect(r.ids).toEqual(['near']);
    expect(r.triggerCount).toBe(1);
  });

  it('does not batch far-from-expiry dust, nor count it as stranded this cycle', () => {
    const r = buildRefreshBatch({
      vtxos: [v({ id: 'farDust', sats: 100, daysLeft: 25 })],
      batchDays: BATCH_DAYS,
      minRefreshSats: MIN,
    });
    expect(r.ids).toEqual([]);
    expect(r.strandedDustCount).toBe(0);
  });

  it('skips locked, deferred, expired, and unknown-expiry capsules', () => {
    const r = buildRefreshBatch({
      vtxos: [
        v({ id: 'locked', sats: 1_000, daysLeft: 2, pendingRound: true }),
        v({ id: 'unknown', sats: 1_000, daysLeft: 2, unknownExpiry: true }),
        v({ id: 'expired', sats: 1_000, daysLeft: 0 }),
        v({ id: 'deferred', sats: 1_000, daysLeft: 2 }),
        v({ id: 'ok', sats: 1_000, daysLeft: 2 }),
      ],
      deferredIds: new Set(['deferred']),
      batchDays: BATCH_DAYS,
      minRefreshSats: MIN,
    });
    expect(r.ids).toEqual(['ok']);
    expect(r.skippedPendingCount).toBe(1);
    expect(r.skippedDeferredCount).toBe(1);
  });

  it('returns an empty batch for empty input', () => {
    const r = buildRefreshBatch({ vtxos: [], batchDays: BATCH_DAYS, minRefreshSats: MIN });
    expect(r.ids).toEqual([]);
    expect(r.totalSats).toBe(0);
    expect(r.strandedDustCount).toBe(0);
  });
});
