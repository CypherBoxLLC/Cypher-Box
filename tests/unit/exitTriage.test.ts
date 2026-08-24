import {
  ASSUMED_EXIT_DELTA_BLOCKS,
  EXIT_FEE_FALLBACK_RATES,
  MIN_FRESHNESS_BLOCKS,
  claimRateFromExitRate,
  exitFeeUrgency,
  normaliseExitFeeRates,
  ratesFromEsploraEstimates,
  ratesFromMempoolRecommended,
  URGENCY_SOON_BLOCKS,
  ExitTriageVtxo,
  ExitTriageNote,
  describeExitNote,
  RESERVE_FLOOR_SATS,
  perVtxoExitVb,
  requiredRunwayBlocks,
  reserveSatsForExitVb,
  triageArkExit,
  urgencyFromSlackBlocks,
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
    // recover-everything to get past the 4-day freshness floor: what is under
    // test here is the runway, and a capsule this close to expiry only reaches
    // the exit set when the user has explicitly forced it.
    const r = triageArkExit({
      vtxos: [
        v({ id: 'shallow', sats: 20_000, exitDepth: 2, expiryHeight: runway }),
        v({ id: 'deep', sats: 20_000, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: runway }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
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
     economicPolicy: 'recover-everything',
    });
    const uncached = triageArkExit({
      vtxos: [near],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: null,
     economicPolicy: 'recover-everything',
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

describe('economic policy: how far past the economics the user may go', () => {
  it('profitable-only exits nothing in this wallet, which is the finding, not a bug', () => {
    const r = triage({ economicPolicy: 'profitable-only' });
    // At 1 sat/vB nothing here clears its own reserve cost. Defaulting to
    // 'default' rather than this is what keeps the exit useful at all.
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded).toHaveLength(8);
  });

  it('recover-everything brings back the capsules excluded on the ratio', () => {
    // Spec principle 4: the user may knowingly spend more than the funds are
    // worth, for instance to deny a hostile server a hostage.
    const forced = triage({ economicPolicy: 'recover-everything' });
    expect(forced.selectedIds).toHaveLength(8);
    expect(forced.excluded).toHaveLength(0);
    expect(forced.totalExitVb).toBe(16060);
    expect(forced.reserveSats).toBe(32120);
  });

  it('offers the override only when it would change something', () => {
    const d = triage();
    expect(d.overridableCount).toBe(2);
    expect(d.overridableSats).toBe(800);
    // Nothing left to force once it has been applied.
    expect(triage({ economicPolicy: 'recover-everything' }).overridableCount).toBe(0);
  });

  it('states the loss the override accepts, priced on spend not reserve', () => {
    const forced = triage({ economicPolicy: 'recover-everything' });
    expect(forced.netRecoverableSats).toBe(4990 - 8 * 76);
    // The loss is what the exit is expected to SPEND beyond what it returns.
    // Pricing it against reserveSats instead would charge the user for the
    // spike headroom and the floor, neither of which anyone expects to pay.
    expect(forced.expectedSpendSats).toBe(16060);
    expect(forced.netLossSats).toBe(16060 - (4990 - 8 * 76));
    expect(forced.netLossSats).toBeLessThan(forced.reserveSats - forced.netRecoverableSats);
    expect(forced.underWaterCount).toBe(8);
  });

  it('keeps the reserve requirement and the expected spend apart', () => {
    const forced = triage({ economicPolicy: 'recover-everything' });
    // reserveSats carries SPIKE_MULT on top of the same vsize, so it is
    // strictly the larger of the two and must never be quoted as the cost.
    expect(forced.reserveSats).toBe(32120);
    expect(forced.expectedSpendSats).toBe(forced.totalExitVb * forced.feeRateSatPerVb);
    expect(forced.reserveSats).toBeGreaterThan(forced.expectedSpendSats);
  });

  it('does not call a single small capsule a 4,105 sat loss', () => {
    // The live case from the device: one 971 sat capsule at depth 2, 1 sat/vB.
    // reserveSats is 5,000 because of the floor, so the old reserve-priced
    // model reported a 4,105 sat loss on an exit whose expected spend was 632
    // against 895 recovered. It is mildly PROFITABLE, and the copy said the
    // opposite.
    const r = triageArkExit({
      vtxos: [v({ id: 'live', sats: 971, exitDepth: 2, exitTxWeightWu: 1325 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['live']);
    expect(r.netRecoverableSats).toBe(971 - 76);
    expect(r.reserveSats).toBe(5000);
    expect(r.expectedSpendSats).toBe(632);
    expect(r.netLossSats).toBe(0);
  });

  it('includes a capsule whose runway it cannot check, and flags it', () => {
    // A network fault must not disarm the emergency button, so an unknown tip
    // includes rather than excludes. That is only defensible if it is
    // disclosed, which is what runwayUnverifiedCount exists for: before it, the
    // expiry-unknown note was computed on every entry and read by nothing.
    const offline = triageArkExit({
      vtxos: [v({ id: 'live', sats: 971, exitDepth: 2, exitTxWeightWu: 1325 })],
      feeRateSatPerVb: 1,
      chainTipHeight: null,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(offline.selectedIds).toEqual(['live']);
    expect(offline.runwayUnverifiedCount).toBe(1);
    expect(offline.selected[0].notes).toContain('expiry-unknown');
    expect(offline.selected[0].blocksUntilExpiry).toBeNull();
  });

  it('does not flag runway when the tip is usable', () => {
    const online = triageArkExit({
      vtxos: [v({ id: 'live', sats: 971, exitDepth: 2, exitTxWeightWu: 1325 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(online.runwayUnverifiedCount).toBe(0);
    expect(online.selected[0].notes).not.toContain('expiry-unknown');
  });

  it('loses the temporal exclusion entirely without a tip, which is why it must disclose', () => {
    // Same capsule, one block from expiry. With a tip it is a HARD exclusion,
    // because an exit that does not clear its CSV loses the capsule and the
    // reserve. Without one it sails through, so the disclosure is the only
    // thing standing between the user and that trade.
    const doomed = v({ id: 'doomed', sats: 971, exitDepth: 2, exitTxWeightWu: 1325, expiryHeight: TIP + 1 });
    const withTip = triageArkExit({
      vtxos: [doomed], feeRateSatPerVb: 1, chainTipHeight: TIP, vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(withTip.selectedIds).toEqual([]);
    expect(withTip.excluded[0].reason).toBe('too-close-to-expiry');

    const withoutTip = triageArkExit({
      vtxos: [doomed], feeRateSatPerVb: 1, chainTipHeight: null, vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(withoutTip.selectedIds).toEqual(['doomed']);
    expect(withoutTip.runwayUnverifiedCount).toBe(1);
  });

  it('describes every note, so none can be added and left invisible', () => {
    const notes: ExitTriageNote[] = ['expiry-unknown', 'beyond-server-depth-cap', 'under-water'];
    for (const n of notes) {
      const text = describeExitNote(n);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe('see details');
    }
  });

  it('derives the collect-at runway instead of assuming ~24h', () => {
    // Confirmation budget (depth x 6, floored at 6) plus the CSV delta. A
    // deeper capsule needs more confirmations before its CSV even starts, so a
    // hardcoded 24h understates exactly where it matters most.
    const shallow = triageArkExit({
      vtxos: [v({ id: 'd2', sats: 971, exitDepth: 2, exitTxWeightWu: 1325 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: 144,
    });
    expect(shallow.collectableInBlocks).toBe(12 + 144);

    const deep = triageArkExit({
      vtxos: [v({ id: 'd9', sats: 500_000, exitDepth: 9, exitTxWeightWu: 1325 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: 144,
    });
    expect(deep.collectableInBlocks).toBe(54 + 144);
    expect(deep.collectableInBlocks).toBeGreaterThan(shallow.collectableInBlocks);
  });

  it('paces the collect-at off the SLOWEST selected capsule', () => {
    const mixed = triageArkExit({
      vtxos: [
        v({ id: 'shallow', sats: 500_000, exitDepth: 2, exitTxWeightWu: 1325 }),
        v({ id: 'deep', sats: 500_000, exitDepth: 9, exitTxWeightWu: 1325 }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: 144,
    });
    expect(mixed.selectedIds).toHaveLength(2);
    expect(mixed.collectableInBlocks).toBe(54 + 144);
  });

  it('reports no loss when the selected set actually pays for itself', () => {
    const r = triageArkExit({
      vtxos: [v({ id: 'big', sats: 500_000 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selected[0].economic).toBe('profitable');
    expect(r.netLossSats).toBe(0);
    expect(r.underWaterCount).toBe(0);
  });

  it('NEVER forces in a capsule that cannot return anything at any price', () => {
    // bark refuses to build a claim whose fee exceeds its output and the drive
    // rebuilds that same doomed claim forever, so this is not a trade the user
    // could want: it wedges the batch and rescues nothing.
    const r = triageArkExit({
      vtxos: [
        v({ id: 'hopeless', sats: 200 }),
        v({ id: 'forceable', sats: 400, exitDepth: 17, exitTxWeightWu: 12377 }),
      ],
      feeRateSatPerVb: 5,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toEqual(['forceable']);
    expect(r.excluded.map((e) => e.reason)).toEqual(['returns-nothing']);
  });

  it('NEVER forces past the expiry runway, whatever the policy', () => {
    // Overriding this does not cost the user money to rescue funds, it loses
    // the capsule AND the reserve when the server sweeps it mid-exit.
    const r = triageArkExit({
      vtxos: [v({ id: 'fuse', sats: 20_000, expiryHeight: TIP + 40 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded[0].reason).toBe('too-close-to-expiry');
  });

  it('NEVER forces in a structurally unexitable capsule', () => {
    const r = triageArkExit({
      vtxos: [
        v({ id: 'chainless', sats: 20_000, exitDepth: 0, exitTxWeightWu: 0 }),
        v({ id: 'gone', sats: 9000, stateTag: 'Exited' }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded.map((e) => e.reason)).toEqual(['no-exit-chain']);
    expect(r.skippedTerminalCount).toBe(1);
  });

  it('reproduces the live 7 sat/vB wall and the way through it', () => {
    // Measured on device 2026-08-20: mempool fastestFee 7, all seven capsules
    // excluded, so Emergency Exit refuses. The override is what lets a user
    // proceed anyway, with the cost stated.
    const live = [
      v({ id: 'aa2c257e', sats: 800, exitDepth: 2, exitTxWeightWu: 1325, expiryHeight: 967351 }),
      v({ id: 'd4ec1101', sats: 700, exitDepth: 2, exitTxWeightWu: 1325, expiryHeight: 967253 }),
      v({ id: '1f6627c2', sats: 698, exitDepth: 2, exitTxWeightWu: 1325, expiryHeight: 967241 }),
      v({ id: '9211887d', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
      v({ id: 'a6e24d2f', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
      v({ id: 'bc672cb8', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
      v({ id: 'ec46d966', sats: 698, exitDepth: 3, exitTxWeightWu: 2337, expiryHeight: 967241 }),
    ];
    const at7 = { vtxos: live, feeRateSatPerVb: 7, chainTipHeight: 963334, vtxoExitDeltaBlocks: 144 };

    const blocked = triageArkExit(at7);
    expect(blocked.selectedIds).toEqual([]);
    expect(blocked.excludedSats).toBe(4990);
    expect(blocked.overridableCount).toBe(7);

    const forced = triageArkExit({ ...at7, economicPolicy: 'recover-everything' });
    expect(forced.selectedIds).toHaveLength(7);
    expect(forced.totalExitVb).toBe(6036);
    expect(forced.reserveSats).toBe(84504);
    // 84,504 sats of reserve to recover 2,330. The user has to see that.
    expect(forced.netRecoverableSats).toBe(2330);
    // Expected spend is the same vsize at the bare rate; the reserve doubles it
    // for spike cover. The loss the user is accepting is the former.
    expect(forced.expectedSpendSats).toBe(6036 * 7);
    expect(forced.netLossSats).toBe(6036 * 7 - 2330);
  });
});

describe('exit-tree pricing: how much of a hurry the tree is actually in', () => {
  it('reads the live wallet as relaxed, not urgent', () => {
    // The mistake this replaces: the app priced these at a fastestFee of 7 when
    // the exit set sat ~3,800 blocks clear of the runway it needed, about 26
    // days. That is a 3.5x over-demand for urgency that did not exist.
    const u = exitFeeUrgency(triage().selected);
    expect(u.urgency).toBe('relaxed');
    // Tightest of the six selected is a depth-3 at 967241: 4007 - 162 = 3845.
    expect(u.tightestSlackBlocks).toBe(3845);
    expect(u.deadlineHeight).toBe(967241 - 162);
    expect(u.consideredCount).toBe(6);
  });

  it('does not let capsules the exit is abandoning decide what it pays', () => {
    // This is why urgency reads the SELECTED set and not the candidates. The
    // two 400s are 22 and 34 blocks off their runway, so pricing the candidate
    // list called the whole exit urgent on behalf of two capsules that were
    // never going to be exited.
    const plan = triage();
    const dust = plan.excluded.map((e) => e.blocksUntilExpiry! - e.requiredRunwayBlocks);
    expect(Math.min(...dust)).toBeLessThan(URGENCY_SOON_BLOCKS);
    expect(exitFeeUrgency([...plan.selected, ...plan.excluded]).urgency).toBe('urgent');
    expect(exitFeeUrgency(plan.selected).urgency).toBe('relaxed');
  });

  it.each([
    [5000, 'relaxed'],
    [1008, 'relaxed'],
    [1007, 'moderate'],
    [288, 'moderate'],
    [287, 'soon'],
    [144, 'soon'],
    [143, 'urgent'],
    [1, 'urgent'],
  ])('%s blocks of slack is %s', (slack, band) => {
    expect(urgencyFromSlackBlocks(slack as number)).toBe(band);
    // And end to end, through a real triage at a rate that keeps it selected.
    const r = triageArkExit({
      vtxos: [v({ id: 'x', sats: 200_000, expiryHeight: TIP + 156 + (slack as number) })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toEqual(['x']);
    expect(exitFeeUrgency(r.selected).urgency).toBe(band);
  });

  it('bids as if urgent when the chain tip is unreadable', () => {
    // Over-reserving parks sats the user still owns. Under-reserving stalls the
    // exit and can cost the capsule. Unknown resolves toward paying more.
    const u = exitFeeUrgency(triage({ chainTipHeight: null }).selected);
    expect(u.urgency).toBe('urgent');
    expect(u.tightestSlackBlocks).toBeNull();
    expect(u.deadlineHeight).toBeNull();
    expect(urgencyFromSlackBlocks(null)).toBe('urgent');
  });

  it('bids as if urgent when nothing was selected', () => {
    expect(exitFeeUrgency([]).urgency).toBe('urgent');
    expect(exitFeeUrgency(triage({ economicPolicy: 'profitable-only' }).selected).urgency)
      .toBe('urgent');
  });

  it('prices off the tightest member, not the average', () => {
    const r = triageArkExit({
      vtxos: [
        v({ id: 'roomy', sats: 200_000, expiryHeight: TIP + 9000 }),
        v({ id: 'tight', sats: 200_000, expiryHeight: TIP + 156 + 200 }),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toHaveLength(2);
    expect(exitFeeUrgency(r.selected).urgency).toBe('soon');
  });

  it('climbs the bands on its own as an exit runs and the runway shrinks', () => {
    // The drive re-derives from the persisted deadline against the live tip, so
    // a capsule drifting toward expiry starts bidding harder with nobody
    // recomputing a plan.
    const deadline = TIP + 1200;
    expect(urgencyFromSlackBlocks(deadline - TIP)).toBe('relaxed');
    expect(urgencyFromSlackBlocks(deadline - (TIP + 300))).toBe('moderate');
    expect(urgencyFromSlackBlocks(deadline - (TIP + 1000))).toBe('soon');
    expect(urgencyFromSlackBlocks(deadline - (TIP + 1100))).toBe('urgent');
  });

  it('gives the drive a deadline that stays fixed as the chain advances', () => {
    const u = exitFeeUrgency(triage().selected);
    // Persisting the deadline rather than the band is what keeps it honest over
    // a multi-day exit: slack recomputed against a later tip is smaller.
    expect(u.deadlineHeight! - TIP).toBe(u.tightestSlackBlocks);
    expect(u.deadlineHeight! - (TIP + 3000)).toBe(845);
    expect(urgencyFromSlackBlocks(u.deadlineHeight! - (TIP + 3000))).toBe('moderate');
  });
});

describe('fee sources: what happens when the market cannot be read', () => {
  it('maps mempool.space named tiers onto the bands', () => {
    const r = ratesFromMempoolRecommended({
      fastestFee: 7, halfHourFee: 6, hourFee: 5, economyFee: 2, minimumFee: 1,
    })!;
    expect(r).toEqual({ relaxed: 2, moderate: 5, soon: 6, urgent: 7 });
  });

  it('maps an esplora fee-estimates map onto the bands', () => {
    // Real shape, read off blockstream 2026-08-20.
    const r = ratesFromEsploraEstimates({
      '1': 5.2, '2': 4.586, '3': 4.3, '4': 4.178, '6': 3.9, '8': 3.285,
      '10': 1.069, '15': 1.003, '144': 1.001, '504': 1.0,
    })!;
    // relaxed asks for target 144, urgent for target 1.
    expect(r.relaxed).toBe(2);
    expect(r.urgent).toBe(6);
    expect(r.relaxed).toBeLessThanOrEqual(r.urgent);
  });

  it('rounds a missing esplora target DOWN, which rounds the fee up', () => {
    // Longer targets are cheaper, so falling back to a shorter one is the safe
    // direction when the exact target is absent.
    const r = ratesFromEsploraEstimates({ '1': 20, '6': 9, '25': 3 })!;
    // relaxed wants 144, the longest available is 25.
    expect(r.relaxed).toBe(3);
    expect(r.moderate).toBe(9);
    expect(r.urgent).toBe(20);
  });

  it('never lets a cheaper band cost more than a dearer one', () => {
    // An inverted table would have a RELAXED exit outbidding an urgent one,
    // which is the exact failure this path exists to prevent.
    const r = normaliseExitFeeRates({ relaxed: 50, moderate: 4, soon: 3, urgent: 2 })!;
    expect(r).toEqual({ relaxed: 2, moderate: 2, soon: 2, urgent: 2 });
    expect(r.relaxed).toBeLessThanOrEqual(r.moderate);
    expect(r.moderate).toBeLessThanOrEqual(r.soon);
    expect(r.soon).toBeLessThanOrEqual(r.urgent);
  });

  it('fills a missing band from the dearer neighbour, not the cheaper one', () => {
    const r = normaliseExitFeeRates({ relaxed: 2, urgent: 9 })!;
    expect(r).toEqual({ relaxed: 2, moderate: 9, soon: 9, urgent: 9 });
  });

  it('rejects unusable shapes rather than inventing a table', () => {
    expect(ratesFromMempoolRecommended(null)).toBeNull();
    expect(ratesFromMempoolRecommended({})).toBeNull();
    expect(ratesFromEsploraEstimates(null)).toBeNull();
    expect(ratesFromEsploraEstimates({})).toBeNull();
    expect(ratesFromEsploraEstimates({ '1': 0, '6': -3 })).toBeNull();
    expect(normaliseExitFeeRates({})).toBeNull();
  });

  it('keeps urgency meaningful when every fee source is unreachable', () => {
    // The defect this replaces: a single flat congestion hedge for every band,
    // which quietly undid the runway pricing at exactly the moment it could not
    // be checked. Observed live with mempool.space down, a wallet with 26 days
    // of runway was priced at 10 sat/vB.
    const f = EXIT_FEE_FALLBACK_RATES;
    expect(f.relaxed).toBeLessThan(f.urgent);
    expect(f.relaxed).toBeLessThanOrEqual(f.moderate);
    expect(f.moderate).toBeLessThanOrEqual(f.soon);
    expect(f.soon).toBeLessThanOrEqual(f.urgent);

    // 6,036 vB of exit set, the live wallet forced through.
    const flat = reserveSatsForExitVb(6036, f.urgent);
    const banded = reserveSatsForExitVb(6036, f.relaxed);
    expect(flat).toBe(120_720);
    expect(banded).toBe(24_144);
  });

  it('prices a relaxed wallet cheaply even blind, and an urgent one dearly', () => {
    const relaxedSet = triageArkExit({
      vtxos: [v({ id: 'roomy', sats: 200_000, expiryHeight: TIP + 9000 })],
      feeRateSatPerVb: EXIT_FEE_FALLBACK_RATES.relaxed,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(exitFeeUrgency(relaxedSet.selected).urgency).toBe('relaxed');

    const urgentSet = triageArkExit({
      vtxos: [v({ id: 'tight', sats: 200_000, expiryHeight: TIP + 156 + 10 })],
      feeRateSatPerVb: EXIT_FEE_FALLBACK_RATES.urgent,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(exitFeeUrgency(urgentSet.selected).urgency).toBe('urgent');
  });
});

describe('freshness floor: refresh a stale capsule, do not exit it', () => {
  const fresh = (id: string, daysLeft: number, over: Partial<ExitTriageVtxo> = {}) =>
    v({ id, sats: 20_000, expiryHeight: TIP + Math.round(daysLeft * 144), ...over });

  it('excludes a capsule with under 4 days left even though it is safe to exit', () => {
    // 3 days clears the runway easily (156 blocks for depth 2), so the temporal
    // axis is happy. This is an economic call, not a safety one.
    const r = triageArkExit({
      vtxos: [fresh('stale', 3)],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded[0].reason).toBe('refresh-before-exiting');
    expect(r.excluded[0].blocksUntilExpiry).toBeGreaterThan(r.excluded[0].requiredRunwayBlocks);
  });

  it.each([
    [0.5, false],
    [3, false],
    [3.9, false],
    [4, true],
    [10, true],
    [27, true],
  ])('%s days left -> exited=%s', (days, kept) => {
    const r = triageArkExit({
      vtxos: [fresh('c', days as number)],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds.length === 1).toBe(kept);
  });

  it('applies to every capsule kind, not just arkoor', () => {
    // Freshness decides, not provenance. A stale round output is just as deep
    // and just as expensive as a stale arkoor one.
    const r = triageArkExit({
      vtxos: [
        fresh('stale-registered', 2, { registered: true }),
        fresh('stale-unregistered', 2, { registered: false }),
        fresh('healthy', 20),
      ],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['healthy']);
    expect(r.excluded.map((e) => e.reason)).toEqual([
      'refresh-before-exiting',
      'refresh-before-exiting',
    ]);
  });

  it('still hard-excludes a capsule inside its runway, which is a different fault', () => {
    // Under 4 days AND inside the runway. The safety exclusion has to win, or
    // the override would let a user take a capsule the server can sweep
    // out from under the exit.
    const r = triageArkExit({
      vtxos: [v({ id: 'doomed', sats: 20_000, expiryHeight: TIP + 40 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toEqual([]);
    expect(r.excluded[0].reason).toBe('too-close-to-expiry');
  });

  it('lets a user with no server left take them anyway', () => {
    // Refreshing needs the ASP. A user reaching for a unilateral exit may have
    // no ASP to reach, so this default must not become a law.
    const r = triageArkExit({
      vtxos: [fresh('stale', 3)],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toEqual(['stale']);
  });

  it('offers the override when freshness is the only thing holding a capsule back', () => {
    const r = triageArkExit({
      vtxos: [fresh('stale', 3), fresh('healthy', 20)],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['healthy']);
    expect(r.overridableCount).toBe(1);
    expect(r.overridableSats).toBe(20_000);
  });

  it('does not fire when the chain tip is unreadable', () => {
    // No tip means no idea how fresh anything is. Guessing "stale" would
    // abandon a healthy wallet on a failed network read.
    const r = triageArkExit({
      vtxos: [fresh('c', 3)],
      feeRateSatPerVb: 1,
      chainTipHeight: null,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['c']);
    expect(r.selected[0].notes).toContain('expiry-unknown');
  });

  it('leaves tonight\'s live wallet untouched', () => {
    // All seven sit ~27 days out, so the floor is inert here. Recorded so a
    // future change to the threshold shows up against real capsules.
    const r = triage();
    expect(r.selectedIds).toHaveLength(6);
    // The two 400s ARE under 4 days, but they are reported as uneconomic,
    // which is the reason a user can act on: below the per-input round
    // minimum, they cannot be refreshed alone anyway.
    expect(r.excluded.map((e) => e.reason)).toEqual([
      'reserve-dwarfs-value',
      'reserve-dwarfs-value',
    ]);
  });
});

describe('how the freshness floor and the fee bands interact', () => {
  it('makes the urgent bands unreachable by default, which is coherent', () => {
    // Not a coincidence worth leaving undocumented. The floor keeps anything
    // under 576 blocks out of the exit set, and the runway is ~156, so a
    // selected capsule always has 420+ blocks of slack and can never read
    // 'soon' or 'urgent'. Exit only fresh capsules, and fresh capsules are
    // never in a hurry, so the exit never bids for speed.
    const justFresh = v({ id: 'edge', sats: 200_000, expiryHeight: TIP + MIN_FRESHNESS_BLOCKS });
    const r = triageArkExit({
      vtxos: [justFresh],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
    });
    expect(r.selectedIds).toEqual(['edge']);
    const u = exitFeeUrgency(r.selected);
    expect(u.tightestSlackBlocks).toBe(MIN_FRESHNESS_BLOCKS - 156);
    expect(['relaxed', 'moderate']).toContain(u.urgency);
  });

  it('still bids urgently when the user forces a stale capsule in', () => {
    // Which is exactly when bidding high is right: the capsule the user
    // overrode the floor for is the one actually racing its expiry.
    const r = triageArkExit({
      vtxos: [v({ id: 'forced', sats: 200_000, expiryHeight: TIP + 200 })],
      feeRateSatPerVb: 1,
      chainTipHeight: TIP,
      vtxoExitDeltaBlocks: EXIT_DELTA,
      economicPolicy: 'recover-everything',
    });
    expect(r.selectedIds).toEqual(['forced']);
    expect(exitFeeUrgency(r.selected).urgency).toBe('urgent');
  });
});
