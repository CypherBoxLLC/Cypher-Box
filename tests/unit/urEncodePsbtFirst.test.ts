/**
 * A signed transaction's animated QR: encoding a PSBT mustn't touch BlueWallet's wallet classes. Loading them runs an
 * elliptic-curve self-test for each, and on an Offline Seed-Signer, where nothing had loaded them, that held the
 * signed transaction's QR back 11 s on a Galaxy A14. The wallet classes are stood in for here by an object that notes
 * every class asked for. The PSBT is made here, from the public "abandon … about" phrase's BIP84 keys.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import { BlueURDecoder, encodeUR } from '../../blue_modules/ur';

jest.mock('../../class', () => {
    const asked: string[] = [];
    return new Proxy(
        { asked },
        {
            get: (target, name) => {
                if (name === 'asked') return target.asked;
                if (typeof name === 'string' && /^[A-Z]/.test(name)) asked.push(name);
                return undefined;
            },
        },
    );
});

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(ABANDON));
const ACCOUNT = "m/84'/0'/0'";

// a spend of three coins of the account, with change back to it, as a watch-only wallet makes it
const unsignedPsbt = () => {
    const psbt = new bitcoin.Psbt();
    for (let i = 0; i < 3; i++) {
        const path = `${ACCOUNT}/0/${i}`;
        const pubkey = Buffer.from(root.derivePath(path).publicKey);
        psbt.addInput({
            hash: Buffer.alloc(32, 0xc0 + i),
            index: i,
            sequence: 0xfffffffd,
            witnessUtxo: { script: bitcoin.payments.p2wpkh({ pubkey }).output as Buffer, value: 50_000 + i },
            bip32Derivation: [{ masterFingerprint: Buffer.from(root.fingerprint), path, pubkey }],
        });
    }
    const changePath = `${ACCOUNT}/1/0`;
    const changeKey = Buffer.from(root.derivePath(changePath).publicKey);
    psbt.addOutput({ script: bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x5a) }).output as Buffer, value: 120_000 });
    psbt.addOutput({
        script: bitcoin.payments.p2wpkh({ pubkey: changeKey }).output as Buffer,
        value: 29_000,
        bip32Derivation: [{ masterFingerprint: Buffer.from(root.fingerprint), path: changePath, pubkey: changeKey }],
    });
    return psbt;
};

describe('encodeUR', () => {
    it('makes a PSBT into crypto-psbt parts without the wallet classes', () => {
        const psbt = unsignedPsbt();
        const parts = encodeUR(psbt.toHex(), 200);
        expect(parts.length).toBeGreaterThan(1);
        expect(parts.every((p: string) => p.startsWith('ur:crypto-psbt/'))).toBe(true);
        expect(require('../../class').asked).toEqual([]);

        // and the parts carry that PSBT, read back the way the app's scanner does
        const decoder = new BlueURDecoder();
        for (const part of parts) decoder.receivePart(part);
        expect(decoder.isSuccess()).toBe(true);
        expect(decoder.toString()).toBe(psbt.toBase64());
        expect(require('../../class').asked).toEqual([]);
    });
});
