/**
 * Hidden balances keep their unit and lose every figure, and a vault card's capsules are its largest five without
 * reordering the wallet's own list.
 */

import { HIDDEN_AMOUNT, maskAmount } from '../../src/helpers/hiddenAmount';
import { largestCapsules } from '../../src/helpers/vaultCardCapsules';

describe('maskAmount', () => {
    it.each([
        ['0.01234567 BTC', '*** BTC'],
        ['$1,234.56', '$***'],
        ['~ $3.10', '~ $***'],
        ['1 234 567 sats', '*** sats'],
        ['١٬٢٣٤٫٥ سات', '*** سات'],
        ['21', '***'],
        // the K or M goes too, or it would still tell the size
        ['1.43M sats ~ $845.80', '*** sats ~ $***'],
        ['5.86K sats', '*** sats'],
        ['‏1.43M سات ~ 845.80€', '‏*** سات ~ ***€'],
        ['+ Refreshing 120K sats', '+ Refreshing *** sats'],
    ])('%s → %s', (shown, hidden) => {
        expect(maskAmount(shown)).toBe(hidden);
    });

    it('is just *** for nothing, or text without figures', () => {
        expect(maskAmount(undefined)).toBe(HIDDEN_AMOUNT);
        expect(maskAmount(false)).toBe(HIDDEN_AMOUNT);
        expect(maskAmount('BTC')).toBe(HIDDEN_AMOUNT);
    });
});

describe('largestCapsules', () => {
    const capsule = (txid: string, amount: number, height = 800_000, vout = 0) => ({ txid, vout, height, value: amount, amount });

    it('takes the five largest, largest first', () => {
        const utxo = [capsule('a', 10), capsule('b', 500), capsule('c', 30), capsule('d', 7_000), capsule('e', 40), capsule('f', 600)];
        expect(largestCapsules(utxo).map((u) => u.amount)).toEqual([7_000, 600, 500, 40, 30]);
    });

    it('puts the older of two equal capsules first, an unconfirmed one last', () => {
        const utxo = [capsule('new', 100, 800_100), capsule('unconfirmed', 100, 0), capsule('old', 100, 800_000)];
        expect(largestCapsules(utxo).map((u) => u.txid)).toEqual(['old', 'new', 'unconfirmed']);
    });

    it('falls back to value when amount is missing', () => {
        const utxo = [{ txid: 'a', vout: 0, height: 1, value: 5 }, { txid: 'b', vout: 0, height: 1, value: 9 }];
        expect(largestCapsules(utxo).map((u) => u.txid)).toEqual(['b', 'a']);
    });

    it('does not reorder the wallet\'s own list', () => {
        const utxo = [capsule('a', 1), capsule('b', 2)];
        largestCapsules(utxo);
        expect(utxo.map((u) => u.txid)).toEqual(['a', 'b']);
    });

    it('is empty with no wallet', () => {
        expect(largestCapsules(undefined)).toEqual([]);
    });
});
