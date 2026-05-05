export let SATS = 100000000;
export let sats = (n: number) => Math.round(n * SATS);
export let btc = (n: number) => parseFloat((n / SATS).toFixed(8));
export let fiat = (n: number, r: number) => (n * r) / SATS;
export let getStrikeCurrency = (currency: string) => {
    switch (currency) {
            case 'USD':
                    return '$';
            case 'EUR':
                    return '€';
            case 'GBP':
                    return '£';
            case 'AUD':
                    return 'A$';
            case 'USDT':
                    return '₮';
            default:
                    return currency;
    }
}

// Supported Strike currencies
export const SUPPORTED_STRIKE_CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'USDT', 'BTC'] as const;
export type StrikeCurrency = typeof SUPPORTED_STRIKE_CURRENCIES[number];

// Fallback currency when user currency is unavailable
export const DEFAULT_STRIKE_CURRENCY = 'USD';
export function matchKeyAndValue(obj1: Record<string, number>, value: string) {
  for (let key in obj1) {
      if (key === value) {
          return obj1[key];
      }
  }
  // If no match is found, return null or any other appropriate value
  return null;
}
export function formatNumber(num: number) {
    if (num >= 1000000) {
        return (num / 1000000) + 'M';
    } else if (num >= 1000) {
        return (num / 1000) + 'K';
    } else {
        return num.toString();
    }
}

// Lightning-wallet sat balance display. ≤999 → raw, ≥1000 → "1K" or
// "1.03K" (two decimals), ≥1M → "1M" or "1.03M". Whole units strip
// the trailing ".00" so the typical small balance ("1K sats") stays
// short and readable.
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
