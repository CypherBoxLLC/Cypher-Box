/**
 * USDT amounts for display.
 *
 * Balances arrive as decimal strings with up to six places (see
 * getTronUsdtBalance). Two places are enough to read a balance by, and they
 * are truncated rather than rounded so the card never shows more than the
 * wallet can spend. Whole amounts drop the decimals: "1,000", not "1,000.00".
 */
export function formatUsdtAmount(decimal: string): string {
    const [rawWhole = '0', rawFraction = ''] = decimal.trim().split('.');
    const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0';
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const cents = rawFraction.slice(0, 2).padEnd(2, '0');
    return cents === '00' ? grouped : `${grouped}.${cents}`;
}
