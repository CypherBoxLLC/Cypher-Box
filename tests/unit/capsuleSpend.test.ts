/**
 * Consolidate, Move to Cold and Move to Hot spend every capsule the user
 * selected, and the fee the review quotes is the fee the transaction pays.
 *
 * Measured on the v0.1.13 candidate with a 79-capsule bc1 Hot Vault: the review
 * quoted 82,152 sats, the signed consolidation had 63 of 79 inputs and paid
 * 30,706, and the 16 smallest capsules stayed behind (Cold to Hot: 49 of 61).
 * Two causes, both covered here against the real wallet classes:
 *   - the quote sized every input as legacy (148 vB) because only
 *     createTransaction tells coinselect an input is native segwit (68 vB);
 *   - "send everything" asked for a fixed amount, the total minus that inflated
 *     fee, which coinselect reached without the smallest capsules.
 */

import {
    capsulesBeyondNeed,
    describeBuiltSpend,
    estimatedVbytes,
    inputScriptHint,
    planCapsuleSpend,
    typedAmountSats,
} from '../../src/helpers/capsuleSpend';
import { outpointKey, selectCapsules, selectedTotalSats, withoutFrozen } from '../../src/helpers/capsuleSelection';
import { summarizePsbt } from '../../src/helpers/signedTransaction';

const bitcoin = require('bitcoinjs-lib');
// the real wallet classes, so this asserts what gets built and signed
const { HDSegwitBech32Wallet, WatchOnlyWallet } = require('../../class');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// someone else's P2WPKH address, the size a Cold Vault address has
const DESTINATION = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const RATE = 7;

// The heavy-wallet test's size bands, edge values included (46), plus 33 sizes
// spread from 300 sats to 30 BTC: 79 capsules, like the measured Hot Vault.
const BANDS = [
    294, 330, 546, 600, 777, 1000, 2100, 5000,
    9999, 21000, 50000, 64000, 99000, 99999,
    100000, 150000, 250000, 500000, 777777, 1000000, 1099999,
    1100000, 1500000, 1999999, 2000000, 2500000, 5000000, 9999999, 10999999,
    11000000, 15000000, 19999999, 20000000, 50000000, 75000000, 109999999,
    110000000, 150000000, 199999999, 200000000, 500000000, 1000000000, 1099999999,
    1100000000, 1500000000, 2100000000,
];
const SPREAD = Array.from({ length: 33 }, (_, i) => Math.round(300 * Math.pow(3e9 / 300, i / 32)));
const SIZES_79 = BANDS.concat(SPREAD);

const txidFor = (i: number) => bitcoin.crypto.sha256(Buffer.from(`capsule-${i}`)).toString('hex');

function hotVault() {
    const w = new HDSegwitBech32Wallet();
    w.setSecret(MNEMONIC);
    // 20 receive + 12 change addresses in use, so the capsules sit on 31 of them
    w.next_free_address_index = 20;
    w.next_free_change_address_index = 12;
    return w;
}

function coldVault() {
    const w = new WatchOnlyWallet();
    w.setSecret(hotVault().getXpub());
    w.init();
    w.setUseWithHardwareWalletEnabled(true);
    w._hdWalletInstance.next_free_address_index = 20;
    w._hdWalletInstance.next_free_change_address_index = 12;
    return w;
}

/** Capsules on 31 of the wallet's addresses, a third of them change. */
function capsulesFor(w: any, sizes: number[]) {
    return sizes.map((value, i) => {
        const onChange = i % 3 === 2;
        const address = onChange ? w._getInternalAddressByIndex(i % 11) : w._getExternalAddressByIndex(i % 20);
        return { txid: txidFor(i), txId: txidFor(i), vout: i % 4, value, address, confirmations: 6, height: 800000 + i };
    });
}

const ids = (utxos: { txid: string; vout: number }[]) => utxos.map(outpointKey);
const inputIdsOf = (psbt: any) => psbt.txInputs.map((i: any) => `${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}`);

describe('size hints', () => {
    it('sizes inputs the way createTransaction does, by the wallet first address', () => {
        expect(inputScriptHint('bc1qxyz')).toEqual({ length: 27 }); // 68 vB native segwit
        expect(inputScriptHint('3Abc')).toEqual({ length: 50 }); // 91 vB wrapped segwit
        expect(inputScriptHint('1Abc')).toBeUndefined(); // coinselect default, 148 vB legacy
        expect(inputScriptHint(undefined)).toBeUndefined();
    });

    it('counts vbytes like coinselect', () => {
        // 10 overhead, 41 + 27 per bc1 input, 9 + 25 per P2WPKH output
        expect(estimatedVbytes([{ script: { length: 27 } }], [{ script: { length: 25 } }])).toBe(10 + 68 + 34);
        expect(estimatedVbytes([{}], [{}])).toBe(10 + 148 + 34);
    });
});

describe('Consolidate and the moves: every selected capsule, one output', () => {
    const w = hotVault();
    const utxos = capsulesFor(w, SIZES_79);
    const total = selectedTotalSats(utxos);
    const firstAddress = w._getExternalAddressByIndex(0);

    it('spends all 79 mixed-size bc1 capsules when all are selected', () => {
        const { plan } = planCapsuleSpend({ mode: 'max', utxos, destination: DESTINATION, feeRate: RATE, firstAddress });
        expect(plan).toBeDefined();
        expect(plan!.inputs).toHaveLength(79);
        expect(new Set(ids(plan!.inputs))).toEqual(new Set(ids(utxos)));
        expect(plan!.changeSats).toBe(0);
        expect(plan!.amountSats + plan!.feeSats).toBe(total);
    });

    it('charges size x rate, with segwit inputs at 68 vB', () => {
        const { plan } = planCapsuleSpend({ mode: 'max', utxos, destination: DESTINATION, feeRate: RATE, firstAddress });
        expect(plan!.vbytes).toBe(10 + 79 * 68 + 34);
        expect(Math.abs(plan!.feeSats - plan!.vbytes * RATE)).toBeLessThanOrEqual(1);
    });

    it('builds exactly that transaction, and the signed one pays the requested rate', () => {
        const { plan } = planCapsuleSpend({ mode: 'max', utxos, destination: DESTINATION, feeRate: RATE, firstAddress });
        const change = w._getInternalAddressByIndex(12);
        const built = w.createTransaction(utxos, plan!.targets, RATE, change);

        expect(built.inputs).toHaveLength(79);
        expect(built.fee).toBe(plan!.feeSats);
        expect(built.outputs).toEqual([expect.objectContaining({ address: DESTINATION, value: plan!.amountSats })]);
        expect(describeBuiltSpend(built, DESTINATION)).toEqual({
            amountSats: plan!.amountSats,
            changeSats: 0,
            feeSats: plan!.feeSats,
            spentIds: expect.arrayContaining(ids(utxos)),
        });

        // coinselect's size is a slight overestimate of the real one, never an underestimate
        const vsize = built.tx.virtualSize();
        expect(vsize).toBeLessThanOrEqual(plan!.vbytes);
        expect(built.fee / vsize).toBeGreaterThanOrEqual(RATE);
        expect(built.fee / vsize).toBeLessThan(RATE * 1.01);
    });

    it('is what the old fixed-amount build got wrong', () => {
        // Fresh objects: createTransaction leaves its size hint on the capsules
        // it is given, which is why a second quote in the app came out right.
        const bare = capsulesFor(w, SIZES_79);
        // The old quote: coinselect on bare UTXOs, every input sized as legacy.
        // 82,152 sats is the figure the review showed in the heavy-wallet test.
        const legacyQuote = w.coinselect(bare, [{ address: DESTINATION }], RATE, w._getInternalAddressByIndex(12)).fee;
        expect(legacyQuote).toBe(RATE * (10 + 79 * 148 + 34));
        expect(legacyQuote).toBe(82_152);
        expect(legacyQuote / RATE / (10 + 79 * 68 + 34)).toBeGreaterThan(2.1);

        // The old build: total minus that quote as a fixed amount. coinselect
        // reaches it from the largest capsules down and leaves the smallest.
        const old = w.createTransaction(bare, [{ address: DESTINATION, value: total - legacyQuote }], RATE, w._getInternalAddressByIndex(12));
        // the same shape as the measurement: 63 of 79 in, 16 small capsules out
        expect(old.inputs).toHaveLength(63);
        const left = bare.filter(u => !old.inputs.some((i: any) => i.txid === u.txid && i.vout === u.vout));
        expect(left).toHaveLength(16);
        expect(left.every(u => u.value < 20_000)).toBe(true);
        expect(left.map(u => u.value)).toContain(Math.min(...SIZES_79));
    });

    it('MAX and a fixed amount spend the same capsules; the fixed one adds a change output', () => {
        const max = planCapsuleSpend({ mode: 'max', utxos, destination: DESTINATION, feeRate: RATE, firstAddress }).plan!;
        const fixed = planCapsuleSpend({ mode: 'exact', utxos, destination: DESTINATION, amountSats: 100_000_000, feeRate: RATE, firstAddress }).plan!;
        expect(ids(fixed.inputs).sort()).toEqual(ids(max.inputs).sort());
        expect(max.targets).toEqual([{ address: DESTINATION }]);
        expect(fixed.amountSats).toBe(100_000_000);
        // one more output, 34 vB at the same rate
        expect(fixed.feeSats - max.feeSats).toBe(34 * RATE);
        expect(fixed.changeSats).toBe(total - 100_000_000 - fixed.feeSats);
    });
});

describe('Move to Hot: the Cold Vault PSBT for the signing device', () => {
    const cold = coldVault();
    const utxos = capsulesFor(cold, SIZES_79.slice(0, 61));
    const firstAddress = cold._getExternalAddressByIndex(0);
    const change = cold._getInternalAddressByIndex(12);

    it('puts all 61 selected capsules in the PSBT, at the quoted fee', () => {
        const { plan } = planCapsuleSpend({ mode: 'max', utxos, destination: DESTINATION, feeRate: RATE, firstAddress });
        const { psbt, fee } = cold.createTransaction(utxos, plan!.targets, RATE, change, HDSegwitBech32Wallet.defaultRBFSequence);
        expect(psbt.txInputs).toHaveLength(61);
        expect(new Set(inputIdsOf(psbt))).toEqual(new Set(ids(utxos)));
        expect(fee).toBe(plan!.feeSats);
        expect(psbt.txOutputs.map((o: any) => o.value)).toEqual([plan!.amountSats]);
    });

    it('a fixed amount keeps the change output marked as the vault own, for the device', () => {
        const amount = 50_000_000;
        const { plan } = planCapsuleSpend({ mode: 'exact', utxos, destination: DESTINATION, amountSats: amount, feeRate: RATE, firstAddress });
        const { psbt, fee, outputs } = cold.createTransaction(utxos, plan!.targets, RATE, change, HDSegwitBech32Wallet.defaultRBFSequence);
        expect(psbt.txInputs).toHaveLength(61);
        expect(fee).toBe(plan!.feeSats);
        expect(psbt.txOutputs.map((o: any) => [o.address, o.value])).toEqual([
            [DESTINATION, amount],
            [change, plan!.changeSats],
        ]);
        // the signing device recognises change by its derivation path
        expect(psbt.data.outputs[0].bip32Derivation ?? []).toHaveLength(0);
        expect(psbt.data.outputs[1].bip32Derivation).toHaveLength(1);
        expect(describeBuiltSpend({ inputs: plan!.inputs, outputs, fee }, DESTINATION).changeSats).toBe(plan!.changeSats);
    });

    it('the signing screen reads the review figures back from the PSBT', () => {
        for (const ask of [
            { mode: 'max' as const },
            { mode: 'exact' as const, amountSats: 50_000_000 },
        ]) {
            const { plan } = planCapsuleSpend({ ...ask, utxos, destination: DESTINATION, feeRate: RATE, firstAddress });
            const { psbt } = cold.createTransaction(utxos, plan!.targets, RATE, change, HDSegwitBech32Wallet.defaultRBFSequence);
            expect(summarizePsbt(psbt, DESTINATION)).toEqual({ amountSats: plan!.amountSats, changeSats: plan!.changeSats, fee: plan!.feeSats, inputs: 61 });
            // the same from the base64 a resumed signing keeps
            expect(summarizePsbt(psbt.toBase64(), DESTINATION).fee).toBe(plan!.feeSats);
        }
    });
});

describe('a wrapped segwit (ypub) Cold Vault', () => {
    it('is sized the way its createTransaction sizes it, 91 vB an input', () => {
        const { HDSegwitP2SHWallet } = require('../../class');
        const hd = new HDSegwitP2SHWallet();
        hd.setSecret(MNEMONIC);
        const cold = new WatchOnlyWallet();
        cold.setSecret(hd.getXpub());
        cold.init();
        cold.setUseWithHardwareWalletEnabled(true);
        const firstAddress = cold._getExternalAddressByIndex(0);
        expect(firstAddress.startsWith('3')).toBe(true);
        const utxos = SIZES_79.slice(20, 30).map((value, i) => ({
            txid: txidFor(500 + i),
            vout: 0,
            value,
            address: cold._getExternalAddressByIndex(i % 5),
        }));
        const { plan } = planCapsuleSpend({ mode: 'max', utxos, destination: DESTINATION, feeRate: RATE, firstAddress });
        expect(plan!.vbytes).toBe(10 + 10 * 91 + 34);
        const { psbt, fee } = cold.createTransaction(utxos, plan!.targets, RATE, cold._getInternalAddressByIndex(0), HDSegwitBech32Wallet.defaultRBFSequence);
        expect(psbt.txInputs).toHaveLength(10);
        expect(fee).toBe(plan!.feeSats);
    });
});

describe('a fixed amount from ticked capsules (Send, Top-up, an edited Consolidate)', () => {
    const w = hotVault();
    const utxos = capsulesFor(w, SIZES_79);
    const total = selectedTotalSats(utxos);
    const firstAddress = w._getExternalAddressByIndex(0);
    const change = w._getInternalAddressByIndex(12);

    it('spends every ticked capsule and returns the rest as the change the review shows', () => {
        const { plan } = planCapsuleSpend({ mode: 'exact', utxos, destination: DESTINATION, amountSats: 100_000_000, feeRate: RATE, firstAddress });
        const built = w.createTransaction(utxos, plan!.targets, RATE, change);
        expect(built.inputs).toHaveLength(79);
        expect(built.fee).toBe(plan!.feeSats);
        expect(Math.abs(plan!.feeSats - plan!.vbytes * RATE)).toBeLessThanOrEqual(1);
        expect(built.outputs.map((o: any) => [o.address, o.value])).toEqual([
            [DESTINATION, 100_000_000],
            [change, total - 100_000_000 - plan!.feeSats],
        ]);
        expect(describeBuiltSpend(built, DESTINATION)).toEqual(expect.objectContaining({ amountSats: 100_000_000, changeSats: plan!.changeSats, feeSats: plan!.feeSats }));
    });

    it('pays a remainder too small for a change output to the fee, still from every capsule', () => {
        const few = capsulesFor(w, [40_000, 30_000, 20_000]);
        const feeWithChange = RATE * (10 + 3 * 68 + 34 + 34);
        // 500 sats over amount + fee: below the 148 vB x rate a change output needs
        const amount = 90_000 - feeWithChange - 500;
        const { plan } = planCapsuleSpend({ mode: 'exact', utxos: few, destination: DESTINATION, amountSats: amount, feeRate: RATE, firstAddress });
        expect(plan!.inputs).toHaveLength(3);
        expect(plan!.changeSats).toBe(0);
        expect(plan!.amountSats).toBe(amount);
        expect(plan!.feeSats).toBe(90_000 - amount);
        const built = w.createTransaction(few, plan!.targets, RATE, change);
        expect(built.inputs).toHaveLength(3);
        expect(built.outputs).toHaveLength(1);
        expect(built.fee).toBe(plan!.feeSats);
    });

    it('spends the small capsules too when what is left is too small for change', () => {
        // coinselect alone would cover this from the three large capsules and leave 1,200 and 294 sats behind
        const ticked = capsulesFor(w, [40_000, 30_000, 20_000, 1_200, 294]);
        const amount = 91_494 - RATE * (10 + 5 * 68 + 34 + 34) - 500;
        const { plan } = planCapsuleSpend({ mode: 'exact', utxos: ticked, destination: DESTINATION, amountSats: amount, feeRate: RATE, firstAddress });
        expect(plan!.inputs).toHaveLength(5);
        expect(plan!.changeSats).toBe(0);
        expect(plan!.amountSats).toBe(amount);
        expect(plan!.feeSats).toBe(91_494 - amount);
        const built = w.createTransaction(ticked, plan!.targets, RATE, change);
        expect(new Set(ids(built.inputs))).toEqual(new Set(ids(ticked)));
        expect(built.outputs).toEqual([expect.objectContaining({ address: DESTINATION, value: amount })]);
        expect(built.fee).toBe(plan!.feeSats);
    });

    it('reports a selection that cannot cover the amount and fee', () => {
        const few = capsulesFor(w, [40_000, 30_000]);
        expect(planCapsuleSpend({ mode: 'exact', utxos: few, destination: DESTINATION, amountSats: 70_000, feeRate: RATE, firstAddress }).error).toBe('insufficient');
        expect(planCapsuleSpend({ mode: 'max', utxos: capsulesFor(w, [500]), destination: DESTINATION, feeRate: RATE, firstAddress }).error).toBe('insufficient');
    });
});

describe('ticking more capsules than the amount needs', () => {
    const w = hotVault();
    const utxos = capsulesFor(w, SIZES_79);
    const total = selectedTotalSats(utxos);
    const firstAddress = w._getExternalAddressByIndex(0);
    const request = { utxos, destination: DESTINATION, feeRate: RATE, firstAddress };

    it('says how many would do and what the rest add to the fee', () => {
        const ask = { ...request, mode: 'exact' as const, amountSats: 100_000_000 };
        const { plan } = planCapsuleSpend(ask);
        const beyond = capsulesBeyondNeed(plan, ask);
        const least = planCapsuleSpend({ ...ask, mode: 'pool' }).plan!;
        expect(plan!.inputs).toHaveLength(79);
        expect(beyond).toEqual({ needed: least.inputs.length, extraFeeSats: plan!.feeSats - least.feeSats });
        expect(beyond!.needed).toBeLessThan(79);
        expect(beyond!.extraFeeSats).toBeGreaterThan(0);
    });

    it('counts a capsule worth less than its own input fee as not needed', () => {
        // at 7 sat/vB a 68 vB input costs 476 sats: the 294-sat capsule never pays for itself
        const ask = { ...request, mode: 'exact' as const, amountSats: total - 400_000 };
        const beyond = capsulesBeyondNeed(planCapsuleSpend(ask).plan, ask);
        expect(beyond).not.toBeNull();
        expect(beyond!.needed).toBeLessThan(79);
    });

    it('says nothing when every ticked capsule is needed', () => {
        const few = capsulesFor(w, [40_000, 30_000, 20_000]);
        const ask = { ...request, utxos: few, mode: 'exact' as const, amountSats: 85_000 };
        const { plan } = planCapsuleSpend(ask);
        expect(plan!.inputs).toHaveLength(3);
        expect(capsulesBeyondNeed(plan, ask)).toBeNull();
    });

    it('says nothing for Max and for a pre-selection the app made', () => {
        const max = { ...request, mode: 'max' as const };
        expect(capsulesBeyondNeed(planCapsuleSpend(max).plan, max)).toBeNull();
        const pool = { ...request, mode: 'pool' as const, amountSats: 100_000_000 };
        expect(capsulesBeyondNeed(planCapsuleSpend(pool).plan, pool)).toBeNull();
        expect(capsulesBeyondNeed(undefined, { ...request, mode: 'exact', amountSats: 1_000 })).toBeNull();
    });
});

describe('a fixed amount from capsules the app pre-selected (Home scan)', () => {
    const w = hotVault();
    const utxos = capsulesFor(w, SIZES_79);
    const firstAddress = w._getExternalAddressByIndex(0);
    const change = w._getInternalAddressByIndex(12);

    it('lets coinselect pick, and quotes the capsules, change and fee it really uses', () => {
        const { plan } = planCapsuleSpend({ mode: 'pool', utxos, destination: DESTINATION, amountSats: 100_000_000, feeRate: RATE, firstAddress });
        expect(plan!.inputs.length).toBeLessThan(79);
        const built = w.createTransaction(utxos, plan!.targets, RATE, change);
        expect(ids(built.inputs).sort()).toEqual(ids(plan!.inputs).sort());
        expect(built.fee).toBe(plan!.feeSats);
        expect(describeBuiltSpend(built, DESTINATION)).toEqual(expect.objectContaining({ amountSats: 100_000_000, changeSats: plan!.changeSats }));
    });
});

describe('frozen capsules', () => {
    const w = hotVault();
    const utxos = capsulesFor(w, [5_000_000, 20_000, 30_000]);
    const [big] = utxos;
    w.setUTXOMetadata(big.txid, big.vout, { frozen: true });
    const isFrozen = (u: { txid: string; vout: number }) => !!w.getUTXOMetadata(u.txid, u.vout).frozen;
    const firstAddress = w._getExternalAddressByIndex(0);

    it('are left out of a pre-selection the app made, even when coinselect would want them', () => {
        const pool = withoutFrozen(utxos, isFrozen);
        expect(pool).toHaveLength(2);
        const { plan } = planCapsuleSpend({ mode: 'pool', utxos: pool, destination: DESTINATION, amountSats: 30_000, feeRate: RATE, firstAddress });
        expect(ids(plan!.inputs)).not.toContain(outpointKey(big));
        // without the filter the largest (frozen) capsule is the one picked
        const unfiltered = planCapsuleSpend({ mode: 'pool', utxos, destination: DESTINATION, amountSats: 30_000, feeRate: RATE, firstAddress });
        expect(ids(unfiltered.plan!.inputs)).toEqual([outpointKey(big)]);
    });

    it('are spent when the user ticked them', () => {
        const ticked = selectCapsules(utxos, [outpointKey(big)]);
        const { plan } = planCapsuleSpend({ mode: 'max', utxos: ticked, destination: DESTINATION, feeRate: RATE, firstAddress });
        expect(ids(plan!.inputs)).toEqual([outpointKey(big)]);
    });

    it('withoutFrozen tolerates a missing list', () => {
        expect(withoutFrozen(null, isFrozen)).toEqual([]);
        expect(withoutFrozen(undefined, isFrozen)).toEqual([]);
    });
});

describe('refusals', () => {
    const w = hotVault();
    const utxos = capsulesFor(w, [40_000, 30_000]);
    const firstAddress = w._getExternalAddressByIndex(0);
    const base = { utxos, destination: DESTINATION, feeRate: RATE, firstAddress };

    it('needs capsules, a whole fee rate of at least 1, an amount and a valid destination', () => {
        expect(planCapsuleSpend({ ...base, mode: 'max', utxos: [] }).error).toBe('no_capsules');
        expect(planCapsuleSpend({ ...base, mode: 'max', utxos: null }).error).toBe('no_capsules');
        expect(planCapsuleSpend({ ...base, mode: 'max', feeRate: 2.5 }).error).toBe('fee_rate');
        expect(planCapsuleSpend({ ...base, mode: 'max', feeRate: 0 }).error).toBe('fee_rate');
        expect(planCapsuleSpend({ ...base, mode: 'exact', amountSats: null }).error).toBe('amount');
        expect(planCapsuleSpend({ ...base, mode: 'pool', amountSats: 0 }).error).toBe('amount');
        expect(planCapsuleSpend({ ...base, mode: 'exact', amountSats: 1000.5 }).error).toBe('amount');
        expect(planCapsuleSpend({ ...base, mode: 'max', destination: '' }).error).toBe('destination');
        expect(planCapsuleSpend({ ...base, mode: 'max', destination: 'bc1qnotanaddress' }).error).toBe('destination');
    });

    it('does not touch the capsules it is given', () => {
        const before = JSON.stringify(utxos);
        planCapsuleSpend({ ...base, mode: 'exact', amountSats: 10_000 });
        expect(JSON.stringify(utxos)).toBe(before);
    });
});

describe('typedAmountSats', () => {
    it('takes the BTC figure exactly', () => {
        expect(typedAmountSats('0.00123456', '117.28', 95_000)).toBe(123_456);
        expect(typedAmountSats('1', '95000', 95_000)).toBe(100_000_000);
        expect(typedAmountSats('.5', '', 95_000)).toBe(50_000_000);
        expect(typedAmountSats(0.1, '', 95_000)).toBe(10_000_000);
    });

    it('falls back to fiat at the rate, rounded to the sat', () => {
        expect(typedAmountSats('', '95', 95_000)).toBe(100_000);
        expect(typedAmountSats(undefined, 47.5, '95000')).toBe(50_000);
    });

    it('is null for nothing usable', () => {
        expect(typedAmountSats('', '', 95_000)).toBeNull();
        expect(typedAmountSats('0', '0', 95_000)).toBeNull();
        expect(typedAmountSats('abc', '10', 0)).toBeNull();
    });
});
