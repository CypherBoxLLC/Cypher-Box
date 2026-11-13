/**
 * The coin selection the wallet runs is the one a fee quote runs (class/wallets/coin-selection.ts).
 *
 * A change request (a target with neither address nor value) means "spend every UTXO given, as coin control does":
 * the remainder comes back as change when it is worth an output, and goes to the fee when it is not. Before, the
 * only way to ask for that was a split with a valueless change output, which coinselect refuses when the remainder
 * is small, and the fallback then left the smallest of the user's capsules unspent.
 */

import { inputScriptHint, isChangeRequest, outputScriptHint, selectCoins } from '../../class/wallets/coin-selection';

const bitcoin = require('bitcoinjs-lib');
const { HDSegwitBech32Wallet } = require('../../class');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PAYEE = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const RATE = 7;
const SEGWIT_INPUT = { length: 27 };
const P2WPKH_OUTPUT = { length: 25 };

const utxo = (i: number, value: number) => ({
    txid: bitcoin.crypto.sha256(Buffer.from(`coin-${i}`)).toString('hex'),
    vout: 0,
    value,
    script: SEGWIT_INPUT,
});
const pay = (value?: number) => (value === undefined ? { address: PAYEE, script: P2WPKH_OUTPUT } : { address: PAYEE, value, script: P2WPKH_OUTPUT });
const CHANGE = { address: '' };
// coinselect's sizes: 10 overhead, 68 per segwit input, 34 per P2WPKH output
const vbytes = (inputs: number, outputs: number) => 10 + inputs * 68 + outputs * 34;

describe('size hints', () => {
    it('sizes inputs by the wallet first address: native and wrapped segwit, else coinselect default', () => {
        expect(inputScriptHint('bc1qxyz')).toEqual({ length: 27 });
        expect(inputScriptHint('3Abc')).toEqual({ length: 50 });
        expect(inputScriptHint('1Abc')).toBeUndefined();
        expect(inputScriptHint(null)).toBeUndefined();
    });

    it('sizes bc1 outputs by their real script, taproot included', () => {
        expect(outputScriptHint(PAYEE)).toEqual({ length: 22 + 3 });
        expect(outputScriptHint(TAPROOT)).toEqual({ length: 34 + 3 });
        expect(outputScriptHint('36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV')).toBeUndefined();
        expect(outputScriptHint('')).toBeUndefined();
        expect(() => outputScriptHint('bc1qnotanaddress')).toThrow();
    });

    it('is what createTransaction puts on the capsules and targets it is given', () => {
        const w = new HDSegwitBech32Wallet();
        w.setSecret(MNEMONIC);
        const utxos = [{ ...utxo(1, 50_000), script: undefined, address: w._getExternalAddressByIndex(0) }];
        const targets = [{ address: TAPROOT, value: 20_000 }];
        w.createTransaction(utxos, targets, RATE, w._getInternalAddressByIndex(0));
        expect(utxos[0].script).toEqual(inputScriptHint(w._getExternalAddressByIndex(0)));
        expect((targets[0] as any).script).toEqual(outputScriptHint(TAPROOT));
    });
});

describe('a change request', () => {
    it('is a target with neither address nor value', () => {
        expect(isChangeRequest({ address: '' })).toBe(true);
        expect(isChangeRequest({} as any)).toBe(true);
        expect(isChangeRequest({ address: PAYEE })).toBe(false);
        expect(isChangeRequest({ address: '', value: 1000 })).toBe(false);
    });

    it('spends every UTXO and keeps a remainder worth an output as change', () => {
        const utxos = [utxo(1, 40_000), utxo(2, 30_000), utxo(3, 20_000), utxo(4, 1_200), utxo(5, 294)];
        const { inputs, outputs, fee } = selectCoins(utxos, [pay(50_000), CHANGE], RATE);
        expect(inputs).toHaveLength(5);
        expect(outputs).toHaveLength(2);
        expect(outputs![0]).toEqual(expect.objectContaining({ address: PAYEE, value: 50_000 }));
        // the change has no address: createTransaction gives it the wallet's change address
        expect(outputs![1].address).toBeUndefined();
        expect(fee).toBe(RATE * vbytes(5, 2));
        expect(outputs![1].value).toBe(91_494 - 50_000 - fee);
    });

    it('spends every UTXO when the remainder is too small for change, and the remainder goes to the fee', () => {
        const utxos = [utxo(1, 40_000), utxo(2, 30_000), utxo(3, 20_000), utxo(4, 1_200), utxo(5, 294)];
        // 500 sats over amount + fee with a change output: less than a change output is worth at 7 sat/vB
        const amount = 91_494 - RATE * vbytes(5, 2) - 500;
        const { inputs, outputs, fee } = selectCoins(utxos, [pay(amount), CHANGE], RATE);
        expect(inputs).toHaveLength(5);
        expect(outputs).toEqual([expect.objectContaining({ address: PAYEE, value: amount })]);
        expect(fee).toBe(91_494 - amount);

        // without the request coinselect needs only the three largest, and the two small capsules stay
        const plain = selectCoins(utxos, [pay(amount)], RATE);
        expect(plain.inputs!.map(i => i.value)).toEqual([40_000, 30_000, 20_000]);
    });

    it('still refuses an amount the UTXOs cannot pay with the fee', () => {
        const { inputs } = selectCoins([utxo(1, 40_000), utxo(2, 30_000)], [pay(70_000), CHANGE], RATE);
        expect(inputs).toBeUndefined();
    });

    it('alone, keeps its old meaning: everything goes to the change address', () => {
        const { inputs, outputs } = selectCoins([utxo(1, 40_000), utxo(2, 30_000)], [CHANGE as any], RATE);
        expect(inputs).toHaveLength(2);
        expect(outputs).toEqual([expect.objectContaining({ address: '', value: 70_000 - RATE * vbytes(2, 1) })]);
    });
});

describe('without a change request, as before', () => {
    it('sends the rest to a target without a value (MAX)', () => {
        const utxos = [utxo(1, 40_000), utxo(2, 294)];
        const { inputs, outputs, fee } = selectCoins(utxos, [pay()], RATE);
        expect(inputs).toHaveLength(2);
        expect(outputs).toEqual([expect.objectContaining({ address: PAYEE, value: 40_294 - fee })]);
        expect(fee).toBe(RATE * vbytes(2, 1));
    });

    it('lets coinselect pick for a fixed amount', () => {
        const utxos = [utxo(1, 400_000), utxo(2, 30_000), utxo(3, 20_000)];
        const { inputs } = selectCoins(utxos, [pay(50_000)], RATE);
        expect(inputs!.map(i => i.value)).toEqual([400_000]);
    });
});

describe('LegacyWallet.coinselect', () => {
    it('runs this selection, change request included', () => {
        const w = new HDSegwitBech32Wallet();
        const utxos = [utxo(1, 40_000), utxo(2, 30_000), utxo(3, 20_000), utxo(4, 1_200), utxo(5, 294)];
        const amount = 91_494 - RATE * vbytes(5, 2) - 500;
        const { inputs, outputs, fee } = w.coinselect(utxos, [pay(amount), CHANGE], RATE, 'bc1qchange');
        expect(inputs).toHaveLength(5);
        expect(outputs).toHaveLength(1);
        expect(fee).toBe(91_494 - amount);
        expect(() => w.coinselect([utxo(1, 1_000)], [pay(5_000), CHANGE], RATE, 'bc1qchange')).toThrow(/Not enough balance/);
    });
});
