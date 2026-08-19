/**
 * Vault sends must spend the capsules the user ticked.
 *
 * Before the fix, ColdStorage filtered the selection into `fUtxo` but only used
 * it for the displayed balance: both the fee pre-calc and createTransaction
 * received the UNFILTERED set. coinselect sorts descending and takes the
 * largest, so every vault send ignored the selection and broke open whatever
 * coin it liked, while the confirm screen showed change derived from the
 * selection. Those two can differ by orders of magnitude, and the change is
 * routed to a Strike or CoinOS deposit address.
 *
 * The second describe block is the part that actually demonstrates the money
 * behaviour: it runs the real wallet and shows the same targets producing a
 * DIFFERENT spent coin depending on whether the selection was applied.
 */

import { outpointKey, selectCapsules, selectedTotalSats } from '../../src/helpers/capsuleSelection';

const SMALL = { txid: 'aa'.repeat(32), vout: 0, value: 20_000 };
const LARGE = { txid: 'bb'.repeat(32), vout: 1, value: 500_000 };
const MID = { txid: 'cc'.repeat(32), vout: 0, value: 80_000 };
const ALL = [SMALL, LARGE, MID];

describe('selectCapsules', () => {
    it('returns exactly the ticked capsule, not the largest', () => {
        const picked = selectCapsules(ALL, [outpointKey(SMALL)]);
        expect(picked).toEqual([SMALL]);
    });

    it('keys on txid AND vout, so sibling outputs of one tx are distinguishable', () => {
        // A single funding tx paying the vault twice is ordinary. Keying on
        // txid alone would silently pull in the sibling output.
        const v0 = { txid: 'dd'.repeat(32), vout: 0, value: 10_000 };
        const v1 = { txid: 'dd'.repeat(32), vout: 1, value: 999_000 };
        const picked = selectCapsules([v0, v1], [outpointKey(v0)]);
        expect(picked).toEqual([v0]);
    });

    it('preserves the caller ordering of utxo, not the order ids were given in', () => {
        const picked = selectCapsules(ALL, [outpointKey(MID), outpointKey(SMALL)]);
        expect(picked).toEqual([SMALL, MID]);
    });

    it('returns empty for an empty selection, with no whole-wallet fallback', () => {
        // The dangerous case. Falling back to the full set here is what made
        // every send spend the wrong coin.
        expect(selectCapsules(ALL, [])).toEqual([]);
        expect(selectCapsules(ALL, null)).toEqual([]);
        expect(selectCapsules(ALL, undefined)).toEqual([]);
    });

    it('returns empty when there are no utxos at all', () => {
        expect(selectCapsules([], [outpointKey(SMALL)])).toEqual([]);
        expect(selectCapsules(null, [outpointKey(SMALL)])).toEqual([]);
    });

    it('ignores ids with no matching utxo instead of fabricating inputs', () => {
        // Stale selection: the coin was spent elsewhere since the picker
        // rendered. Narrowing the spend is safe; inventing an input is not.
        const picked = selectCapsules(ALL, [outpointKey(SMALL), 'ff'.repeat(32) + ':7']);
        expect(picked).toEqual([SMALL]);
    });

    it('never returns a coin the user did not tick', () => {
        const picked = selectCapsules(ALL, [outpointKey(SMALL), outpointKey(MID)]);
        expect(picked).not.toContainEqual(LARGE);
        expect(selectedTotalSats(picked)).toBe(100_000);
    });

    it('tolerates duplicate ids without duplicating the input', () => {
        // A double-tap in the picker must not double-spend the same outpoint
        // into the transaction.
        const picked = selectCapsules(ALL, [outpointKey(SMALL), outpointKey(SMALL)]);
        expect(picked).toEqual([SMALL]);
    });
});

describe('the spend actually follows the selection', () => {
    // Uses the real wallet so this asserts money behaviour, not just filtering.
    const { HDSegwitBech32Wallet } = require('../../class');

    function fundedWallet() {
        const w = new HDSegwitBech32Wallet();
        w.setSecret(
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        );
        return w;
    }

    function utxosFor(w: any) {
        const addr = w._getExternalAddressByIndex(0);
        return [
            { ...SMALL, address: addr, wif: w._getWifForAddress(addr), confirmations: 6, height: 1 },
            { ...LARGE, address: addr, wif: w._getWifForAddress(addr), confirmations: 6, height: 1 },
        ];
    }

    it('spends the LARGE coin when the selection is ignored, and the SMALL one when it is honoured', () => {
        const w = fundedWallet();
        const utxos = utxosFor(w);
        const target = [{ address: 'bc1qtmcfj7lvgjp866w8lytdpap82u7eege58jy52hp4ctk0hsncegyqel8prp', value: 10_000 }];
        const change = w._getInternalAddressByIndex(0);

        // Unfiltered: this is the pre-fix behaviour. coinselect sorts
        // descending and reaches for the biggest coin.
        const unfiltered = w.createTransaction(utxos, target, 1, change);
        const unfilteredInputs = unfiltered.psbt.txInputs.map((i: any) =>
            Buffer.from(i.hash).reverse().toString('hex'),
        );
        expect(unfilteredInputs).toContain(LARGE.txid);

        // Filtered to the user's pick: only the small coin can be spent.
        const picked = selectCapsules(utxos, [outpointKey(SMALL)]);
        const filtered = w.createTransaction(picked, target, 1, change);
        const filteredInputs = filtered.psbt.txInputs.map((i: any) =>
            Buffer.from(i.hash).reverse().toString('hex'),
        );
        expect(filteredInputs).toEqual([SMALL.txid]);
        expect(filteredInputs).not.toContain(LARGE.txid);
    });
});
