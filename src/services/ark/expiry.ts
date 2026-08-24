import { blocksToDays, blocksToHours } from './chainTip';
import { getArkWalletHandle } from './walletHandle';

/**
 * Forward-looking expiry / refresh signals from the bark SDK.
 *
 * Wraps two read-only methods the app didn't previously use:
 *   - `wallet.getFirstExpiringVtxoBlockheight()`
 *   - `wallet.getNextRequiredRefreshBlockheight()`
 *
 * The per-VTXO `expiryHeight` field on `ArkVtxoView` is still the source of
 * truth for capsule-row countdowns — these helpers exist for at-a-glance
 * summary signals ("when will the wallet act / when does my first capsule
 * expire") without iterating the VTXO list in JS.
 *
 * NET-NEW for the app: `getNextRequiredRefreshBlockheight` is the wallet's
 * own policy view of when it has to refresh, accounting for refresh-headroom
 * margin so the round can settle before the underlying VTXOs sweep on-chain.
 * No JS-side equivalent existed before this file.
 */

/**
 * Block-height of the earliest-expiring spendable VTXO, per the SDK's view.
 *
 * Returns null when the SDK has nothing to report (no VTXOs, or all-arkoor —
 * arkoor VTXOs inherit their parent's expiry, not their own). The app today
 * re-derives this in WalletsView / ArkWallet via
 * `Math.min(allVtxos.map(v => v.expiryHeight).filter(h => h > 0))`; this
 * wrapper exposes the authoritative answer for new call sites that don't
 * want to repeat the iteration.
 *
 * Errors are swallowed (null return + warn) — a transient SDK / bridge
 * failure shouldn't blank a UI signal on the next render. The next sync
 * tick retries.
 */
export async function fetchArkFirstExpiringHeight(): Promise<number | null> {
    const handle = getArkWalletHandle();
    if (!handle) return null;

    try {
        const h = await handle.getFirstExpiringVtxoBlockheight();
        return typeof h === 'number' ? h : null;
    } catch (err) {
        console.warn('[Ark expiry] getFirstExpiringVtxoBlockheight failed:', err);
        return null;
    }
}

/**
 * Block-height by which the wallet should perform a refresh, per its own
 * internal policy.
 *
 * NET-NEW signal — the app has no JS-side equivalent. The wallet computes
 * this from spendable-VTXO expiries minus a refresh-headroom margin so a
 * refresh round has time to settle before the underlying VTXOs sweep
 * on-chain. Returns null when there's nothing to refresh (no spendable
 * VTXOs / all already refreshed within margin).
 *
 * Pairs with the auto-refresh feature: the user can read this as "this is
 * the deadline by which auto-refresh (or you, manually) needs to act."
 */
export async function fetchArkNextRequiredRefreshHeight(): Promise<number | null> {
    const handle = getArkWalletHandle();
    if (!handle) return null;

    try {
        const h = await handle.getNextRequiredRefreshBlockheight();
        return typeof h === 'number' ? h : null;
    } catch (err) {
        console.warn('[Ark expiry] getNextRequiredRefreshBlockheight failed:', err);
        return null;
    }
}

/**
 * Format a block delta as user-facing time copy.
 *
 *   ≤ 0       → "now"           (refresh is due / overdue)
 *   < 1 h     → "soon"          (sub-hour estimates fluctuate on every block;
 *                                dropping the unit avoids "in ~0h" misreads)
 *   < 24 h    → "in ~Xh"
 *   ≥ 24 h    → "in ~Xd"
 *
 * 10-minute average block time (mainnet) per `AVG_BLOCK_MINUTES` in
 * `chainTip.ts`. The block number itself is intentionally NOT surfaced here
 * — block heights are reserved for console / activity-log emission, users
 * see time copy only.
 */
/**
 * How long before a unilateral exit can be COLLECTED. Hours precision below
 * three days, deliberately different from {@link formatBlocksUntil}.
 *
 * The exit wait is derived from depth: a depth-2 capsule needs 12 + 144 = 156
 * blocks (~26h) and a depth-9 one needs 54 + 144 = 198 (~33h). `formatBlocksUntil`
 * switches to days at 24h and renders BOTH as "in ~1d", which throws away the
 * only reason the figure is derived rather than hardcoded. Expiry copy, which
 * deals in weeks, still wants the coarse version.
 */
export function formatExitCollectWait(blocks: number): string {
    if (blocks <= 0) return 'now';
    const hours = blocksToHours(blocks);
    if (hours < 1) return 'shortly';
    if (hours < 72) return `in about ${Math.round(hours)} hours`;
    return `in about ${Math.round(blocksToDays(blocks))} days`;
}

export function formatBlocksUntil(blocks: number): string {
    if (blocks <= 0) return 'now';
    const hours = blocksToHours(blocks);
    if (hours < 1) return 'soon';
    if (hours < 24) return `in ~${Math.round(hours)}h`;
    const days = blocksToDays(blocks);
    return `in ~${Math.round(days)}d`;
}
