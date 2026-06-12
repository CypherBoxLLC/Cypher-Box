import { ESPLORA_URL } from './config';

/**
 * Fetch the current chain tip height from the configured Esplora server.
 *
 * We need this to compute "days until expiry" for VTXOs — their expiryHeight
 * is an absolute block height, so without a current tip we can't render the
 * depletion ring. The Bark SDK does not expose the tip directly, and running
 * `wallet.maintenance()` is heavier than a single REST call.
 *
 * Returns null on network error (caller falls back to hiding the ring).
 */
export async function fetchChainTipHeight(): Promise<number | null> {
    try {
        const res = await fetch(`${ESPLORA_URL}/blocks/tip/height`, {
            method: 'GET',
        });
        if (!res.ok) return null;
        const text = (await res.text()).trim();
        const n = Number(text);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
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
