import {
  ASSUMED_EXIT_DELTA_BLOCKS,
  claimRateFromExitRate,
  ExitTriageVtxo,
  RESERVE_FLOOR_SATS,
  perVtxoExitVb,
  requiredRunwayBlocks,
  reserveSatsForExitVb,
  triageArkExit,
} from '../../src/services/ark/exitTriage';

// Every capsule below is a real one, read off the QA wallet on 2026-08-20.
// Chain tip at the time of the snapshot was 963234 and the server reported
// vtxoExitDelta 144 / maxVtxoExitDepth 100.
//
// The whole point of the module is that a capsule's fate is decided by
// exitDepth and exitTxWeightWu, not by its sat value, so the fixtures keep the
// measured weights rather than rounding them.
const TIP = 963234;
const EXIT_DELTA = 144;

function v(p: Partial<ExitTriageVtxo> & { id: string; sats: number }): ExitTriageVtxo {
  return {
    exitDepth: 2,
    exitTxWeightWu: 1325,
    expiryHeight: 967241,
    stateTag: 'Spendable',
    registered: true,
    ...p,
  };
}

/** The eight live capsules, 4,990 sats total. */
const LIVE: ExitTriageVtxo[] = [
  v({ id: 'd4ec1101', sats: 700, exitDepth: 2, exitTxWeightWu: 1325, expiryHeight: 967253 }),
  v({ id: '1f6627c2', sats: 698, exitDepth: 2, exitTxWeightWu: 1325, expiryHeight: 967241 }),
  v({ id: '9211887d', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
  v({ id: 'a6e24d2f', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
  v({ id: 'bc672cb8', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
  v({ id: 'ec46d966', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
  // The two that must be discarded: unrefreshable dust on a 1.8-day fuse.
  v({ id: '095df741', sats: 400, exitDepth: 17, exitTxWeightWu: 12377, expiryHeight: 963502 }),
  v({ id: '54b52b50', sats: 400, exitDepth: 15, exitTxWeightWu: 11041, expiryHeight: 963502 }),
];

function triage(over: Partial<Parameters<typeof triageArkExit>[0]> = {}) {
  return triageArkExit({
    vtxos: LIVE,
    feeRateSatPerVb: 1,
    chainTipHeight: TIP,
    vtxoExitDeltaBlocks: EXIT_DELTA,
    maxVtxoExitDepth: 100,
    ...over,
  });
}

describe('perVtxoExitVb: measured cost model', () => {
  // If this drifts, every threshold in the module moves with it.
  it.each([
    ['700 @ depth 2', 2, 1325, 632],
    ['698 @ depth 3', 3, 2337, 1035],
    ['400 @ depth 15', 15, 11041, 5011],
    ['400 @ depth 17', 17, 12377, 5645],
  ])('%s costs %s vB', (_label, exitDepth, exitTxWeightWu, expected) => {
    expect(perVtxoExitVb({ exitDepth: exitDepth as number, exitTxWeightWu: exitTxWeightWu as number }))
      .toBe(expected);
  });

  it('falls back to a floor vsize when the SDK reports no exit weight', () => {
    expect(perVtxoExitVb({ exitDepth: 0, exitTxWeightWu: 0 })).toBe(200);
  });
});

describe('the exit set on the live wallet', () => {
  it('discards the two 400s and keeps the six healthy capsules', () => {
    const r = triage();
    expect(r.selectedIds).toHaveLength(6);
    expect(r.excluded.map((e) => e.id).sort()).toEqual(['095df741', '54b52b50']);
    expect(r.excludedSats).toBe(800);
    expect(r.selectedSats).toBe(4190);
  });

  it('sizes the reserve to the selected set, not the whole wallet', () => {
    const r = triage();
    // 632 + 632 + 1035*4 = 5,404 vB over the six, against 16,060 over all eight.
    expect(r.totalExitVb).toBe(5404);
    expect(r.reserveSats).toBe(10808);
  });

  it('costs the discarded dust at two thirds of the untriaged exit', () => {
    // The number that justifies the whole module: 10,656 of 16,060 vB, 66%,
    // for 800 of 4,990 sats, 16%.
    const r = triage();
    const dust = r.excluded.reduce((a, e) => a + e.perVtxoVb, 0);
    expect(dust).toBe(10656);
    expect(dust + r.totalExitVb).toBe(16060);
  });

  it('names every exclusion with an amount and a reason', () => {
    const r = triage();
    for (const e of r.excluded) {
      expect(e.sats).toBeGreaterThan(0);
      expect(e.reason).toBeTruthy();
    }
    expect(r.excluded.map((e) => e.reason)).toEqual([
      'reserve-dwarfs-value',
      'reserve-dwarfs-value',
    ]);
  });

  it('reports what actually lands, net of each capsule claim fee', () => {
    const r = triage();
    // Six capsules, 76 vB each at 1 sat/vB.
    expect(r.netRecoverableSats).toBe(4190 - 6 * 76);
  });
});

describe('the threshold is not a sat amount', () => {
  // This is the test that fails if anyone reintroduces a fixed dust floor.
  it('keeps a 400-sat capsule at depth 2 and drops a 400-sat capsule at depth 17', () => {
    const r = triageArkExit({
      vtxos: [
        v({ id: 'shallow-400', sats: 400, exitDepth: 2, exitTxWeightWu: 1325 }),
        v({ id: 'deep-400', sats: 400, exitDepth: 17, exitTxWeightWu: 12377 }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['shallow-400']);
    expect(r.excluded.map((e) => e.id)).toEqual(['deep-400']);
    // Same value, same refresh verdict (both below ARK_REFRESH_MIN_SATS),
    // opposite exit verdict, decided entirely by depth.
    expect(r.selected[0].perVtxoVb).toBe(632);
    expect(r.excluded[0].perVtxoVb).toBe(5645);
  });

  it('drops a large capsule whose tree is deep enough to outweigh it', () => {
    const r = triageArkExit({
      vtxos: [v({ id: 'deep-big', sats: 3000, exitDepth: 49, exitTxWeightWu: 24000 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    // 6000 vB chain + 7350 CPFP = 13,350 vB to return 2,924 sats.
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded[0].reason).toBe('reserve-dwarfs-value');
  });
});

describe('economic axis across the fee-rate matrix', () => {
  const capsule = (sats: number, exitDepth: number, exitTxWeightWu: number) =>
    v({ id: `c-${sats}-${exitDepth}`, sats, exitDepth, exitTxWeightWu });

  it('never calls a 698 at 1 sat/vB profitable', () => {
    const r = triageArkExit({
      vtxos: [capsule(698, 2, 1325)],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    // 632 sats of reserve to return 622. The cheapest fee market in years and
    // the best capsule in the wallet is still a fraction under water.
    expect(r.selected[0].economic).toBe('marginal');
    expect(r.selected[0].notes).toContain('under-water');
  });

  it.each([
    [1, 'marginal', true],
    [5, 'uneconomic', false],
    [20, 'uneconomic', false],
    [50, 'uneconomic', false],
  ])('at %s sat/vB a 698 @ depth 2 is %s', (rate, verdict, kept) => {
    const r = triageArkExit({
      vtxos: [capsule(698, 2, 1325)],
      feeRateSatPerVb: rate as number,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    const entry = [...r.selected, ...r.excluded][0];
    expect(entry.economic).toBe(verdict);
    expect(entry.included).toBe(kept);
  });

  // Positive control. Without this the suite would pass just as happily if the
  // module excluded everything at every rate.
  it.each([1, 5, 20, 50])(
    'at %s sat/vB a 50,000-sat capsule @ depth 2 exits and pays for itself',
    (rate) => {
      const r = triageArkExit({
        vtxos: [capsule(50_000, 2, 1325)],
        feeRateSatPerVb: rate as number,
        chainTipHeight: TIP,
        vtxoExitDeltaBlocks: EXIT_DELTA,
      });
      expect(r.selectedIds).toEqual(['c-50000-2']);
      expect(r.selected[0].economic).toBe('profitable');
      expect(r.selected[0].notes).not.toContain('under-water');
    },
  );

  it('drops the same 50,000-sat capsule once its tree is deep enough', () => {
    // Value alone never decides it. At 20 sat/vB a depth-49 tree costs 267,000
    // sats of reserve to return 48,480.
    const r = triageArkExit({
      vtxos: [capsule(50_000, 49, 24000)],
      feeRateSatPerVb: 20,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded[0].reason).toBe('reserve-dwarfs-value');
  });

  it('excludes a capsule its own claim fee would swallow, and says so', () => {
    const r = triageArkExit({
      vtxos: [capsule(400, 2, 1325)],
      feeRateSatPerVb: 20,
      claimFeeRateSatPerVb: 20,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    // 76 vB of claim at 20 sat/vB is 1,520 against a 400-sat capsule.
    expect(r.excluded[0].reason).toBe('returns-nothing');
    expect(r.excluded[0].netRecoveredSats).toBeLessThan(0);
  });

  it('prices the claim at the clamped rate the claim path actually pays', () => {
    // Pricing claims at the fastest rate would condemn capsules the claim path
    // recovers fine. The clamp is the same one that stopped bark rebuilding a
    // 779-sat claim against a 698-sat output forever.
    expect(claimRateFromExitRate(1)).toBe(1);
    expect(claimRateFromExitRate(3)).toBe(3);
    expect(claimRateFromExitRate(50)).toBe(5);

    const r = triageArkExit({
      vtxos: [capsule(400, 2, 1325)],
      feeRateSatPerVb: 20,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    // Same capsule, same fee spike, but the claim costs 380 rather than 1,520,
    // so it is dropped for consuming reserve, not for returning nothing.
    expect(r.excluded[0].marginalClaimSats).toBe(380);
    expect(r.excluded[0].reason).toBe('reserve-dwarfs-value');
  });

  it('keeps the two costs in separate pots', () => {
    const r = triageArkExit({
      vtxos: [capsule(698, 2, 1325)],
      feeRateSatPerVb: 1,
      claimFeeRateSatPerVb: 3,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    const e = r.selected[0];
    // Exit tree priced at the CPFP rate, claim priced at the claim rate.
    expect(e.exitTreeCostSats).toBe(632);
    expect(e.marginalClaimSats).toBe(228);
    expect(e.netRecoveredSats).toBe(470);
    // The reserve covers the exit tree only. The claim is never added to it.
    expect(r.reserveSats).toBe(RESERVE_FLOOR_SATS);
  });
});

describe('temporal axis', () => {
  it('excludes a capsule that cannot clear its CSV before expiry', () => {
    const r = triageArkExit({
      // Healthy value, shallow tree, but 40 blocks of runway against 144 of CSV.
      vtxos: [v({ id: 'fuse', sats: 20_000, expiryHeight: TIP + 40 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded[0].reason).toBe('too-close-to-expiry');
  });

  it('scales the confirmation budget with tree depth', () => {
    // Same expiry, same value; only the depth differs.
    const runway = TIP + 160;
    const r = triageArkExit({
      vtxos: [
        v({ id: 'shallow', sats: 20_000, exitDepth: 2, expiryHeight: runway }),
        v({ id: 'deep', sats: 20_000, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: runway }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(requiredRunwayBlocks(2, EXIT_DELTA)).toBe(156);
    expect(requiredRunwayBlocks(3, EXIT_DELTA)).toBe(162);
    expect(r.selectedIds).toEqual(['shallow']);
    expect(r.excluded[0].id).toBe('deep');
  });

  it('assumes the worst delta when ArkInfo was never cached, rather than skipping the check', () => {
    const near = v({ id: 'near', sats: 20_000, exitDepth: 2, expiryHeight: TIP + 200 });
    const cached = triageArkExit({
      vtxos: [near],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    const uncached = triageArkExit({
      vtxos: [near],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: null,
    });
    expect(cached.selectedIds).toEqual(['near']);
    expect(cached.usedAssumedExitDelta).toBe(false);
    // 200 blocks of runway clears 144 + 12 but not 288 + 12.
    expect(uncached.selectedIds).toEqual([]);
    expect(uncached.excluded[0].reason).toBe('too-close-to-expiry');
    expect(uncached.usedAssumedExitDelta).toBe(true);
    expect(ASSUMED_EXIT_DELTA_BLOCKS).toBeGreaterThan(EXIT_DELTA);
  });

  it('excludes the live 400s on runway alone once the delta is unknown', () => {
    const r = triage({ vtxoExitDeltaBlocks: null });
    const deep = r.excluded.find((e) => e.id === '095df741');
    expect(deep?.reason).toBe('too-close-to-expiry');
    expect(deep?.blocksUntilExpiry).toBe(268);
    expect(deep?.requiredRunwayBlocks).toBe(390);
  });

  it('still exits, with a disclosure, when the chain tip is unreadable', () => {
    // A failed tip read is a network fault, not evidence of a problem. Refusing
    // to exit on it would disarm the emergency button exactly when the network
    // is already misbehaving.
    const r = triage({ chainTipHeight: null });
    expect(r.selectedIds).toHaveLength(6);
    expect(r.selected[0].notes).toContain('expiry-unknown');
    expect(r.selected[0].blocksUntilExpiry).toBeNull();
  });
});

describe('structural axis', () => {
  it('exits unregistered capsules: registered is a mailbox flag, not exitability', () => {
    // Measured 2026-08-19: all 117 unregistered capsules carried a full exit
    // chain. Excluding them here would abandon arkoor change on every wallet.
    const r = triageArkExit({
      vtxos: [v({ id: 'unreg', sats: 20_000, registered: false })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['unreg']);
  });

  it('exits a capsule past the server exit-depth cap, and flags it', () => {
    // Past maxVtxoExitDepth the server refuses to cosign further arkoor spends,
    // so exit and refresh are the only moves left. That is a reason to exit it,
    // not a reason to abandon it.
    const r = triageArkExit({
      vtxos: [v({ id: 'capped', sats: 500_000, exitDepth: 101, exitTxWeightWu: 24000 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      maxVtxoExitDepth: 100,
    });
    expect(r.selectedIds).toEqual(['capped']);
    expect(r.selected[0].notes).toContain('beyond-server-depth-cap');
  });

  it('drops terminal capsules so finished exits stop inflating the reserve', () => {
    // bark keeps returning a completed exit as state Exited from allVtxos()
    // forever. The old reserve calc filtered only `spent`, so ten of these on
    // the measured wallet added 7,252 vB of demanded reserve for value that was
    // already on-chain.
    const r = triageArkExit({
      vtxos: [
        v({ id: 'live', sats: 20_000 }),
        v({ id: 'gone', sats: 22_001, exitDepth: 4, exitTxWeightWu: 2657, stateTag: 'Exited' }),
        v({ id: 'used', sats: 5000, stateTag: 'Spent' }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['live']);
    expect(r.totalExitVb).toBe(632);
    expect(r.skippedTerminalCount).toBe(2);
  });

  it('never lists terminal capsules as exclusions the user has to read', () => {
    // The measured wallet holds 178 Spent and 10 Exited against 8 live ones.
    // Putting those in the disclosure list would bury the two that matter.
    const history = Array.from({ length: 100 }, (_, i) =>
      v({ id: `old-${i}`, sats: 1000, stateTag: 'Spent' }),
    );
    const r = triageArkExit({
      vtxos: [...history, ...LIVE],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.skippedTerminalCount).toBe(100);
    expect(r.excluded).toHaveLength(2);
    expect(r.excludedSats).toBe(800);
  });

  it('drops a capsule the SDK reports no exit chain for', () => {
    const r = triageArkExit({
      vtxos: [v({ id: 'chainless', sats: 20_000, exitDepth: 0, exitTxWeightWu: 0 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.excluded[0].reason).toBe('no-exit-chain');
  });
});

describe('ordering under a constrained reserve', () => {
  it('orders the exit set by what each capsule actually returns, highest first', () => {
    // Deliberately fed smallest-first, so the assertion fails if the sort is
    // removed rather than passing on the input order by luck.
    const r = triageArkExit({
      vtxos: [
        v({ id: 'tiny', sats: 600 }),
        v({ id: 'mid', sats: 4_000 }),
        v({ id: 'huge', sats: 90_000 }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['huge', 'mid', 'tiny']);
    const net = r.selected.map((e) => e.netRecoveredSats);
    expect(net).toEqual([...net].sort((a, b) => b - a));
  });

  it('puts the largest live capsule first on the real wallet', () => {
    expect(triage().selectedIds[0]).toBe('d4ec1101');
  });

  it('orders exclusions largest first so disclosure leads with the biggest loss', () => {
    const r = triageArkExit({
      vtxos: [
        v({ id: 'small', sats: 300, exitDepth: 17, exitTxWeightWu: 12377 }),
        v({ id: 'large', sats: 900, exitDepth: 17, exitTxWeightWu: 12377 }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.excluded.map((e) => e.id)).toEqual(['large', 'small']);
  });
});

describe('reserve sizing', () => {
  it('reserves nothing when nothing is selected, rather than the floor', () => {
    const r = triageArkExit({
      vtxos: [v({ id: 'dust', sats: 400, exitDepth: 17, exitTxWeightWu: 12377 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual([]);
    expect(r.reserveSats).toBe(0);
  });

  it('applies the floor once there is something to exit', () => {
    expect(reserveSatsForExitVb(0, 1)).toBe(0);
    expect(reserveSatsForExitVb(100, 1)).toBe(RESERVE_FLOOR_SATS);
    expect(reserveSatsForExitVb(5404, 1)).toBe(10808);
  });

  it('scales the reserve with the fee rate', () => {
    expect(reserveSatsForExitVb(5404, 5)).toBe(54040);
  });
});

describe('marginal opt-out', () => {
  it('can be told to exit only capsules that pay for themselves', () => {
    const r = triage({ includeMarginal: false });
    // At 1 sat/vB nothing in this wallet clears its own reserve cost, which is
    // the finding, not a bug. Default-on is what keeps the exit useful.
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded).toHaveLength(8);
  });
});
