/**
 * The two amounts the USDT card shows, and the rate between them.
 *
 * The card is a converter: one field is typed into, the other is worked out
 * from a rate, and the flip button swaps which is which. Everything that
 * decides a number lives here rather than in the component, so the arithmetic
 * a user reads their price off is unit-tested.
 *
 * Amounts stay decimal strings, as everywhere in the conversion code: the
 * figures are the user's money and a float would round them. The worked-out
 * side is always truncated, never rounded up, so the card cannot promise more
 * than a swap would deliver.
 *
 * Nothing here is a quote. The rate is Flashnet's indicative one from
 * getFlashnetPair, and the confirm screen's quote is the figure that binds.
 */

import BigNumber from 'bignumber.js';

/**
 * Which way round the card is.
 *
 * `usdt_to_btc` is buying bitcoin, the card's default: USDT is typed and
 * bitcoin is worked out. `btc_to_usdt` is selling it.
 */
export type SwapDirection = 'usdt_to_btc' | 'btc_to_usdt';

/** Decimals each side accepts when it is the one being typed into. */
export const USDT_TYPED_DECIMALS = 2;
export const BTC_TYPED_DECIMALS = 8;

/** Decimals each side carries on its own chain, for the worked-out figure. */
const USDT_CHAIN_DECIMALS = 6;
const BTC_CHAIN_DECIMALS = 8;

/** Digits before the point. A billion USDT is past any route's ceiling. */
const MAX_WHOLE_DIGITS = 10;

export const isBuyingBitcoin = (direction: SwapDirection): boolean => direction === 'usdt_to_btc';

export const flipDirection = (direction: SwapDirection): SwapDirection =>
    direction === 'usdt_to_btc' ? 'btc_to_usdt' : 'usdt_to_btc';

/** The asset the user types in, and the one they get, in this direction. */
export const sendAssetOf = (direction: SwapDirection): 'USDT' | 'BTC' => (isBuyingBitcoin(direction) ? 'USDT' : 'BTC');
export const receiveAssetOf = (direction: SwapDirection): 'USDT' | 'BTC' => (isBuyingBitcoin(direction) ? 'BTC' : 'USDT');

/** Decimals the editable field accepts in this direction. */
export function typedDecimalsFor(direction: SwapDirection): number {
    return isBuyingBitcoin(direction) ? USDT_TYPED_DECIMALS : BTC_TYPED_DECIMALS;
}

/**
 * What the user typed, kept to something that is still a number.
 *
 * A text field can receive anything a keyboard or a paste offers, including
 * several points and a pasted "1,234.00". Rather than refuse a keystroke, the
 * text is reduced to the closest well formed amount: the first point is kept,
 * and the excess decimals and whole digits are cut. A lone point becomes "0."
 * so the field can be typed into from empty.
 *
 * A comma is the decimal point on most of the world's keyboards, and a
 * decimal-pad shows whichever one the phone's locale uses. Dropping it as
 * punctuation meant the key did nothing and no decimal could be entered at
 * all. So a comma is read as the decimal point, unless a point is already
 * there, in which case it is grouping, as in a pasted "1,234.50".
 */
export function sanitizeTypedAmount(text: string, decimals: number): string {
    const separated = text.includes('.') ? text.replace(/,/g, '') : text.replace(/,/g, '.');
    const cleaned = separated.replace(/[^0-9.]/g, '');
    if (cleaned === '') return '';

    const firstPoint = cleaned.indexOf('.');
    const whole = (firstPoint === -1 ? cleaned : cleaned.slice(0, firstPoint)).slice(0, MAX_WHOLE_DIGITS);
    if (firstPoint === -1) {
        // Leading zeros carry no value and read as a bug: "007" becomes "7".
        return whole.replace(/^0+(?=\d)/, '');
    }
    if (decimals === 0) {
        return whole.replace(/^0+(?=\d)/, '') || '0';
    }
    const fraction = cleaned.slice(firstPoint + 1).replace(/\./g, '').slice(0, decimals);
    const head = (whole.replace(/^0+(?=\d)/, '') || '0');
    return `${head}.${fraction}`;
}

/** The amount as a plain decimal string, without a trailing point: "150." becomes "150". */
export function normalizeTypedAmount(amount: string): string {
    const n = new BigNumber(amount);
    return n.isFinite() ? n.toFixed() : '';
}

/** Whether a rate can be used to work anything out. */
const usableRate = (rate: string | null): boolean => {
    if (rate === null) return false;
    const n = new BigNumber(rate);
    return n.isFinite() && n.isGreaterThan(0);
};

/**
 * The other side of the card, from the typed side and the rate.
 *
 * `rate` is the settle asset per one deposit unit, which is what
 * getFlashnetPair returns for the pair being converted, so it already points
 * the same way as `direction` and multiplying is right in both directions.
 * Truncated down to the receiving asset's own decimals: a figure the chain
 * cannot represent would overstate what arrives.
 *
 * Null when there is no rate yet, or nothing has been typed.
 */
export function convertAtRate(amount: string, rate: string | null, direction: SwapDirection): string | null {
    if (!usableRate(rate)) return null;
    const n = new BigNumber(amount);
    if (!n.isFinite() || !n.isGreaterThan(0)) return null;
    const decimals = isBuyingBitcoin(direction) ? BTC_CHAIN_DECIMALS : USDT_CHAIN_DECIMALS;
    return n.multipliedBy(rate as string).decimalPlaces(decimals, BigNumber.ROUND_DOWN).toFixed();
}

/**
 * USDT for one whole bitcoin, for the card's price line.
 *
 * The rate points whichever way the card does, so selling reads it straight
 * and buying inverts it. Null when there is no rate to show.
 */
export function usdtPerBitcoin(rate: string | null, direction: SwapDirection): string | null {
    if (!usableRate(rate)) return null;
    const n = new BigNumber(rate as string);
    const perBtc = isBuyingBitcoin(direction) ? new BigNumber(1).dividedBy(n) : n;
    return perBtc.isFinite() ? perBtc.decimalPlaces(2, BigNumber.ROUND_DOWN).toFixed() : null;
}

/**
 * A bitcoin amount for a field: up to eight decimals, trailing zeros gone.
 * Whole bitcoin keeps a single zero so the field never reads as bare "1".
 */
export function formatBitcoinAmount(btc: string): string {
    const n = new BigNumber(btc);
    if (!n.isFinite()) return '';
    const fixed = n.decimalPlaces(BTC_CHAIN_DECIMALS, BigNumber.ROUND_DOWN).toFixed();
    return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '.0') : fixed;
}

/** Whole sats from a bitcoin amount, grouped: "224,512". */
export function satsFromBitcoin(btc: string): string {
    const n = new BigNumber(btc);
    return n.isFinite() ? n.shiftedBy(8).integerValue(BigNumber.ROUND_DOWN).toFormat(0) : '0';
}

/** A price line for the card and the review: "1 BTC = 111,234.00 USDT". */
export function formatRateLine(rate: string | null, direction: SwapDirection): string | null {
    const perBtc = usdtPerBitcoin(rate, direction);
    return perBtc === null ? null : `1 BTC = ${new BigNumber(perBtc).toFormat(2)} USDT`;
}
