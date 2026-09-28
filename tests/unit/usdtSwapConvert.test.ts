/**
 * The USDT card's converter: what the other field says, and the price line.
 *
 * What this protects:
 *   - The worked-out side is truncated, never rounded up, so the card cannot
 *     promise more bitcoin than a swap would deliver.
 *   - The rate is read the right way round in both directions. Buying inverts
 *     it, selling reads it straight, and getting that backwards would show a
 *     price out by the square of itself.
 *   - A field can be typed into and pasted into without producing something
 *     that is not a number: one point, capped decimals, no leading zeros.
 *   - No rate and no amount both read as "nothing to show" rather than zero,
 *     since a zero price is a lie the card would tell while it loads.
 */

import {
    BTC_TYPED_DECIMALS,
    USDT_TYPED_DECIMALS,
    convertAtRate,
    flipDirection,
    formatBitcoinAmount,
    formatRateLine,
    isBuyingBitcoin,
    normalizeTypedAmount,
    receiveAssetOf,
    sanitizeTypedAmount,
    satsFromBitcoin,
    sendAssetOf,
    typedDecimalsFor,
    usdtPerBitcoin,
} from '../../src/services/tron/swapConvert';

/** A round rate: 1 BTC costs 100,000 USDT, so 1 USDT buys 0.00001 BTC. */
const BUY_RATE = '0.00001';
const SELL_RATE = '100000';

describe('direction', () => {
    it('starts from buying bitcoin and flips both ways', () => {
        expect(isBuyingBitcoin('usdt_to_btc')).toBe(true);
        expect(isBuyingBitcoin('btc_to_usdt')).toBe(false);
        expect(flipDirection('usdt_to_btc')).toBe('btc_to_usdt');
        expect(flipDirection('btc_to_usdt')).toBe('usdt_to_btc');
    });

    it('names the asset on each side', () => {
        expect(sendAssetOf('usdt_to_btc')).toBe('USDT');
        expect(receiveAssetOf('usdt_to_btc')).toBe('BTC');
        expect(sendAssetOf('btc_to_usdt')).toBe('BTC');
        expect(receiveAssetOf('btc_to_usdt')).toBe('USDT');
    });

    it('accepts cents when typing USDT and eight decimals when typing bitcoin', () => {
        expect(typedDecimalsFor('usdt_to_btc')).toBe(USDT_TYPED_DECIMALS);
        expect(typedDecimalsFor('btc_to_usdt')).toBe(BTC_TYPED_DECIMALS);
        expect(USDT_TYPED_DECIMALS).toBe(2);
        expect(BTC_TYPED_DECIMALS).toBe(8);
    });
});

describe('sanitizeTypedAmount', () => {
    it('keeps a well formed amount as it is', () => {
        expect(sanitizeTypedAmount('250', 2)).toBe('250');
        expect(sanitizeTypedAmount('250.75', 2)).toBe('250.75');
    });

    it('drops anything that is not a digit or a separator', () => {
        expect(sanitizeTypedAmount('250 USDT', 2)).toBe('250');
        expect(sanitizeTypedAmount('abc', 2)).toBe('');
    });

    it('reads a comma as the decimal point, which most keyboards send', () => {
        // The phone showed a comma on its decimal-pad and the key did nothing,
        // so no fraction could be typed at all.
        expect(sanitizeTypedAmount('0,', 8)).toBe('0.');
        expect(sanitizeTypedAmount('0,001', 8)).toBe('0.001');
        expect(sanitizeTypedAmount('1,5', 2)).toBe('1.5');
    });

    it('reads a comma as grouping when a point is already there', () => {
        expect(sanitizeTypedAmount('1,234.50', 2)).toBe('1234.50');
        expect(sanitizeTypedAmount('1,234,567.89', 2)).toBe('1234567.89');
    });

    it('keeps only the first point', () => {
        expect(sanitizeTypedAmount('1.5.0', 2)).toBe('1.50');
        expect(sanitizeTypedAmount('1..5', 2)).toBe('1.5');
    });

    it('caps the decimals at the asset being typed', () => {
        expect(sanitizeTypedAmount('250.759', 2)).toBe('250.75');
        expect(sanitizeTypedAmount('0.123456789', 8)).toBe('0.12345678');
    });

    it('can be typed into from empty, and drops leading zeros', () => {
        expect(sanitizeTypedAmount('.', 2)).toBe('0.');
        expect(sanitizeTypedAmount('.5', 2)).toBe('0.5');
        expect(sanitizeTypedAmount('007', 2)).toBe('7');
        expect(sanitizeTypedAmount('0.5', 8)).toBe('0.5');
        expect(sanitizeTypedAmount('', 2)).toBe('');
    });

    it('drops a trailing point when normalized', () => {
        expect(normalizeTypedAmount('150.')).toBe('150');
        expect(normalizeTypedAmount('')).toBe('');
        expect(normalizeTypedAmount('.')).toBe('');
    });
});

describe('convertAtRate', () => {
    it('works out the bitcoin a USDT amount buys', () => {
        expect(convertAtRate('250', BUY_RATE, 'usdt_to_btc')).toBe('0.0025');
        expect(convertAtRate('1', BUY_RATE, 'usdt_to_btc')).toBe('0.00001');
    });

    it('works out the USDT a bitcoin amount sells for', () => {
        expect(convertAtRate('0.0025', SELL_RATE, 'btc_to_usdt')).toBe('250');
        expect(convertAtRate('1', SELL_RATE, 'btc_to_usdt')).toBe('100000');
    });

    it('truncates rather than rounding up, so the card never overstates', () => {
        // 3 USDT at this rate is 0.000030999...; the ninth decimal is dropped,
        // not carried, so the figure stays inside what a swap would deliver.
        expect(convertAtRate('3', '0.0000103333333', 'usdt_to_btc')).toBe('0.00003099');
    });

    it('has nothing to show without a rate or an amount', () => {
        expect(convertAtRate('250', null, 'usdt_to_btc')).toBeNull();
        expect(convertAtRate('', BUY_RATE, 'usdt_to_btc')).toBeNull();
        expect(convertAtRate('0', BUY_RATE, 'usdt_to_btc')).toBeNull();
        expect(convertAtRate('abc', BUY_RATE, 'usdt_to_btc')).toBeNull();
        expect(convertAtRate('250', '0', 'usdt_to_btc')).toBeNull();
        expect(convertAtRate('250', '-1', 'usdt_to_btc')).toBeNull();
    });
});

describe('usdtPerBitcoin', () => {
    it('inverts a buying rate and reads a selling rate straight', () => {
        expect(usdtPerBitcoin(BUY_RATE, 'usdt_to_btc')).toBe('100000');
        expect(usdtPerBitcoin(SELL_RATE, 'btc_to_usdt')).toBe('100000');
    });

    it('agrees with itself across a flip, which is what the flip button must not change', () => {
        // The same market, quoted both ways: the price line must not move.
        expect(usdtPerBitcoin('0.000009', 'usdt_to_btc')).toBe('111111.11');
        expect(usdtPerBitcoin('111111.11', 'btc_to_usdt')).toBe('111111.11');
    });

    it('has nothing to show without a usable rate', () => {
        expect(usdtPerBitcoin(null, 'usdt_to_btc')).toBeNull();
        expect(usdtPerBitcoin('0', 'usdt_to_btc')).toBeNull();
    });

    it('writes the price line grouped, or not at all', () => {
        expect(formatRateLine(BUY_RATE, 'usdt_to_btc')).toBe('1 BTC = 100,000.00 USDT');
        expect(formatRateLine('111111.11', 'btc_to_usdt')).toBe('1 BTC = 111,111.11 USDT');
        expect(formatRateLine(null, 'usdt_to_btc')).toBeNull();
    });
});

describe('display helpers', () => {
    it('shows bitcoin without trailing zeros', () => {
        expect(formatBitcoinAmount('0.00250000')).toBe('0.0025');
        expect(formatBitcoinAmount('1.00000000')).toBe('1');
        expect(formatBitcoinAmount('0.00000001')).toBe('0.00000001');
    });

    it('counts whole sats, grouped', () => {
        expect(satsFromBitcoin('0.00224512')).toBe('224,512');
        expect(satsFromBitcoin('1')).toBe('100,000,000');
        expect(satsFromBitcoin('abc')).toBe('0');
    });
});
