/**
 * The exit claim sweep must batch, and must not wait forever.
 *
 * drainExits([]) already sweeps every claimable capsule into one transaction,
 * so the cost is per-claim, not per-capsule. Firing on the first ripe capsule
 * pays a separate fee for each one. Observed on a live five-capsule exit: 225
 * sats to move 877, four more queued behind it, on a fee wallet that had
 * already fallen from 3654 to 699 sats.
 *
 * The opposing risk is a wedged capsule holding healthy ones hostage forever,
 * which is why the wait is bounded.
 */

import { decideExitClaimBatch } from '../../src/services/ark/exitClaimBatch';

const HOUR = 60 * 60 * 1000;
const MAX_WAIT = 6 * HOUR;
const T0 = 1_700_000_000_000;

const decide = (over: Partial<Parameters<typeof decideExitClaimBatch>[0]> = {}) =>
    decideExitClaimBatch({
        claimableCount: 1,
        stillProgressingCount: 0,
        batchSince: null,
        now: T0,
        maxWaitMs: MAX_WAIT,
        ...over,
    });

describe('nothing to claim', () => {
    it('does not claim and clears the window', () => {
        const d = decide({ claimableCount: 0, batchSince: T0 - HOUR });
        expect(d.claim).toBe(false);
        expect(d.batchSince).toBeNull();
        expect(d.reason).toBe('nothing-claimable');
    });

    it('clears a stale window so the next batch starts fresh', () => {
        // Otherwise a capsule ripening tomorrow would inherit today's elapsed
        // time and skip batching entirely.
        expect(decide({ claimableCount: 0, batchSince: T0 - 5 * HOUR }).batchSince).toBeNull();
    });
});

describe('everything is ready', () => {
    it('claims immediately when no capsule is still progressing', () => {
        const d = decide({ claimableCount: 3, stillProgressingCount: 0 });
        expect(d.claim).toBe(true);
        expect(d.reason).toBe('all-ready');
    });

    it('claims a lone capsule when it is the whole exit', () => {
        // A one-capsule exit must not sit through the window for company that
        // is never coming.
        const d = decide({ claimableCount: 1, stillProgressingCount: 0 });
        expect(d.claim).toBe(true);
    });
});

describe('stragglers still progressing', () => {
    it('holds the claim and opens the window on first sight', () => {
        const d = decide({ claimableCount: 1, stillProgressingCount: 4, batchSince: null });
        expect(d.claim).toBe(false);
        expect(d.reason).toBe('waiting');
        expect(d.batchSince).toBe(T0);
    });

    it('keeps waiting inside the window', () => {
        const d = decide({
            claimableCount: 2,
            stillProgressingCount: 1,
            batchSince: T0 - 3 * HOUR,
            now: T0,
        });
        expect(d.claim).toBe(false);
        expect(d.batchSince).toBe(T0 - 3 * HOUR);
    });

    it('preserves the original window start rather than restarting the clock', () => {
        // Restarting on each tick would make the bound unreachable and the
        // straggler could stall the batch indefinitely.
        const since = T0 - 5 * HOUR;
        expect(decide({ stillProgressingCount: 2, batchSince: since }).batchSince).toBe(since);
    });

    it('gives up and claims once the window expires', () => {
        const d = decide({
            claimableCount: 1,
            stillProgressingCount: 3,
            batchSince: T0 - MAX_WAIT,
            now: T0,
        });
        expect(d.claim).toBe(true);
        expect(d.reason).toBe('window-expired');
    });

    it('claims at exactly the boundary, not a tick later', () => {
        expect(decide({ stillProgressingCount: 1, batchSince: T0 - MAX_WAIT }).claim).toBe(true);
        expect(decide({ stillProgressingCount: 1, batchSince: T0 - MAX_WAIT + 1 }).claim).toBe(false);
    });

    it('a wedged capsule cannot hold the others past the bound', () => {
        // The whole point of the ceiling: one leaf stuck forever must not mean
        // funds never sweep.
        const d = decide({
            claimableCount: 4,
            stillProgressingCount: 1,
            batchSince: T0 - 30 * HOUR,
            now: T0,
        });
        expect(d.claim).toBe(true);
    });
});

describe('the batch we actually lived through', () => {
    it('would have held the first capsule instead of paying five fees', () => {
        // Five-capsule exit, one ripe, four still working: the old code claimed
        // straight away.
        const d = decide({ claimableCount: 1, stillProgressingCount: 4, batchSince: null });
        expect(d.claim).toBe(false);
    });

    it('sweeps all five together once the last one ripens', () => {
        const d = decide({
            claimableCount: 5,
            stillProgressingCount: 0,
            batchSince: T0 - 2 * HOUR,
            now: T0,
        });
        expect(d.claim).toBe(true);
        expect(d.reason).toBe('all-ready');
    });
});

// --- Height-aware batching -------------------------------------------------
//
// The three capsules still in flight on the 2026-08-17/20 mainnet exit reported
// these ripening heights. The spread is what makes a wall-clock ceiling wrong.
const H = [963101, 963142, 963145];

describe('one exit, one UTXO: waiting on the schedule rather than a clock', () => {
  it('holds past the wall-clock ceiling while the tip has not reached the last height', () => {
    // 6h after the first capsule ripened the tip is ~36 blocks on, still 8
    // short of 963145. The old rule fired here and split the exit in two.
    const d = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 2,
      batchSince: T0,
      now: T0 + MAX_WAIT,
      maxWaitMs: MAX_WAIT,
      tipHeight: 963137,
      pendingClaimableHeights: [963142, 963145],
      unknownScheduleCount: 0,
    });
    expect(d.claim).toBe(false);
    expect(d.reason).toBe('waiting-for-schedule');
    expect(d.blocksUntilAllReady).toBe(8);
  });

  it('sweeps once the tip reaches the last scheduled height', () => {
    const d = decideExitClaimBatch({
      claimableCount: 3,
      stillProgressingCount: 0,
      batchSince: T0,
      now: T0 + 8 * 60 * 60 * 1000,
      maxWaitMs: MAX_WAIT,
      tipHeight: 963145,
      pendingClaimableHeights: [],
      unknownScheduleCount: 0,
    });
    expect(d.claim).toBe(true);
    expect(d.reason).toBe('all-ready');
  });

  it('reports blocks remaining so the wait can be shown honestly', () => {
    const d = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 2,
      batchSince: T0,
      now: T0 + 60_000,
      maxWaitMs: MAX_WAIT,
      tipHeight: H[0],
      pendingClaimableHeights: [H[1], H[2]],
      unknownScheduleCount: 0,
    });
    expect(d.blocksUntilAllReady).toBe(44);
  });

  it('still bounds the wait when a straggler has no known ripening height', () => {
    // Still Processing, so no leaf has confirmed and there is no schedule to
    // wait on. This is the case the wall-clock ceiling is actually for.
    const held = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 1,
      batchSince: T0,
      now: T0 + MAX_WAIT - 1,
      maxWaitMs: MAX_WAIT,
      tipHeight: 963137,
      pendingClaimableHeights: [],
      unknownScheduleCount: 1,
    });
    expect(held.claim).toBe(false);
    expect(held.reason).toBe('waiting');

    const expired = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 1,
      batchSince: T0,
      now: T0 + MAX_WAIT,
      maxWaitMs: MAX_WAIT,
      tipHeight: 963137,
      pendingClaimableHeights: [],
      unknownScheduleCount: 1,
    });
    expect(expired.claim).toBe(true);
    expect(expired.reason).toBe('window-expired');
  });

  it('does not wait on a schedule when one straggler of several is unscheduled', () => {
    // A known height for two of three proves nothing about the third.
    const d = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 3,
      batchSince: T0,
      now: T0 + MAX_WAIT,
      maxWaitMs: MAX_WAIT,
      tipHeight: 963137,
      pendingClaimableHeights: [963142, 963145],
      unknownScheduleCount: 1,
    });
    expect(d.claim).toBe(true);
    expect(d.reason).toBe('window-expired');
  });

  it('falls back to the clock when the chain tip is unreadable', () => {
    const d = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 2,
      batchSince: T0,
      now: T0 + MAX_WAIT,
      maxWaitMs: MAX_WAIT,
      tipHeight: null,
      pendingClaimableHeights: [963142, 963145],
      unknownScheduleCount: 0,
    });
    expect(d.claim).toBe(true);
    expect(d.reason).toBe('window-expired');
  });

  it('stops waiting on a schedule the tip has already passed', () => {
    // Heights reached but bark still does not call them claimable: they need
    // confirmations, or they are wedged. Bound it rather than hold forever.
    const d = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 1,
      batchSince: T0,
      now: T0 + MAX_WAIT,
      maxWaitMs: MAX_WAIT,
      tipHeight: 963200,
      pendingClaimableHeights: [963145],
      unknownScheduleCount: 0,
    });
    expect(d.claim).toBe(true);
    expect(d.reason).toBe('window-expired');
  });

  it('infers the unscheduled count when the caller does not pass one', () => {
    const d = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 2,
      batchSince: T0,
      now: T0 + 60_000,
      maxWaitMs: MAX_WAIT,
      tipHeight: 963137,
      pendingClaimableHeights: [963142, 963145],
    });
    expect(d.reason).toBe('waiting-for-schedule');
  });

  it('keeps the old behaviour when no schedule is supplied at all', () => {
    const d = decideExitClaimBatch({
      claimableCount: 1,
      stillProgressingCount: 1,
      batchSince: T0,
      now: T0 + 60_000,
      maxWaitMs: MAX_WAIT,
    });
    expect(d.claim).toBe(false);
    expect(d.reason).toBe('waiting');
  });
});
