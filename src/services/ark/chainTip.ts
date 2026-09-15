import { ESPLORA_URLS } from './config';
import { noteEsploraFailure, noteEsploraSuccess, orderedEsploraUrls } from './esploraHealth';
import {
    CHAIN_TIP_CACHE_TTL_MS,
    shouldServeFromCache,
    type ChainTipCacheEntry,
} from './chainTipCache';

/**
 * Fetch the current chain tip height, rotating across the esplora providers.
 *
 * We need this to compute "days until expiry" for VTXOs — their expiryHeight
 * is an absolute block height, so without a current tip we can't render the
 * depletion ring or run the expiry-urgency sweep. The Bark SDK does not expose
 * the tip directly, and running `wallet.maintenance()` is heavier than a single
 * REST call.
 *
 * This is a plain JS fetch (separate from the SDK's internal esplora), so it
 * carries its OWN provider rotation: blockstream intermittently bot-blocks the
 * mobile client and serves an HTML/JSON block page instead of the height, which
 * used to leave `tip=null` for the whole session (claims still worked via the
 * SDK's mempool esplora, but expiry logic went blind). We validate the body is
 * a plausible height — not just Number()-parseable — so the block page can't
 * masquerade as a tip, and fall through to the next provider.
 *
 * Returns null only when EVERY provider fails (caller hides the ring).
 */
// Per-provider request timeout. Without this a bot-blocking provider
// (blockstream holds the connection open serving its Cloudflare page) makes
// `fetch` hang indefinitely, and because this runs inside the sync loop's
// Promise.all it froze the whole JS thread for ~90s (observed 2026-07-09,
// which starved a user's fee estimate on the same thread). 8s is generous for
// a single-integer GET; a slow provider is dropped and the next one tried.
const TIP_FETCH_TIMEOUT_MS = 8000;

async function fetchChainTipFromNetwork(): Promise<number | null> {
    // Health-ordered, not raw list order. This is the exit's dominant request
    // source once #219 made the tip poll the unit of polling, so starting every
    // one of several hundred polls at a provider that is mid-cooldown spends a
    // request to be told the same 429 the open path already learned. Ordering
    // only: every provider is still reachable, just later. See esploraHealth.ts.
    for (const base of orderedEsploraUrls(ESPLORA_URLS)) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIP_FETCH_TIMEOUT_MS);
            let res: Response;
            try {
                res = await fetch(`${base}/blocks/tip/height`, { method: 'GET', signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }
            if (!res.ok) {
                // A 429 arrives here as a plain non-ok response, so this is the
                // branch that actually sees rate limiting. Feed the status text
                // to the classifier rather than a bare "not ok".
                noteEsploraFailure(base, `${res.status} ${res.statusText ?? ''}`);
                continue;
            }
            const text = (await res.text()).trim();
            // A real tip height is a bare integer in the ~800k–10M range. The
            // bot-block page is long HTML/JSON — reject anything non-numeric,
            // too long, or implausibly small so it can't be read as a tip.
            if (!/^\d{5,8}$/.test(text)) {
                // Junk where an integer belongs: a bot-block or error page,
                // which in this context is the disguised rate-limit body.
                noteEsploraFailure(base, text.slice(0, 200));
                continue;
            }
            const n = Number(text);
            if (Number.isFinite(n) && n > 0) {
                noteEsploraSuccess(base);
                return n;
            }
        } catch (err) {
            // Timeout or transport failure. Records as 'unreachable', which
            // carries the short cooldown, so a blip does not sideline a
            // provider for the full quota hour.
            noteEsploraFailure(base, String((err as Error)?.message ?? err));
        }
    }
    return null;
}

let tipCache: ChainTipCacheEntry | null = null;
/** Collapses concurrent callers onto one request. A single sync tick calls
 *  this from several places at once (the Promise.all in useArkSync, the
 *  foreground sweep, triage), which without this fires that many identical
 *  GETs in the same instant. */
let tipInFlight: Promise<number | null> | null = null;

/**
 * When the last SUCCESSFUL network read of the tip happened, or null if there
 * has not been one this session.
 *
 * Callers that persist the tip must stamp with this, not with `Date.now()`.
 * `chainTipFreshness.ts` derives FRESH / DEGRADED / STALE from the stored
 * timestamp, so stamping a cache hit with the current time would report FRESH
 * straight through an esplora outage, which is the silent frozen-countdown bug
 * that module exists to close.
 */
export function getChainTipFetchedAt(): number | null {
    return tipCache?.fetchedAt ?? null;
}

/** Drop the cached tip. For tests and for any flow that has just changed what
 *  "current" means. */
export function invalidateChainTipCache(): void {
    tipCache = null;
}

/**
 * Current chain tip height, served from a short cache.
 *
 * Pass `maxAgeMs: 0` to force a network read: the exit drive needs the real
 * current tip because the tip IS its unit of progress, and so does anything
 * deciding whether esplora is reachable at all.
 *
 * On total network failure this returns null rather than the stale cached
 * height, exactly as it did before the cache existed. Callers deliberately
 * leave the previously stored tip in place on null, and its age is what makes
 * the outage visible; handing back a stale height here would hide it.
 */
export async function fetchChainTipHeight(
    opts?: { maxAgeMs?: number },
): Promise<number | null> {
    const maxAgeMs = opts?.maxAgeMs ?? CHAIN_TIP_CACHE_TTL_MS;
    if (shouldServeFromCache(tipCache, Date.now(), maxAgeMs)) {
        return (tipCache as ChainTipCacheEntry).height;
    }
    if (tipInFlight) return tipInFlight;

    tipInFlight = (async () => {
        try {
            const height = await fetchChainTipFromNetwork();
            if (height != null) {
                tipCache = { height, fetchedAt: Date.now() };
            }
            return height;
        } finally {
            tipInFlight = null;
        }
    })();
    return tipInFlight;
}

/** Signet/mainnet assume 10-min blocks; used to convert "blocks until expiry" → days. */
export const AVG_BLOCK_MINUTES = 10;

export function blocksToDays(blocks: number): number {
    return (blocks * AVG_BLOCK_MINUTES) / (60 * 24);
}

/** Hours-precision sibling of {@link blocksToDays}; used for the 24h-before-expiry threshold. */
export function blocksToHours(blocks: number): number {
    return (blocks * AVG_BLOCK_MINUTES) / 60;
}
