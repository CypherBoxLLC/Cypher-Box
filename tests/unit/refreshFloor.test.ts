import {
  BLOCKS_PER_EXIT_LEVEL,
  MIN_CONFIRMATION_BUDGET_BLOCKS,
  REFRESH_FLOOR_GRACE_BLOCKS,
  refreshFloorBlocks,
  requiredRunwayBlocks,
} from '../../src/services/ark/exitTriage';

/**
 * The flat floor this replaces: ARK_EXIT_RUNWAY_HOURS (28h) at
 * AVG_BLOCK_MINUTES (10) is 168 blocks, which is exitDelta + grace with no
 * confirmation budget at all.
 */
const FLAT_FLOOR_BLOCKS = 168;
/** The live mainnet vtxo exit delta, read off the ASP 2026-09-12. */
const MAINNET_DELTA = 144;
/** The sweep's upper band edge: ARK_SWEEP_MAX_RUNWAY_HOURS (1 week). */
const CEIL_BLOCKS = 1008;

describe('refreshFloorBlocks', () => {
  it('is the capsule exit runway plus the grace', () => {
    for (const depth of [1, 2, 3, 5, 9, 17, 49]) {
      expect(refreshFloorBlocks(depth, MAINNET_DELTA, FLAT_FLOOR_BLOCKS)).toBe(
        requiredRunwayBlocks(depth, MAINNET_DELTA) + REFRESH_FLOOR_GRACE_BLOCKS,
      );
    }
  });

  it('scales with depth, so a deeper tree is left alone earlier', () => {
    const shallow = refreshFloorBlocks(2, MAINNET_DELTA, FLAT_FLOOR_BLOCKS);
    const mid = refreshFloorBlocks(9, MAINNET_DELTA, FLAT_FLOOR_BLOCKS);
    const deep = refreshFloorBlocks(17, MAINNET_DELTA, FLAT_FLOOR_BLOCKS);
    expect(shallow).toBeLessThan(mid);
    expect(mid).toBeLessThan(deep);
    // Each extra level costs exactly one confirmation budget step.
    expect(deep - mid).toBe((17 - 9) * BLOCKS_PER_EXIT_LEVEL);
  });

  it('is stricter than the flat floor it replaces, at the mainnet delta', () => {
    // This is the bug: the flat 168 counted no confirmation budget, so every
    // real capsule was being refreshed with less runway than its exit needs.
    for (const depth of [1, 2, 3, 5, 9, 17, 49]) {
      expect(
        refreshFloorBlocks(depth, MAINNET_DELTA, FLAT_FLOOR_BLOCKS),
      ).toBeGreaterThan(FLAT_FLOOR_BLOCKS);
    }
  });

  it('gives a depth-17 tree back the runway the flat floor was skipping', () => {
    const floor = refreshFloorBlocks(17, MAINNET_DELTA, FLAT_FLOOR_BLOCKS);
    // 17 * 6 = 102 blocks (17h) of confirmation budget the flat floor ignored.
    expect(floor - FLAT_FLOOR_BLOCKS).toBe(17 * BLOCKS_PER_EXIT_LEVEL);
  });

  it('honours the minimum confirmation budget for a shallow capsule', () => {
    // depth 1 * 6 is below MIN_CONFIRMATION_BUDGET_BLOCKS, so the floor is the
    // minimum, not the depth product.
    expect(refreshFloorBlocks(1, MAINNET_DELTA, FLAT_FLOOR_BLOCKS)).toBe(
      MIN_CONFIRMATION_BUDGET_BLOCKS + MAINNET_DELTA + REFRESH_FLOOR_GRACE_BLOCKS,
    );
  });

  describe('unknown inputs fall back rather than guessing high', () => {
    // Guessing high here means refusing to refresh, and a capsule the wallet
    // refuses to refresh can expire. That is the opposite of the exit side,
    // where an unknown delta correctly assumes worse and excludes the capsule.
    it.each([
      ['undefined depth', undefined, MAINNET_DELTA],
      ['null depth', null, MAINNET_DELTA],
      ['zero depth', 0, MAINNET_DELTA],
      ['negative depth', -3, MAINNET_DELTA],
      ['NaN depth', NaN, MAINNET_DELTA],
      ['undefined delta', 5, undefined],
      ['null delta', 5, null],
      ['zero delta', 5, 0],
      ['NaN delta', 5, NaN],
      ['both unknown', undefined, null],
    ])('%s falls back to the flat floor', (_label, depth, delta) => {
      expect(
        refreshFloorBlocks(
          depth as number | null | undefined,
          delta as number | null | undefined,
          FLAT_FLOOR_BLOCKS,
        ),
      ).toBe(FLAT_FLOOR_BLOCKS);
    });

    it('an arkoor with no depth is swept on the old rule, not blocked', () => {
      // Lightning-receive dust reports no depth; it must not become
      // permanently unrefreshable because of this change.
      expect(refreshFloorBlocks(undefined, MAINNET_DELTA, FLAT_FLOOR_BLOCKS)).toBe(
        FLAT_FLOOR_BLOCKS,
      );
    });
  });

  describe('ceiling clamp keeps the sweep band from closing', () => {
    it('clamps a pathologically deep capsule below the band ceiling', () => {
      // Depth ~140 at the mainnet delta would otherwise put the floor above the
      // one-week ceiling, leaving no window at all and letting the capsule
      // expire while the floor protects an exit that could never happen.
      const floor = refreshFloorBlocks(140, MAINNET_DELTA, FLAT_FLOOR_BLOCKS, CEIL_BLOCKS);
      expect(floor).toBeLessThan(CEIL_BLOCKS);
      expect(floor).toBe(CEIL_BLOCKS - 1);
    });

    it('leaves realistic depths untouched by the clamp', () => {
      // Measured max depth is 49; nothing in range comes near the ceiling.
      for (const depth of [2, 9, 17, 49]) {
        const clamped = refreshFloorBlocks(depth, MAINNET_DELTA, FLAT_FLOOR_BLOCKS, CEIL_BLOCKS);
        const unclamped = refreshFloorBlocks(depth, MAINNET_DELTA, FLAT_FLOOR_BLOCKS);
        expect(clamped).toBe(unclamped);
        expect(clamped).toBeLessThan(CEIL_BLOCKS);
      }
    });
  });

  it('tracks the server delta rather than pinning the old constant', () => {
    // A server advertising a smaller delta genuinely needs less runway. The
    // floor must follow it down; a Math.max against the flat value would
    // reintroduce the depth-blind number this exists to remove.
    const small = refreshFloorBlocks(2, 100, FLAT_FLOOR_BLOCKS);
    expect(small).toBe(
      requiredRunwayBlocks(2, 100) + REFRESH_FLOOR_GRACE_BLOCKS,
    );
    expect(small).toBeLessThan(FLAT_FLOOR_BLOCKS);
  });

  it('stays above the delta itself, so the CSV wait is always covered', () => {
    for (const delta of [72, 144, 288]) {
      for (const depth of [1, 5, 17]) {
        expect(refreshFloorBlocks(depth, delta, FLAT_FLOOR_BLOCKS)).toBeGreaterThan(delta);
      }
    }
  });
});
