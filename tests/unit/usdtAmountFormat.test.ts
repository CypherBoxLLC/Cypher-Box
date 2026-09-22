import { formatUsdtAmount, formatUsdtExact } from '../../src/services/tron/format';

describe('formatUsdtExact', () => {
    it('keeps every decimal of an amount to be sent, so it never understates it', () => {
        expect(formatUsdtExact('107.234567')).toBe('107.234567');
        expect(formatUsdtExact('1234.5')).toBe('1,234.50');
    });

    it('drops trailing zeros and whole-amount decimals', () => {
        expect(formatUsdtExact('150')).toBe('150');
        expect(formatUsdtExact('150.000000')).toBe('150');
        expect(formatUsdtExact('100.100000')).toBe('100.10');
        expect(formatUsdtExact('0.000001')).toBe('0.000001');
    });
});

describe('formatUsdtAmount', () => {
    it('groups thousands and drops decimals on whole amounts', () => {
        expect(formatUsdtAmount('1000')).toBe('1,000');
        expect(formatUsdtAmount('1234567')).toBe('1,234,567');
        expect(formatUsdtAmount('0')).toBe('0');
        expect(formatUsdtAmount('100.000000')).toBe('100');
    });

    it('shows two decimals when there are any', () => {
        expect(formatUsdtAmount('7.06')).toBe('7.06');
        expect(formatUsdtAmount('7.1')).toBe('7.10');
        expect(formatUsdtAmount('1234.5')).toBe('1,234.50');
    });

    it('truncates rather than rounds, so it never overstates a balance', () => {
        expect(formatUsdtAmount('7.069999')).toBe('7.06');
        expect(formatUsdtAmount('0.009')).toBe('0');
        expect(formatUsdtAmount('999.999999')).toBe('999.99');
    });

    it('tolerates leading zeros and surrounding space', () => {
        expect(formatUsdtAmount('000123.4')).toBe('123.40');
        expect(formatUsdtAmount(' 42 ')).toBe('42');
    });
});
