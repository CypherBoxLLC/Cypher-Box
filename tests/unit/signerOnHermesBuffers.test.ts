/**
 * The signer as it runs on the phone. On Hermes, `subarray()` on the app's Buffer polyfill gives back a plain
 * Uint8Array, whose toString ignores 'hex' ("4,136,178,30" instead of "0488b21e"); Node gives back a Buffer, so these
 * tests make Node's subarray behave as Hermes's does. Expected values are BIP84's published vectors for the public
 * "abandon … about" phrase, and signatures checked with the curve library.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import { assertBackupMatches, reviewWithRoot, signWithRoot } from '../../src/helpers/signOnce';
import { signerPublicKey } from '../../src/helpers/signerPublicKey';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(ABANDON));
const ACCOUNT = "m/84'/0'/0'";
const PAYEE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x5a) });

const p2wpkh = (path: string) => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(root.derivePath(path).publicKey) });
const derivation = (path: string) => [{ masterFingerprint: Buffer.from(root.fingerprint), path, pubkey: Buffer.from(root.derivePath(path).publicKey) }];

// a spend from the account's first receive address, with change back to it
const unsigned = () => {
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
        hash: Buffer.alloc(32, 0xc4),
        index: 0,
        sequence: 0xfffffffd,
        witnessUtxo: { script: p2wpkh(`${ACCOUNT}/0/0`).output as Buffer, value: 150_000 },
        bip32Derivation: derivation(`${ACCOUNT}/0/0`),
    });
    psbt.addOutput({ script: PAYEE.output as Buffer, value: 120_000 });
    psbt.addOutput({ script: p2wpkh(`${ACCOUNT}/1/0`).output as Buffer, value: 29_000, bip32Derivation: derivation(`${ACCOUNT}/1/0`) });
    return psbt;
};

const nodeSubarray = Buffer.prototype.subarray;
const nodeSlice = Buffer.prototype.slice;
beforeAll(() => {
    // as on Hermes: a view of the same bytes, but a plain Uint8Array
    Buffer.prototype.subarray = function hermesSubarray(this: Buffer, start?: number, end?: number) {
        const view = nodeSubarray.call(this, start, end);
        return new Uint8Array(view.buffer, view.byteOffset, view.length) as unknown as Buffer;
    };
    // the polyfill's own slice still gives a Buffer; Node's goes through subarray, so it's given one here
    Buffer.prototype.slice = function polyfillSlice(this: Buffer, start?: number, end?: number) {
        const view = nodeSubarray.call(this, start, end);
        return Buffer.from(view.buffer, view.byteOffset, view.length);
    };
});
afterAll(() => {
    Buffer.prototype.subarray = nodeSubarray;
    Buffer.prototype.slice = nodeSlice;
});

describe('the signer with Hermes-style buffers', () => {
    it('really has them in this test', () => {
        const piece = Buffer.from([4, 136, 178, 30, 7]).subarray(0, 4);
        expect(Buffer.isBuffer(piece)).toBe(false);
        expect(piece.toString()).toBe('4,136,178,30');
    });

    it('shows the public key BIP84 publishes', () => {
        const info = signerPublicKey(root);
        expect(info.xpub).toBe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
        expect(info.key).toBe(`[73c5da0a/84h/0h/0h]${info.xpub}`);
        expect(info.addresses[0]).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    });

    it('reviews a single-key spend and signs it with a valid signature', () => {
        expect(() => assertBackupMatches(unsigned(), root)).not.toThrow();
        const review = reviewWithRoot(unsigned(), root);
        expect(review.outputs.map(o => o.change)).toEqual([false, true]);
        expect(review.fee).toBe(1_000);
        const signed = signWithRoot(unsigned(), root).psbt;
        expect(signed.data.inputs[0].partialSig).toHaveLength(1);
        expect(signed.validateSignaturesOfInput(0, (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature))).toBe(true);
    });
});
