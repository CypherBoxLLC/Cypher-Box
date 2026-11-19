/**
 * What the signer shows has to be what it signs. Three ways a watch-only wallet that lies could get around that:
 * - an input whose witnessUtxo amount disagrees with the previous transaction (bitcoinjs signs over the latter, so the
 *   fee on screen would be wrong);
 * - change sent to a path that gives this key but that the paired wallet never looks at (the coins would vanish from
 *   view);
 * - a signature planted on an input this key doesn't sign, made to trip the nonce-reuse canary.
 * All keys come from the public BIP39 test phrase.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import {
    SIGN_FALSE_CHANGE,
    SIGN_INPUT_MISMATCH,
    isWalletAddressPath,
    reviewWithRoot,
    reviewWithWallet,
    signWithRoot,
} from '../../src/helpers/signOnce';
import { NonceReuseError, __resetSignatureAuditForTest, auditPsbtSignatures } from '../../class/signatureAudit';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(PHRASE));
const ACCOUNT = "m/84'/0'/0'";
const IN_PATH = `${ACCOUNT}/0/0`;
const PAYEE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x5a) });
const OTHER = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x77) });

const keyAt = (path: string) => root.derivePath(path);
const pubkeyAt = (path: string) => Buffer.from(keyAt(path).publicKey);
const p2wpkh = (path: string) => bitcoin.payments.p2wpkh({ pubkey: pubkeyAt(path) });
const derivation = (path: string) => [{ masterFingerprint: Buffer.from(root.fingerprint), path, pubkey: pubkeyAt(path) }];

/** A previous transaction paying `value` to our first receive address, as nonWitnessUtxo carries it. */
const previous = (value: number) => {
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(Buffer.alloc(32, 0x11), 0);
    tx.addOutput(p2wpkh(IN_PATH).output as Buffer, value);
    return tx;
};

const spending = (prev: bitcoin.Transaction, extra: Record<string, unknown> = {}) => {
    const psbt = new bitcoin.Psbt();
    psbt.addInput({ hash: prev.getHash(), index: 0, sequence: 0xfffffffd, bip32Derivation: derivation(IN_PATH), ...extra });
    psbt.addOutput({ script: PAYEE.output as Buffer, value: 120_000 });
    return psbt;
};

describe('input amounts', () => {
    it('takes the amount from the previous transaction when the PSBT carries both and they agree', () => {
        const prev = previous(150_000);
        const psbt = spending(prev, {
            nonWitnessUtxo: prev.toBuffer(),
            witnessUtxo: { script: p2wpkh(IN_PATH).output as Buffer, value: 150_000 },
        });
        expect(reviewWithRoot(psbt, root).fee).toBe(30_000);
    });

    it('refuses an input whose witnessUtxo amount disagrees with the transaction it spends', () => {
        // the signature would commit to 150,000 while the screen showed a 1,000 sat fee
        const prev = previous(150_000);
        const psbt = spending(prev, {
            nonWitnessUtxo: prev.toBuffer(),
            witnessUtxo: { script: p2wpkh(IN_PATH).output as Buffer, value: 121_000 },
        });
        expect(() => reviewWithRoot(psbt, root)).toThrow(SIGN_INPUT_MISMATCH);
        expect(() => reviewWithWallet(psbt, () => false, Buffer.from(root.fingerprint).toString('hex'))).toThrow(
            SIGN_INPUT_MISMATCH,
        );
    });

    it('refuses an input whose witnessUtxo script disagrees with the transaction it spends', () => {
        const prev = previous(150_000);
        const psbt = spending(prev, {
            nonWitnessUtxo: prev.toBuffer(),
            witnessUtxo: { script: OTHER.output as Buffer, value: 150_000 },
        });
        expect(() => reviewWithRoot(psbt, root)).toThrow(SIGN_INPUT_MISMATCH);
    });

    it('refuses a previous transaction that is not the one the input spends', () => {
        const prev = previous(150_000);
        const psbt = spending(prev);
        // a different transaction slipped in as the input's previous one
        psbt.data.inputs[0].nonWitnessUtxo = previous(900_000).toBuffer();
        expect(() => reviewWithRoot(psbt, root)).toThrow(SIGN_INPUT_MISMATCH);
    });

    it('still reads a witnessUtxo-only input, as Cypher Box Cold Vaults write them', () => {
        const psbt = new bitcoin.Psbt();
        psbt.addInput({
            hash: Buffer.alloc(32, 0xc4),
            index: 0,
            witnessUtxo: { script: p2wpkh(IN_PATH).output as Buffer, value: 150_000 },
            bip32Derivation: derivation(IN_PATH),
        });
        psbt.addOutput({ script: PAYEE.output as Buffer, value: 120_000 });
        expect(reviewWithRoot(psbt, root).fee).toBe(30_000);
    });
});

describe('change the paired wallet can see', () => {
    it('knows this account\'s receive and change paths, in either notation', () => {
        expect(isWalletAddressPath(`${ACCOUNT}/1/0`)).toBe(true);
        expect(isWalletAddressPath(`${ACCOUNT}/0/42`)).toBe(true);
        expect(isWalletAddressPath("m/84h/0h/0h/1/7")).toBe(true);
        expect(isWalletAddressPath(`${ACCOUNT}/1/9999`)).toBe(true);
        expect(isWalletAddressPath(`${ACCOUNT}/1/10000`)).toBe(false);
        expect(isWalletAddressPath(`${ACCOUNT}/2/0`)).toBe(false);
        expect(isWalletAddressPath("m/84'/0'/7'/1/0")).toBe(false);
        expect(isWalletAddressPath("m/49'/0'/0'/1/0")).toBe(false);
        expect(isWalletAddressPath(`${ACCOUNT}/1/0/0`)).toBe(false);
    });

    const withChangeAt = (path: string) => {
        const psbt = new bitcoin.Psbt();
        psbt.addInput({
            hash: Buffer.alloc(32, 0xc4),
            index: 0,
            witnessUtxo: { script: p2wpkh(IN_PATH).output as Buffer, value: 150_000 },
            bip32Derivation: derivation(IN_PATH),
        });
        psbt.addOutput({ script: PAYEE.output as Buffer, value: 120_000 });
        psbt.addOutput({ script: p2wpkh(path).output as Buffer, value: 29_000, bip32Derivation: derivation(path) });
        return psbt;
    };

    it('shows normal change as coming back', () => {
        expect(reviewWithRoot(withChangeAt(`${ACCOUNT}/1/3`), root).outputs[1].change).toBe(true);
    });

    it('lists change at a far index or another account as going out', () => {
        expect(reviewWithRoot(withChangeAt(`${ACCOUNT}/1/500000`), root).outputs[1].change).toBe(false);
        expect(reviewWithRoot(withChangeAt("m/84'/0'/7'/1/0"), root).outputs[1].change).toBe(false);
    });

    // The same key's legacy (1…) or wrapped (3…) address: it pays this key, but a native SegWit watch-only wallet
    // never shows it.
    const withChangeScript = (path: string, script: Buffer, inputPath = IN_PATH) => {
        const psbt = new bitcoin.Psbt();
        psbt.addInput({
            hash: Buffer.alloc(32, 0xc4),
            index: 0,
            witnessUtxo: { script: p2wpkh(inputPath).output as Buffer, value: 150_000 },
            bip32Derivation: derivation(inputPath),
        });
        psbt.addOutput({ script: PAYEE.output as Buffer, value: 120_000 });
        psbt.addOutput({ script, value: 29_000, bip32Derivation: derivation(path) });
        return psbt;
    };

    it('lists change to the same key\'s legacy or wrapped address as going out', () => {
        const path = `${ACCOUNT}/1/0`;
        const legacy = bitcoin.payments.p2pkh({ pubkey: pubkeyAt(path) }).output as Buffer;
        const wrapped = bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey: pubkeyAt(path) }) }).output as Buffer;
        expect(reviewWithRoot(withChangeScript(path, legacy), root).outputs[1].change).toBe(false);
        expect(reviewWithRoot(withChangeScript(path, wrapped), root).outputs[1].change).toBe(false);
    });

    it('takes change on the account the inputs are signed from', () => {
        const account1 = "m/84'/0'/1'";
        const change1 = `${account1}/1/2`;
        const fromAccount1 = withChangeScript(change1, p2wpkh(change1).output as Buffer, `${account1}/0/0`);
        expect(reviewWithRoot(fromAccount1, root).outputs[1].change).toBe(true);
        const change0 = `${ACCOUNT}/1/2`;
        const toAccount0 = withChangeScript(change0, p2wpkh(change0).output as Buffer, `${account1}/0/0`);
        expect(reviewWithRoot(toAccount0, root).outputs[1].change).toBe(false);
        expect(isWalletAddressPath(change1, new Set([account1]))).toBe(true);
        expect(isWalletAddressPath(change1)).toBe(false);
    });

    it('refuses an output that claims this key but pays someone else, whatever its path', () => {
        for (const path of [`${ACCOUNT}/1/0`, "m/84'/0'/7'/1/0", `${ACCOUNT}/1/500000`]) {
            expect(() => reviewWithRoot(withChangeScript(path, OTHER.output as Buffer), root)).toThrow(SIGN_FALSE_CHANGE);
        }
    });
});

describe('the nonce-reuse canary on signing', () => {
    beforeEach(() => __resetSignatureAuditForTest());

    const ourInput = (psbt: bitcoin.Psbt, fill: number) =>
        psbt.addInput({
            hash: Buffer.alloc(32, fill),
            index: 0,
            witnessUtxo: { script: p2wpkh(IN_PATH).output as Buffer, value: 150_000 },
            bip32Derivation: derivation(IN_PATH),
        });

    it('ignores a signature planted on an input this key does not sign', () => {
        // sign once, so the canary has seen this key's r
        const first = new bitcoin.Psbt();
        ourInput(first, 0xa1);
        first.addOutput({ script: PAYEE.output as Buffer, value: 120_000 });
        const signed = signWithRoot(first, root).psbt;
        const real = signed.data.inputs[0].partialSig![0];
        const { signature, hashType } = bitcoin.script.signature.decode(real.signature);

        // the same key and r with another s, on an input that isn't ours: what a planted signature would look like
        const s = Buffer.from(signature.subarray(32));
        s[31] ^= 0x01;
        const planted = bitcoin.script.signature.encode(Buffer.concat([signature.subarray(0, 32), s]), hashType);

        const second = new bitcoin.Psbt();
        ourInput(second, 0xb2);
        second.addInput({
            hash: Buffer.alloc(32, 0xb3),
            index: 0,
            witnessUtxo: { script: OTHER.output as Buffer, value: 50_000 },
        });
        second.addOutput({ script: PAYEE.output as Buffer, value: 190_000 });
        second.updateInput(1, { partialSig: [{ pubkey: real.pubkey, signature: planted }] });

        expect(() => signWithRoot(second, root)).not.toThrow();
        // the same pair on an input the canary is told to check is still caught
        expect(() => auditPsbtSignatures(second, [1])).toThrow(NonceReuseError);
    });
});
