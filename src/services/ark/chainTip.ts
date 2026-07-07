import { ESPLORA_URLS } from './config';

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
export async function fetchChainTipHeight(): Promise<number | null> {
    for (const base of ESPLORA_URLS) {
        try {
            const res = await fetch(`${base}/blocks/tip/height`, { method: 'GET' });
            if (!res.ok) continue;
            const text = (await res.text()).trim();
            // A real tip height is a bare integer in the ~800k–10M range. The
            // bot-block page is long HTML/JSON — reject anything non-numeric,
            // too long, or implausibly small so it can't be read as a tip.
            if (!/^\d{5,8}$/.test(text)) continue;
            const n = Number(text);
            if (Number.isFinite(n) && n > 0) return n;
        } catch {
            // try the next provider
        }
    }
    return null;
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
