/**
 * Cache policy for the chain tip poll.
 *
 * Why this exists: `fetchChainTipHeight()` is a plain `GET /blocks/tip/height`
 * against public esplora, and it ran on every sync tick (30s on iOS, 60s on
 * Android) from ten separate call sites with no cache at all. Blocks arrive
 * every ~10 minutes, so that polled for a number roughly twenty times more
 * often than it can change: ~120 requests an hour per user on iOS from this
 * one call. `chainTip.ts` already names it "the exit's dominant request
 * source", and the 429s it earns are the rate limiting the wallet then has to
 * route around.
 *
 * Deliberately free of ./config (and so of the bark SDK), which cannot be
 * loaded under jest. Same trade as ./chainTipFreshness and ./esploraProviders:
 * keeping the policy here is what lets it be unit-tested, while `chainTip.ts`
 * holds the mutable entry and does the network.
 *
 * THE TTL IS BOUNDED BY THE FRESHNESS THRESHOLD, NOT BY WHAT WOULD SAVE MOST
 * REQUESTS. `chainTipFreshness.ts` marks the vault's expiry numbers as merely
 * "estimated" once the stored tip is older than FRESH (3 min). The store
 * records the real network-fetch time, not the cache-hit time (see
 * `getChainTipFetchedAt`), so a TTL at or above 3 min would push a perfectly
 * healthy wallet into DEGRADED between fetches and mark its numbers estimated
 * for no reason. 2 min keeps every cache hit inside FRESH.
 *
 * The alternative, re-stamping the store on a cache hit, is the one thing this
 * must never do: freshness is derived from that timestamp, and re-stamping
 * would report FRESH right through an esplora outage. That is exactly the
 * silent-frozen-countdown bug chainTipFreshness.ts was written to close.
 */

/** How long a fetched tip may be reused. Under the 3 min FRESH threshold in
 *  ./chainTipFreshness by design; see the note above before raising it. */
export const CHAIN_TIP_CACHE_TTL_MS = 2 * 60 * 1000;

export type ChainTipCacheEntry = {
    /** Height as read from a provider. */
    height: number;
    /** When the NETWORK read succeeded. Never bumped on a cache hit. */
    fetchedAt: number;
};

/**
 * May `entry` be served without going to the network?
 *
 * `maxAgeMs` of 0 (or less) forces a network read, which is what a caller that
 * genuinely needs the current tip passes: the exit drive, where the tip is the
 * unit of progress, and anything deciding whether esplora is reachable at all.
 */
export function shouldServeFromCache(
    entry: ChainTipCacheEntry | null,
    now: number,
    maxAgeMs: number,
): boolean {
    if (entry == null) return false;
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
    if (!Number.isFinite(entry.fetchedAt)) return false;
    const age = now - entry.fetchedAt;
    // A negative age means the clock moved backwards (NTP correction, user
    // changing the device clock). Treat it as unusable rather than as
    // infinitely fresh, which is the direction that would serve a stale tip
    // forever.
    if (age < 0) return false;
    return age < maxAgeMs;
}
