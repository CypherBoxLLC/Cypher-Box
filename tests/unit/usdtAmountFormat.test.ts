import { formatUsdtAmount } from '../../src/services/tron/format';

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
