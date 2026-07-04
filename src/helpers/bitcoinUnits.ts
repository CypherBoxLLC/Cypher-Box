// Bitcoin unit conversion + display helpers. Universal across every wallet
// kind in Cypher Box (Strike, CoinOS, on-chain hot/cold vault, Ark) — these
// are protocol-level utilities, not provider-specific behavior, so they
// don't belong inside any one wallet's helper file.
//
// Historical note: these used to live in `coinosHelper.ts`. That file
// re-exports from here for backwards compatibility while the rest of the
// codebase migrates its imports.

/** 1 BTC = 100,000,000 sats. */
export const SATS = 100_000_000;

/** BTC → sats, rounded to integer. */
export const sats = (n: number) => Math.round(n * SATS);

/** sats → BTC, returned as a number (parseFloat strips trailing zeros).
 *  Note: produces scientific notation for very small values (60 sats →
 *  6e-7). Use `formatCapsuleAmount` for display. */
export const btc = (n: number) => parseFloat((n / SATS).toFixed(8));

/** sats → fiat at the given rate (rate is fiat per BTC). */
export const fiat = (n: number, r: number) => (n * r) / SATS;

/**
 * Compact thousand/million suffix for sats balances:
 *   ≤999      → raw "12"
 *   1k–999k   → "1.5K" / "1K" (whole units strip ".00")
 *   ≥1M       → "1M" / "1.03M"
 *
 * Used for headline balance text where space is tight; pair with " sats"
 * suffix on the calling side if the unit isn't already implied by context.
 */
export function formatSats(num: number): string {
    const n = Math.round(Number(num) || 0);
    if (n <= 999) return `${n}`;
    if (n >= 1_000_000) {
        const m = n / 1_000_000;
        const fixed = m.toFixed(2);
        return fixed.endsWith('.00') ? `${parseInt(fixed, 10)}M` : `${fixed}M`;
    }
    const k = n / 1000;
    const fixed = k.toFixed(2);
    return fixed.endsWith('.00') ? `${parseInt(fixed, 10)}K` : `${fixed}K`;
}

/**
 * Per-capsule amount label used by every capsule view in the app
 * (Ark VTXOs, hot/cold vault UTXOs).
 *
 * Switches units so small capsules don't render in scientific BTC
 * notation (60 sats was previously displayed as "6e-7 BTC", unreadable).
 * Below 1M sats we stay in sats / K-sats; at 1M+ we cross into BTC since
 * the long-tail decimal becomes unwieldy in K-sats above that.
 *
 *    99 sats        → "99 sats"
 *    1500 sats      → "1.5K sats"
 *    100_000 sats   → "100K sats"
 *    999_999 sats   → "999.99K sats"
 *    1_000_000 sats → "0.01 BTC"
 *    12_345_678     → "0.12345678 BTC"
 *    100_000_000    → "1 BTC"
 *
 * Trailing zeros and the trailing decimal point are stripped from the
 * BTC formatting so whole-BTC amounts read as "1 BTC" rather than
 * "1.00000000 BTC".
 */
export function formatCapsuleAmount(satsAmount: number): string {
    const n = Math.round(Number(satsAmount) || 0);
    if (n < 1_000_000) return `${formatSats(n)} sats`;
    const fixed = (n / SATS).toFixed(8);
    const trimmed = fixed.replace(/\.?0+$/, '');
    return `${trimmed} BTC`;
}
