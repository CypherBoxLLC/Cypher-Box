import {
  summariseExitPhase,
  approxDuration,
  type ExitPhaseInput,
} from '../../src/services/ark/exitPhaseSummary';

const TIP = 963_500;
const base: ExitPhaseInput = {
  claimableCount: 0,
  awaitingHeights: [],
  processingCount: 0,
  tipHeight: TIP,
  blockMinutes: 10,
};
const at = (o: Partial<ExitPhaseInput>) => summariseExitPhase({ ...base, ...o });

describe('which phase the exit is in', () => {
  // The defect: one sentence for the entire two-day run, so a stalled exit and
  // a working one looked identical.

  it('publishing while any capsule still needs a broadcast', () => {
    const r = at({ processingCount: 2 });
    expect(r.phase).toBe('publishing');
    expect(r.headline).toContain('2 capsules');
  });

  it('waiting once every capsule is out of the app\'s hands', () => {
    const r = at({ awaitingHeights: [963_600, 963_652] });
    expect(r.phase).toBe('waiting');
  });

  it('ready as soon as anything is collectable', () => {
    const r = at({ claimableCount: 1 });
    expect(r.phase).toBe('ready');
  });

  it('ranks ready above everything still in flight behind it', () => {
    // Something can be collected NOW, which is true whatever else is pending.
    expect(at({ claimableCount: 1, processingCount: 3, awaitingHeights: [963_600] }).phase)
      .toBe('ready');
  });

  it('ranks publishing above waiting, because the app is load-bearing there', () => {
    // If ANY capsule still needs a broadcast, the copy must not release the
    // user. Getting this order wrong tells someone to close the app during the
    // one phase that stops without them.
    const r = at({ processingCount: 1, awaitingHeights: [963_600, 963_652] });
    expect(r.phase).toBe('publishing');
    expect(`${r.headline} ${r.detail}`).toContain('Keep the app open');
  });

  it('says it is checking rather than guessing when it knows nothing yet', () => {
    expect(at({}).phase).toBe('settling');
  });
});

describe('the countdown: blocks are the truth, time is the estimate', () => {
  it('counts to the LAST capsule, which is what the claim batches on', () => {
    // The sweep holds for the stragglers so the exit lands as one payment, so
    // the figure shown must be the figure actually being waited for.
    const r = at({ awaitingHeights: [963_534, 963_599, 963_652] });
    expect(r.targetHeight).toBe(963_652);
    expect(r.blocksRemaining).toBe(152);
  });

  it('leads with blocks and follows with an approximation', () => {
    const r = at({ awaitingHeights: [TIP + 6] });
    expect(r.detail).toContain('6 blocks to go');
    expect(r.detail).toContain('about 60 min');
  });

  it('never shows seconds, at any distance', () => {
    // Block intervals are exponential: a seconds countdown stalls and then
    // jumps, including backwards, and reads as a broken timer.
    for (const blocks of [1, 6, 20, 144, 1000]) {
      expect(approxDuration(blocks, 10)).not.toMatch(/\bsec|\d+:\d\d/);
    }
  });

  it('hedges every duration it prints', () => {
    for (const blocks of [1, 6, 144, 4032]) {
      expect(approxDuration(blocks, 10)).toMatch(/about|under/);
    }
  });

  it('coarsens as the distance grows', () => {
    expect(approxDuration(6, 10)).toBe('about 60 min');
    expect(approxDuration(144, 10)).toBe('about 24 hours');
    expect(approxDuration(4032, 10)).toBe('about 28 days');
  });

  it('never counts below zero once the tip has crossed', () => {
    const r = at({ awaitingHeights: [TIP - 20] });
    expect(r.blocksRemaining).toBe(0);
    expect(r.detail).toContain('timelock has passed');
  });

  it('withholds a figure while anything is still broadcasting', () => {
    // A capsule with no ripening height yet can push the finish line out when
    // its leaf confirms, so any number here would be a floor shown as an
    // answer. Observed live: a late leaf moved the batch from 963599 to 963652.
    const r = at({ processingCount: 1, awaitingHeights: [963_600] });
    expect(r.blocksRemaining).toBeNull();
    expect(r.targetHeight).toBeNull();
  });

  it('names the remedy instead of the internal state when no tip is known', () => {
    const r = at({ awaitingHeights: [963_652], tipHeight: null });
    expect(r.blocksRemaining).toBeNull();
    expect(r.detail).toContain('cellular');
  });

  it('ignores a missing or zero ripening height rather than counting from it', () => {
    const r = at({ awaitingHeights: [0, 963_652, Number.NaN] });
    expect(r.targetHeight).toBe(963_652);
  });
});

describe('copy contract', () => {
  const all = [
    at({ processingCount: 2 }),
    at({ processingCount: 1, awaitingHeights: [963_600] }),
    at({ awaitingHeights: [963_652] }),
    at({ awaitingHeights: [963_652], tipHeight: null }),
    at({ awaitingHeights: [TIP - 5] }),
    at({ claimableCount: 2 }),
    at({ claimableCount: 1, processingCount: 2 }),
    at({}),
  ];

  it('never promises the exit finishes by itself', () => {
    // The drive is foreground-only. The countdown ends at "ready to collect",
    // never at "done". This is the sentence class that made #196 a bug.
    for (const r of all) {
      const text = `${r.headline} ${r.detail ?? ''}`.toLowerCase();
      expect(text).not.toMatch(/automatic|by itself|on its own|sweeps? automatically/);
    }
  });

  it('releases the user only once the chain is doing the work', () => {
    // Safe to leave ONLY when every capsule is waiting out its CSV.
    expect(at({ awaitingHeights: [963_652] }).detail).toContain('close the app');
    for (const r of [at({ processingCount: 1 }), at({ claimableCount: 1 })]) {
      expect(`${r.headline} ${r.detail ?? ''}`).not.toContain('close the app');
    }
  });

  it('uses no em dashes anywhere', () => {
    for (const r of all) {
      expect(r.headline).not.toContain('—');
      expect(r.detail ?? '').not.toContain('—');
    }
  });

  it('always gives the user a headline', () => {
    for (const r of all) expect(r.headline.length).toBeGreaterThan(0);
  });

  it('agrees with itself on singular and plural', () => {
    expect(at({ processingCount: 1 }).headline).toContain('1 capsule.');
    expect(at({ processingCount: 3 }).headline).toContain('3 capsules');
    expect(at({ awaitingHeights: [TIP + 1] }).detail).toContain('1 block to go');
    expect(at({ awaitingHeights: [TIP + 2] }).detail).toContain('2 blocks to go');
  });
});

describe('broadcast sub-progress, so a slow phase is not mistaken for a stalled one', () => {
  // Live 2026-08-28: three capsules went AwaitingCpfpBroadcast -> confirmed
  // shared parent -> one published and awaiting a block, over an hour, and the
  // panel printed the same sentence the whole time. Every level has to confirm
  // before the next can be relayed, so the phase legitimately does not move.

  it('reports how many transactions are published', () => {
    const r = at({ processingCount: 3, txAwaitingBroadcast: 2, txAwaitingConfirmation: 1 });
    expect(r.phase).toBe('publishing');
    expect(r.detail).toContain('1 of 3 published');
  });

  it('moves as each one goes out, which is the whole point', () => {
    const a = at({ processingCount: 3, txAwaitingBroadcast: 3, txAwaitingConfirmation: 0 });
    const b = at({ processingCount: 3, txAwaitingBroadcast: 1, txAwaitingConfirmation: 2 });
    expect(a.detail).toContain('0 of 3 published');
    expect(b.detail).toContain('2 of 3 published');
    expect(a.detail).not.toBe(b.detail);
  });

  it('still explains the slowness, so the user knows it is expected', () => {
    const r = at({ processingCount: 2, txAwaitingBroadcast: 1, txAwaitingConfirmation: 1 });
    expect(r.detail).toContain('confirmation before the next');
    expect(r.detail).toContain('Keep the app open');
  });

  it('mentions capsules already through to the timelock', () => {
    const r = at({ processingCount: 3, txAwaitingBroadcast: 2, txAwaitingConfirmation: 1, awaitingHeights: [963_652] });
    expect(r.detail).toContain('1 capsule is already through');
  });

  it('omits the count rather than printing 0 of 0 when the SDK gave nothing', () => {
    // Older records, or a tick that returned no transaction list.
    const r = at({ processingCount: 2 });
    expect(r.detail).not.toContain('of 0');
    expect(r.detail).toContain('Keep the app open');
  });

  it('never claims more published than exist', () => {
    for (const [b, c] of [[0, 0], [5, 0], [0, 5], [2, 3]]) {
      const r = at({ processingCount: 1, txAwaitingBroadcast: b, txAwaitingConfirmation: c });
      const m = r.detail?.match(/(\d+) of (\d+) published/);
      if (m) expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2]));
    }
  });

  it('keeps the copy contract: no em dash, no promise it finishes alone', () => {
    const r = at({ processingCount: 3, txAwaitingBroadcast: 2, txAwaitingConfirmation: 1 });
    expect(r.detail).not.toContain('\u2014');
    expect(`${r.headline} ${r.detail}`.toLowerCase()).not.toMatch(/automatic|by itself|on its own/);
  });
});
