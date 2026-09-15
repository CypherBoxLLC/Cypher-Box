import {
  CHAIN_TIP_CACHE_TTL_MS,
  shouldServeFromCache,
  type ChainTipCacheEntry,
} from '../../src/services/ark/chainTipCache';
import { TIP_FRESH_MS } from '../../src/services/ark/chainTipFreshness';

const NOW = 1_800_000_000_000;
const entry = (fetchedAt: number, height = 912_345): ChainTipCacheEntry => ({
  height,
  fetchedAt,
});

describe('chain tip cache policy', () => {
  it('serves a tip fetched within the TTL', () => {
    expect(
      shouldServeFromCache(entry(NOW - 1_000), NOW, CHAIN_TIP_CACHE_TTL_MS),
    ).toBe(true);
    expect(
      shouldServeFromCache(entry(NOW - (CHAIN_TIP_CACHE_TTL_MS - 1)), NOW, CHAIN_TIP_CACHE_TTL_MS),
    ).toBe(true);
  });

  it('refetches once the TTL has elapsed', () => {
    expect(
      shouldServeFromCache(entry(NOW - CHAIN_TIP_CACHE_TTL_MS), NOW, CHAIN_TIP_CACHE_TTL_MS),
    ).toBe(false);
    expect(
      shouldServeFromCache(entry(NOW - CHAIN_TIP_CACHE_TTL_MS * 5), NOW, CHAIN_TIP_CACHE_TTL_MS),
    ).toBe(false);
  });

  it('has nothing to serve before the first fetch', () => {
    expect(shouldServeFromCache(null, NOW, CHAIN_TIP_CACHE_TTL_MS)).toBe(false);
  });

  describe('maxAgeMs of 0 forces the network', () => {
    // What a caller passes when it needs the true current tip rather than a
    // recent one.
    it.each([0, -1, NaN, Infinity])('maxAgeMs %p never serves the cache', (maxAge) => {
      expect(shouldServeFromCache(entry(NOW), NOW, maxAge as number)).toBe(false);
    });
  });

  it('does not serve a cache entry stamped in the future', () => {
    // Clock moved backwards (NTP correction, user changed the device clock).
    // Treating a negative age as infinitely fresh would pin a stale tip for
    // good, which is the direction that hides an outage.
    expect(shouldServeFromCache(entry(NOW + 60_000), NOW, CHAIN_TIP_CACHE_TTL_MS)).toBe(false);
  });

  it('ignores an entry with an unusable timestamp', () => {
    expect(shouldServeFromCache(entry(NaN), NOW, CHAIN_TIP_CACHE_TTL_MS)).toBe(false);
    expect(shouldServeFromCache(entry(Infinity), NOW, CHAIN_TIP_CACHE_TTL_MS)).toBe(false);
  });

  describe('the TTL must stay inside the freshness window', () => {
    it('is shorter than FRESH, so a cached tip never reads as degraded', () => {
      // The store records the real network-fetch time, so between fetches the
      // stored tip ages up to one TTL. If the TTL reached FRESH, a healthy
      // wallet would flip to DEGRADED between fetches and mark its expiry
      // numbers estimated for no reason. This is the constraint that decides
      // the TTL, not the request saving.
      expect(CHAIN_TIP_CACHE_TTL_MS).toBeLessThan(TIP_FRESH_MS);
    });

    it('still cuts the poll rate several-fold against a 30s tick', () => {
      const TICK_MS = 30_000; // INTERVAL_MS_IOS in useArkSync
      const before = 3_600_000 / TICK_MS; // 120 requests an hour
      const after = 3_600_000 / CHAIN_TIP_CACHE_TTL_MS;
      expect(after).toBeLessThan(before / 3);
    });
  });
});
