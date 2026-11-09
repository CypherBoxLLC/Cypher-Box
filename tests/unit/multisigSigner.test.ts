/**
 * Signing as one key of a native SegWit multisig: only for a registered wallet, with change checked against it, and
 * never blind. The transactions, sighashes and signatures in fixtures/multisig-signer were made with rust-bitcoin,
 * rust-miniscript and libsecp256k1 (see its generator), not with the code under test, the way a coordinator such as
 * Sparrow or Nunchuk fills them (Bitcoin Core's descriptor code fills Nunchuk's). All keys come from public BIP39 test
 * phrases; the signer's seed is "abandon ... about".
 */

import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { HDSegwitBech32Wallet, MultisigHDWallet } from '../../class';
import { SignerWallet, parseWalletFile, policyAddress, policyKeyPubkey, policyWitnessScript } from '../../src/helpers/multisigPolicy';
import {
    SIGN_BACKUP_MISMATCH,
    SIGN_FALSE_CHANGE,
    SIGN_INPUT_DETAILS,
    SIGN_MIXED_WALLETS,
    SIGN_MULTISIG_HOT_VAULT,
    SIGN_NOTHING_SIGNED,
    SIGN_UNKNOWN_MULTISIG,
    SIGN_UNSUPPORTED_MULTISIG,
    assertBackupMatches,
    assertMultisigRegistered,
    assertSingleKeyOnly,
    isMultisigTransaction,
    reviewWithRoot,
    reviewWithWallet,
    rootFromBackup,
    signWithRoot,
    signingKeyForWallet,
} from '../../src/helpers/signOnce';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OZONE = 'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic';
const PAYEE = 'bc1qhu8jqyzfazgatpctqn44xr7pdd3mdx6qy2r6xa';
const OURS = '73c5da0a';
const LEGAL_FP = 'b8688df1';

const registered = (descriptor: string, name: string, own = OURS): SignerWallet => ({
    ...parseWalletFile(descriptor),
    name,
    ownFingerprint: own,
    addedAt: 0,
});
const W1 = registered(fixtures.wallets.w1.descriptor, 'Family vault');
const W2 = registered(fixtures.wallets.w2.descriptor, 'Other wallet');
const W3 = registered(fixtures.wallets.w3.descriptor, 'Mixed paths');
const W4 = registered(fixtures.wallets.w4.descriptor, 'Three of four');
const W5 = registered(fixtures.wallets.w5.descriptor, 'With passphrase', 'b4e3f5ed');

const root = rootFromBackup(ABANDON);
const psbtOf = (name: string) => bitcoin.Psbt.fromHex(fixtures.psbts[name].unsignedHex);
const fixtureSigs = (name: string, fingerprint: string) =>
    (name === 'w1SpendNonWitness' ? fixtures.w1SpendNonWitness : fixtures.psbts[name]).signatures[fingerprint];

const sigFor = (psbt: bitcoin.Psbt, i: number, pubkey: string) =>
    (psbt.data.inputs[i].partialSig ?? []).find(s => Buffer.from(s.pubkey).toString('hex') === pubkey);

/** Adds a signature an independent cosigner made, from the fixtures. */
const addCosignature = (psbt: bitcoin.Psbt, name: string, fingerprint: string) =>
    fixtureSigs(name, fingerprint).forEach((s: any, i: number) =>
        psbt.updateInput(i, { partialSig: [{ pubkey: Buffer.from(s.pubkey, 'hex'), signature: Buffer.from(s.signature, 'hex') }] }),
    );

const validate = (psbt: bitcoin.Psbt) =>
    psbt.validateSignaturesOfAllInputs((pubkey, msghash, signature) => ecc.verify(msghash, pubkey, signature));

/** Every derivation of the signer's fingerprint rewritten as 00000000, as a coordinator that only had the xpub writes. */
const withUnknownFingerprint = (psbt: bitcoin.Psbt) => {
    for (const part of [...psbt.data.inputs, ...psbt.data.outputs]) {
        for (const d of part.bip32Derivation ?? []) {
            if (Buffer.from(d.masterFingerprint).toString('hex') === OURS) d.masterFingerprint = Buffer.alloc(4);
        }
    }
    return psbt;
};

/** An input of a registered wallet at branch/index, filled the way coordinators fill one (built for refusal tests). */
const multisigInput = (wallet: SignerWallet, branch: number, index: number, value: number, byte: number) => {
    const witnessScript = policyWitnessScript(wallet, branch, index);
    return {
        hash: Buffer.alloc(32, byte),
        index: 0,
        witnessUtxo: { script: bitcoin.payments.p2wsh({ redeem: { output: witnessScript } }).output as Buffer, value },
        witnessScript,
        bip32Derivation: wallet.keys.map(k => ({
            masterFingerprint: Buffer.from(k.fingerprint, 'hex'),
            path: `${k.path}/${branch}/${index}`,
            pubkey: policyKeyPubkey(k, branch, index),
        })),
    };
};

/** A single-key P2WPKH input of the signer's own m/84' account. */
const singleKeyInput = (value: number, byte: number) => {
    const path = "m/84'/0'/0'/0/0";
    const pubkey = Buffer.from(root.derivePath(path).publicKey);
    return {
        hash: Buffer.alloc(32, byte),
        index: 0,
        witnessUtxo: { script: bitcoin.payments.p2wpkh({ pubkey }).output as Buffer, value },
        bip32Derivation: [{ masterFingerprint: Buffer.from(OURS, 'hex'), path, pubkey }],
    };
};

describe('reviewing a multisig spend', () => {
    it('names the wallet, checks change against it and shows the fee', () => {
        expect(reviewWithRoot(psbtOf('w1Spend'), root, [W1, W4])).toEqual({
            outputs: [
                { address: PAYEE, value: 120_000, change: false },
                { address: fixtures.wallets.w1.addresses.change5, value: 29_400, change: true },
            ],
            fee: 600,
            inputCount: 2,
            ownInputs: 2,
            multisig: { id: W1.id, name: 'Family vault', m: 2, n: 3 },
        });
    });

    it('reviews a spend with no change', () => {
        const review = reviewWithRoot(psbtOf('w1Sweep'), root, [W1]);
        expect(review.outputs).toEqual([{ address: PAYEE, value: 79_000, change: false }]);
        expect(review.fee).toBe(1_000);
    });

    it("takes the amounts from the previous transactions when that's all the inputs carry, as Nunchuk fills them", () => {
        const psbt = bitcoin.Psbt.fromHex(fixtures.w1SpendNonWitness.unsignedHex);
        expect(psbt.data.inputs[0].witnessUtxo).toBeUndefined();
        expect(Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex')).toBe(fixtures.w1SpendNonWitness.prevTxids[0]);
        const review = reviewWithRoot(psbt, root, [W1]);
        expect(review.fee).toBe(800);
        expect(review.outputs.map(o => o.change)).toEqual([false, true]);
        expect(review.multisig?.id).toBe(W1.id);
    });

    it('reads wallets with mixed paths and other quorums', () => {
        const mixed = reviewWithRoot(psbtOf('w3Spend'), root, [W1, W3]);
        expect(mixed.multisig).toEqual({ id: W3.id, name: 'Mixed paths', m: 2, n: 3 });
        expect(mixed.outputs.map(o => o.change)).toEqual([false, true]);
        expect(reviewWithRoot(psbtOf('w4Spend'), root, [W4]).multisig).toEqual({ id: W4.id, name: 'Three of four', m: 3, n: 4 });
    });

    it('needs the passphrase the key was made with', () => {
        expect(() => assertBackupMatches(psbtOf('w5Spend'), root)).toThrow(SIGN_BACKUP_MISMATCH);
        const withPassphrase = rootFromBackup(ABANDON, 'TREZOR');
        assertBackupMatches(psbtOf('w5Spend'), withPassphrase);
        expect(reviewWithRoot(psbtOf('w5Spend'), withPassphrase, [W5]).outputs.map(o => o.change)).toEqual([false, true]);
    });

    it('recognises this key when the coordinator wrote 00000000 for its fingerprint', () => {
        const review = reviewWithRoot(withUnknownFingerprint(psbtOf('w1Spend')), root, [W1]);
        expect(review.ownInputs).toBe(2);
        expect(review.outputs.map(o => o.change)).toEqual([false, true]);
    });
});

describe('signing a multisig spend', () => {
    it('makes the signatures libsecp256k1 makes, over the sighash rust-bitcoin computes', () => {
        const { psbt, signed } = signWithRoot(psbtOf('w1Spend'), root, [W1]);
        expect(signed).toBe(2);
        fixtureSigs('w1Spend', OURS).forEach((expected: any, i: number) => {
            const sig = sigFor(psbt, i, expected.pubkey);
            expect(sig).toBeDefined();
            expect(Buffer.from(sig!.signature).toString('hex')).toBe(expected.signature);
            const der = bitcoin.script.signature.decode(Buffer.from(sig!.signature)).signature;
            expect(ecc.verify(Buffer.from(expected.sighash, 'hex'), Buffer.from(expected.pubkey, 'hex'), der)).toBe(true);
            // nothing else was added
            expect(psbt.data.inputs[i].partialSig).toHaveLength(1);
        });
        // left for the coordinator to combine and finalize
        expect(psbt.data.inputs.every(i => !i.finalScriptWitness)).toBe(true);
    });

    it('gives, with the second key’s signature, the transaction rust-miniscript finalized', () => {
        const { psbt } = signWithRoot(psbtOf('w1Spend'), root, [W1]);
        addCosignature(psbt, 'w1Spend', LEGAL_FP);
        expect(validate(psbt)).toBe(true);
        const tx = psbt.finalizeAllInputs().extractTransaction();
        expect(tx.toHex()).toBe(fixtures.w1SpendFinal.tx);
        expect(tx.getId()).toBe(fixtures.w1SpendFinal.txid);
    });

    it('signs after another cosigner and keeps that signature', () => {
        const partly = psbtOf('w1Spend');
        addCosignature(partly, 'w1Spend', LEGAL_FP);
        const { psbt, signed } = signWithRoot(partly, root, [W1]);
        expect(signed).toBe(2);
        expect(psbt.data.inputs.map(i => i.partialSig?.length)).toEqual([2, 2]);
        expect(psbt.finalizeAllInputs().extractTransaction().toHex()).toBe(fixtures.w1SpendFinal.tx);
    });

    it('adds nothing to a transaction this key has signed already', () => {
        const once = signWithRoot(psbtOf('w1Spend'), root, [W1]).psbt;
        const before = once.toBase64();
        expect(() => signWithRoot(once, root, [W1])).toThrow(SIGN_NOTHING_SIGNED);
        expect(once.toBase64()).toBe(before);
    });

    it('signs the Nunchuk-style spend over the amount in the previous transaction', () => {
        const { psbt, signed } = signWithRoot(bitcoin.Psbt.fromHex(fixtures.w1SpendNonWitness.unsignedHex), root, [W1]);
        expect(signed).toBe(1);
        const [expected] = fixtureSigs('w1SpendNonWitness', OURS);
        expect(Buffer.from(sigFor(psbt, 0, expected.pubkey)!.signature).toString('hex')).toBe(expected.signature);
    });

    it('signs for mixed paths, 3 of 4, a passphrase, and a 00000000 fingerprint', () => {
        for (const [name, key, wallets] of [
            ['w3Spend', root, [W3]],
            ['w4Spend', root, [W4]],
            ['w5Spend', rootFromBackup(ABANDON, 'TREZOR'), [W5]],
        ] as const) {
            const { psbt } = signWithRoot(psbtOf(name), key, [...wallets]);
            const [expected] = fixtureSigs(name, Buffer.from(key.fingerprint).toString('hex'));
            expect(Buffer.from(sigFor(psbt, 0, expected.pubkey)!.signature).toString('hex')).toBe(expected.signature);
        }
        const { psbt } = signWithRoot(withUnknownFingerprint(psbtOf('w1Spend')), root, [W1]);
        expect(validate(psbt)).toBe(true);
    });

    it('does not touch the transaction it was given', () => {
        const original = psbtOf('w1Spend');
        const before = original.toBase64();
        signWithRoot(original, root, [W1]);
        expect(original.toBase64()).toBe(before);
    });
});

describe('refusing', () => {
    it('a multisig the signer has not registered, before the SeedQR and after', () => {
        const psbt = psbtOf('w2Spend');
        expect(isMultisigTransaction(psbt)).toBe(true);
        expect(() => assertMultisigRegistered(psbt, [W1])).toThrow(SIGN_UNKNOWN_MULTISIG);
        expect(() => reviewWithRoot(psbt, root, [W1])).toThrow(SIGN_UNKNOWN_MULTISIG);
        expect(() => signWithRoot(psbt, root, [W1])).toThrow(SIGN_UNKNOWN_MULTISIG);
        // once registered it's fine
        assertMultisigRegistered(psbt, [W1, W2]);
        expect(reviewWithRoot(psbt, root, [W1, W2]).multisig?.id).toBe(W2.id);
    });

    it('every multisig spend while no wallet is registered, with change or without', () => {
        for (const name of ['w1Spend', 'w1Sweep']) {
            expect(() => assertMultisigRegistered(psbtOf(name), [])).toThrow(SIGN_UNKNOWN_MULTISIG);
            expect(() => reviewWithRoot(psbtOf(name), root)).toThrow(SIGN_UNKNOWN_MULTISIG);
            expect(() => signWithRoot(psbtOf(name), root)).toThrow(SIGN_UNKNOWN_MULTISIG);
        }
    });

    it('change paid to another multisig that has this key in it, registered or not', () => {
        const psbt = psbtOf('w1ChangeToW2');
        expect(() => reviewWithRoot(psbt, root, [W1])).toThrow(SIGN_FALSE_CHANGE);
        expect(() => reviewWithRoot(psbt, root, [W1, W2])).toThrow(SIGN_FALSE_CHANGE);
        expect(() => signWithRoot(psbt, root, [W1, W2])).toThrow(SIGN_FALSE_CHANGE);
    });

    it('change whose path, public key or script do not agree with the wallet', () => {
        const changeAt = (psbt: bitcoin.Psbt, edit: (d: any) => void) => {
            const ours = psbt.data.outputs[1].bip32Derivation!.find(d => Buffer.from(d.masterFingerprint).toString('hex') === OURS);
            edit(ours);
            return psbt;
        };
        const sixth = `${W1.keys[0].path}/1/6`;
        // path and key for /1/6, script for /1/5
        const moved = changeAt(psbtOf('w1Spend'), d => {
            d.path = sixth;
            d.pubkey = Buffer.from(root.derivePath(sixth).publicKey);
        });
        expect(() => reviewWithRoot(moved, root, [W1])).toThrow(SIGN_FALSE_CHANGE);
        // a path outside the wallet's key
        const outside = changeAt(psbtOf('w1Spend'), d => {
            d.path = "m/84'/0'/0'/1/5";
            d.pubkey = Buffer.from(root.derivePath(d.path).publicKey);
        });
        expect(() => reviewWithRoot(outside, root, [W1])).toThrow(SIGN_FALSE_CHANGE);
        // the change's witness script for another index
        const script = psbtOf('w1Spend');
        script.data.outputs[1].witnessScript = policyWitnessScript(W1, 1, 6);
        expect(() => reviewWithRoot(script, root, [W1])).toThrow(SIGN_FALSE_CHANGE);
    });

    it('an input whose witness script is not what its coin pays, or not the wallet’s at its path', () => {
        const swapped = psbtOf('w1Spend');
        swapped.data.inputs[0].witnessScript = policyWitnessScript(W1, 0, 1);
        expect(() => reviewWithRoot(swapped, root, [W1])).toThrow(SIGN_INPUT_DETAILS);
        expect(() => signWithRoot(swapped, root, [W1])).toThrow(SIGN_INPUT_DETAILS);

        // a coin of W1 at /0/1, with key paths saying /0/0: not the wallet's script at that path
        const other = psbtOf('w1Spend');
        other.data.inputs[0].witnessScript = policyWitnessScript(W1, 0, 1);
        other.data.inputs[0].witnessUtxo = { script: bitcoin.address.toOutputScript(policyAddress(W1, 0, 1)), value: 100_000 };
        expect(() => reviewWithRoot(other, root, [W1])).toThrow(SIGN_UNKNOWN_MULTISIG);
    });

    it('a previous transaction that is not the coin the input spends, or disagrees with the witness UTXO', () => {
        const wrongTx = bitcoin.Psbt.fromHex(fixtures.w1SpendNonWitness.unsignedHex);
        const tx = bitcoin.Transaction.fromBuffer(wrongTx.data.inputs[0].nonWitnessUtxo!);
        tx.locktime = 1;
        wrongTx.data.inputs[0].nonWitnessUtxo = tx.toBuffer();
        expect(() => reviewWithRoot(wrongTx, root, [W1])).toThrow(SIGN_INPUT_DETAILS);

        const disagree = bitcoin.Psbt.fromHex(fixtures.w1SpendNonWitness.unsignedHex);
        const prev = bitcoin.Transaction.fromBuffer(disagree.data.inputs[0].nonWitnessUtxo!).outs[1];
        disagree.data.inputs[0].witnessUtxo = { script: prev.script, value: prev.value + 50_000 };
        expect(() => reviewWithRoot(disagree, root, [W1])).toThrow(SIGN_INPUT_DETAILS);
    });

    it('wrapped and legacy multisig', () => {
        const ws = policyWitnessScript(W1, 0, 0);
        const wrapped = bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wsh({ redeem: { output: ws } }) });
        const legacy = bitcoin.payments.p2sh({ redeem: { output: ws } });
        const base = multisigInput(W1, 0, 0, 100_000, 0x51);
        for (const input of [
            { ...base, witnessUtxo: { script: wrapped.output as Buffer, value: 100_000 }, redeemScript: wrapped.redeem!.output },
            { ...base, witnessScript: undefined, witnessUtxo: { script: legacy.output as Buffer, value: 100_000 }, redeemScript: ws },
            // wrapped, without its redeem script
            { ...base, witnessUtxo: { script: wrapped.output as Buffer, value: 100_000 } },
        ]) {
            const psbt = new bitcoin.Psbt();
            const data: any = { ...input };
            if (!data.witnessScript) delete data.witnessScript;
            psbt.addInput(data);
            psbt.addOutput({ address: PAYEE, value: 90_000 });
            expect(isMultisigTransaction(psbt)).toBe(true);
            expect(() => assertMultisigRegistered(psbt, [W1])).toThrow(SIGN_UNSUPPORTED_MULTISIG);
            expect(() => reviewWithRoot(psbt, root, [W1])).toThrow(SIGN_UNSUPPORTED_MULTISIG);
        }
    });

    it('single-key and multisig coins together, or coins of two wallets', () => {
        const mixed = new bitcoin.Psbt();
        mixed.addInput(multisigInput(W1, 0, 0, 100_000, 0x61));
        mixed.addInput(singleKeyInput(50_000, 0x62));
        mixed.addOutput({ address: PAYEE, value: 140_000 });
        expect(() => reviewWithRoot(mixed, root, [W1])).toThrow(SIGN_MIXED_WALLETS);
        expect(() => signWithRoot(mixed, root, [W1])).toThrow(SIGN_MIXED_WALLETS);

        const twoWallets = new bitcoin.Psbt();
        twoWallets.addInput(multisigInput(W1, 0, 0, 100_000, 0x63));
        twoWallets.addInput(multisigInput(W4, 0, 1, 100_000, 0x64));
        twoWallets.addOutput({ address: PAYEE, value: 190_000 });
        expect(() => reviewWithRoot(twoWallets, root, [W1, W4])).toThrow(SIGN_MIXED_WALLETS);
    });

    it("a registered wallet whose key for this fingerprint isn't this seed's", () => {
        // the stored wallet lists the signer's fingerprint next to someone else's key
        const ozone = rootFromBackup(OZONE).derivePath("m/48'/0'/0'/2'").neutered().toBase58();
        const tampered: SignerWallet = { ...W1, keys: W1.keys.map(k => (k.fingerprint === OURS ? { ...k, xpub: ozone } : k)) };
        expect(() => reviewWithRoot(psbtOf('w1Spend'), root, [tampered])).toThrow(SIGN_UNKNOWN_MULTISIG);
    });

    it('multisig on the Hot Vault, which signs single-key coins only', () => {
        const hot = new HDSegwitBech32Wallet();
        hot.setSecret(ABANDON);
        const psbt = psbtOf('w1Spend');
        expect(() => assertSingleKeyOnly(psbt)).toThrow(SIGN_MULTISIG_HOT_VAULT);
        expect(() => reviewWithWallet(psbt, () => false, signingKeyForWallet(hot))).toThrow(SIGN_MULTISIG_HOT_VAULT);
        expect(() => reviewWithWallet(psbt, () => false, OURS)).toThrow(SIGN_MULTISIG_HOT_VAULT);

        const single = new bitcoin.Psbt();
        single.addInput(singleKeyInput(50_000, 0x71));
        single.addOutput({ address: PAYEE, value: 49_000 });
        expect(isMultisigTransaction(single)).toBe(false);
        assertSingleKeyOnly(single);
        expect(reviewWithWallet(single, () => false, signingKeyForWallet(hot)).fee).toBe(1_000);
    });
});

describe('with BlueWallet as the coordinator', () => {
    /** A BlueWallet multisig vault for W1's keys, holding `seed` for one of them if given. */
    const blueWallet = (seed?: { phrase: string; index: number }) => {
        const w = new MultisigHDWallet();
        w.setSecret(
            [
                'Name: BlueWallet vault',
                'Policy: 2 of 3',
                "Derivation: m/48'/0'/0'/2'",
                'Format: P2WSH',
                ...W1.keys.map(k => `${k.fingerprint.toUpperCase()}: ${k.xpub}`),
            ].join('\n'),
        );
        if (seed) w.replaceCosignerXpubWithSeed(seed.index, seed.phrase, '');
        return w;
    };

    /** A previous transaction paying `address`, so BlueWallet can attach it as it does for hardware wallets. */
    const utxoAt = (address: string, value: number, byte: number) => {
        const prev = new bitcoin.Transaction();
        prev.addInput(Buffer.alloc(32, byte), 0);
        prev.addOutput(bitcoin.address.toOutputScript(address), value);
        return { height: 1, value, address, txId: prev.getId(), txid: prev.getId(), vout: 0, txhex: prev.toHex() };
    };

    it("registers BlueWallet's export, then signs its transaction, which BlueWallet completes with the second key", () => {
        const coordinator = blueWallet();
        const policy = parseWalletFile(coordinator.getXpub());
        expect(policy.id).toBe(W1.id);
        const wallet: SignerWallet = { ...policy, ownFingerprint: OURS, addedAt: 0 };

        const { psbt } = coordinator.createTransaction(
            [utxoAt(coordinator._getExternalAddressByIndex(0) as string, 100_000, 0x81)],
            [{ address: PAYEE, value: 60_000 }],
            2,
            coordinator._getInternalAddressByIndex(0),
            false,
            true,
        );
        const review = reviewWithRoot(psbt, root, [wallet]);
        expect(review.multisig?.name).toBe('BlueWallet vault');
        expect(review.outputs.find(o => o.change)?.address).toBe(fixtures.wallets.w1.addresses.change0);
        expect(review.outputs.filter(o => !o.change)).toEqual([{ address: PAYEE, value: 60_000, change: false }]);

        const signed = signWithRoot(psbt, root, [wallet]).psbt;
        expect(validate(signed)).toBe(true);
        // BlueWallet adds the second signature and finalizes: OP_0, two signatures, the witness script
        const { tx } = blueWallet({ phrase: LEGAL, index: 2 }).cosignPsbt(signed);
        expect(tx).toBeTruthy();
        expect(tx.ins[0].witness).toHaveLength(4);
        expect(tx.ins[0].witness[3].toString('hex')).toBe(fixtures.wallets.w1.witnessScriptReceive0);
    });
});
