/**
 * The USDT amount a user enters for a swap, and whether it can be swapped.
 *
 * Amounts stay decimal strings end to end, as everywhere in the conversion
 * code: a rounded amount is the user's money, and the quote is checked against
 * the amount exactly (requestFlashnetQuote refuses one that differs).
 *
 * Typed amounts take cents at most. "Swap all" fills in the balance as the
 * chain reports it, up to USDT's six decimals, so nothing is left behind.
 *
 * Pure, so the keypad and the rules are unit-tested.
 */

import BigNumber from 'bignumber.js';

/** Decimals a typed amount may carry. */
export const SWAP_AMOUNT_TYPED_DECIMALS = 2;

/** Digits before the point: a billion USDT is well past any route's ceiling. */
const MAX_WHOLE_DIGITS = 9;

/** The keypad's keys: a digit, the decimal point, or delete. */
export type SwapAmountKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

/**
 * The amount after one key press. Keys that would make it malformed, a second
 * point, a third decimal, a leading zero, are ignored rather than refused.
 */
export function applySwapAmountKey(current: string, key: SwapAmountKey): string {
    if (key === 'back') {
        return current.slice(0, -1);
    }
    if (key === '.') {
        if (current.includes('.')) return current;
        return current === '' ? '0.' : `${current}.`;
    }
    if (current === '0') {
        return key;
    }
    const [whole, fraction] = current.split('.');
    if (fraction !== undefined) {
        return fraction.length >= SWAP_AMOUNT_TYPED_DECIMALS ? current : current + key;
    }
    if (whole.length >= MAX_WHOLE_DIGITS) {
        return current;
    }
    return current === '' && key === '0' ? '0' : current + key;
}

/** The amount as a plain decimal string, without a trailing point: "150." becomes "150". */
export function normalizeSwapAmount(amount: string): string {
    const n = new BigNumber(amount);
    return n.isFinite() ? n.toFixed() : '';
}

export type SwapAmountCheck =
    | { readonly ok: true }
    /** Nothing, or nothing above zero, entered yet. */
    | { readonly ok: false; readonly code: 'EMPTY' }
    /** Under the smallest conversion we quote. `minimum` is in USDT. */
    | { readonly ok: false; readonly code: 'BELOW_MINIMUM'; readonly minimum: string }
    /** More than the wallet holds. */
    | { readonly ok: false; readonly code: 'INSUFFICIENT_USDT'; readonly balance: string };

/**
 * Whether an amount can go on to a quote.
 *
 * The minimum is the backend's (getTronConversionTerms), so this is the same
 * refusal prepareUsdtConversion would give, made before a destination is even
 * asked for. The balance is optional: when it could not be read, the amount is
 * let through and the quote step checks it against the chain.
 */
export function checkSwapAmount(
    amount: string,
    limits: { readonly minimum: string; readonly balance: string | null },
): SwapAmountCheck {
    const n = new BigNumber(amount);
    if (!amount || !n.isFinite() || !n.isGreaterThan(0)) {
        return { ok: false, code: 'EMPTY' };
    }
    if (n.isLessThan(limits.minimum)) {
        return { ok: false, code: 'BELOW_MINIMUM', minimum: new BigNumber(limits.minimum).toFixed() };
    }
    if (limits.balance !== null && n.isGreaterThan(limits.balance)) {
        return { ok: false, code: 'INSUFFICIENT_USDT', balance: new BigNumber(limits.balance).toFixed() };
    }
    return { ok: true };
}
