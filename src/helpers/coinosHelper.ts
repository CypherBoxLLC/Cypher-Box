// Backwards-compat shim. The Bitcoin unit-conversion + display helpers
// (SATS, sats, btc, fiat, formatSats, formatCapsuleAmount) used to live
// in this file but are universal across every wallet kind in Cypher Box,
// so they moved to `./bitcoinUnits`. Existing imports keep working
// through this re-export; new code should import directly from
// `@Cypher/helpers/bitcoinUnits`.
//
// The Strike-currency helpers (getStrikeCurrency, SUPPORTED_STRIKE_CURRENCIES,
// DEFAULT_STRIKE_CURRENCY) and the generic format/lookup utilities
// (formatNumber, matchKeyAndValue) stay here for now — the former are
// Strike-specific and could move to a Strike helper, the latter could move
// to a generic format helper. Out of scope for the bitcoin-units split.

export { SATS, sats, btc, fiat, formatSats, formatCapsuleAmount } from './bitcoinUnits';

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
