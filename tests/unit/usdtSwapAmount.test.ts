/**
 * The amount a USDT swap is for: the keypad, and the rules before a quote.
 *
 * What this protects:
 *   - The keypad cannot produce an amount the quote would refuse as malformed:
 *     no second point, no third decimal, no leading zeros.
 *   - An amount under the minimum is refused as BELOW_MINIMUM, the same code
 *     prepareUsdtConversion uses, before a destination is even asked for.
 *   - An amount over the balance is refused, and an unread balance lets the
 *     amount through for the quote step to check against the chain.
 */

import {
    SWAP_AMOUNT_TYPED_DECIMALS,
    applySwapAmountKey,
    checkSwapAmount,
    normalizeSwapAmount,
    type SwapAmountKey,
} from '../../src/services/tron/swapAmount';

const type = (keys: string, start = ''): string =>
    keys.split('').reduce((amount, key) => applySwapAmountKey(amount, (key === '<' ? 'back' : key) as SwapAmountKey), start);

describe('applySwapAmountKey', () => {
    it('builds an amount from digits and one point', () => {
        expect(type('150')).toBe('150');
        expect(type('150.25')).toBe('150.25');
        expect(type('1.5.0')).toBe('1.50');
    });

    it('stops at two decimals when typed', () => {
        expect(SWAP_AMOUNT_TYPED_DECIMALS).toBe(2);
        expect(type('10.999')).toBe('10.99');
    });

    it('starts a bare point as 0. and never keeps a leading zero', () => {
        expect(type('.5')).toBe('0.5');
        expect(type('0005')).toBe('5');
        expect(type('0')).toBe('0');
        expect(type('0.05')).toBe('0.05');
    });

    it('deletes one character at a time, and nothing from empty', () => {
        expect(type('150.2<<')).toBe('150');
        expect(type('<<')).toBe('');
    });

    it('caps the whole part at nine digits', () => {
        expect(type('12345678901')).toBe('123456789');
    });

    it('leaves a filled-in balance with six decimals alone, except for delete', () => {
        expect(applySwapAmountKey('152.301234', '5')).toBe('152.301234');
        expect(applySwapAmountKey('152.301234', 'back')).toBe('152.30123');
    });
});

describe('normalizeSwapAmount', () => {
    it('drops a trailing point and returns empty for nothing usable', () => {
        expect(normalizeSwapAmount('150.')).toBe('150');
        expect(normalizeSwapAmount('0.50')).toBe('0.5');
        expect(normalizeSwapAmount('')).toBe('');
    });
});

describe('checkSwapAmount', () => {
    const limits = { minimum: '100', balance: '152.301234' };

    it('treats nothing, a bare point and zero as empty', () => {
        expect(checkSwapAmount('', limits)).toEqual({ ok: false, code: 'EMPTY' });
        expect(checkSwapAmount('0.', limits)).toEqual({ ok: false, code: 'EMPTY' });
        expect(checkSwapAmount('0', limits)).toEqual({ ok: false, code: 'EMPTY' });
    });

    it('refuses under the minimum, with the minimum to show', () => {
        expect(checkSwapAmount('99.99', limits)).toEqual({ ok: false, code: 'BELOW_MINIMUM', minimum: '100' });
    });

    it('accepts the minimum itself and the whole balance', () => {
        expect(checkSwapAmount('100', limits)).toEqual({ ok: true });
        expect(checkSwapAmount('152.301234', limits)).toEqual({ ok: true });
    });

    it('refuses more than the balance, with the balance to show', () => {
        expect(checkSwapAmount('152.31', limits)).toEqual({ ok: false, code: 'INSUFFICIENT_USDT', balance: '152.301234' });
    });

    it('reports the minimum first when the balance is below it too', () => {
        expect(checkSwapAmount('50', { minimum: '100', balance: '7.06' })).toMatchObject({ code: 'BELOW_MINIMUM' });
    });

    it('lets an amount through when the balance could not be read', () => {
        expect(checkSwapAmount('5000', { minimum: '100', balance: null })).toEqual({ ok: true });
    });
});
