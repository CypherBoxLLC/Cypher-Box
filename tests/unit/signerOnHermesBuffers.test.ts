/**
 * The signer as it runs on the phone. On Hermes, `subarray()` on the app's Buffer polyfill gives back a plain
 * Uint8Array, whose toString ignores 'hex' ("4,136,178,30" instead of "0488b21e"); Node gives back a Buffer, so these
 * tests make Node's subarray behave as Hermes's does. Every wallet file was refused on the A14 ("Key 1 ... isn't a
 * valid public key") and every multisig address would have failed until the helpers stopped relying on it. Expected
 * values are the rust-miniscript and libsecp256k1 fixtures, BIP84's published vectors for the public "abandon … about"
 * phrase, and signatures checked with the curve library.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import { addressFromText, parseWalletFile, policyAddress, policyWitnessScript } from '../../src/helpers/multisigPolicy';
import { assertBackupMatches, reviewWithRoot, signWithRoot } from '../../src/helpers/signOnce';
import {
    findSingleKeyAddress,
    signerAccountOf,
    signerPublicKey,
    signerPublicKeyFromAccount,
} from '../../src/helpers/signerPublicKey';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));

const fixtures = require('./fixtures/multisig-signer/fixtures.json');

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

    it('reads wallet files', () => {
        for (const name of ['w1', 'w2', 'w3', 'w4', 'w5']) {
            expect(() => parseWalletFile(fixtures.wallets[name].descriptor)).not.toThrow();
        }
    });

    it("derives the wallet's addresses and witness scripts as rust-miniscript does", () => {
        const w1 = parseWalletFile(fixtures.wallets.w1.descriptor);
        expect(fixtures.wallets.w1.receiveFirst20.map((_: string, i: number) => policyAddress(w1, 0, i))).toEqual(fixtures.wallets.w1.receiveFirst20);
        expect(policyAddress(w1, 1, 1000)).toBe(fixtures.wallets.w1.addresses.change1000);
        expect(policyWitnessScript(w1, 0, 0).toString('hex')).toBe(fixtures.wallets.w1.witnessScriptReceive0);
    });

    it("reviews and signs a multisig spend with libsecp256k1's signatures", () => {
        const w1 = { ...parseWalletFile(fixtures.wallets.w1.descriptor), name: 'Family vault', ownFingerprint: '73c5da0a', addedAt: 0 };
        const review = reviewWithRoot(bitcoin.Psbt.fromHex(fixtures.psbts.w1Spend.unsignedHex), root, [w1]);
        expect(review.outputs.map(o => o.change)).toEqual([false, true]);
        const signed = signWithRoot(bitcoin.Psbt.fromHex(fixtures.psbts.w1Spend.unsignedHex), root, [w1]).psbt;
        expect(signed.data.inputs.map(i => Buffer.from(i.partialSig![0].signature).toString('hex'))).toEqual(
            fixtures.psbts.w1Spend.signatures['73c5da0a'].map((s: { signature: string }) => s.signature),
        );
    });

    it("shows the single-key public key BIP84 publishes", () => {
        const info = signerPublicKey(root);
        expect(info.xpub).toBe('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs');
        expect(info.key).toBe(`[73c5da0a/84h/0h/0h]${info.xpub}`);
        expect(info.addresses[0]).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    });

    it('shows a remembered public key again, without the seed', () => {
        const fromSeed = signerPublicKey(root);
        expect(signerPublicKeyFromAccount(signerAccountOf(fromSeed))).toEqual({ ...fromSeed, multisigKey: '' });
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

    it('finds a single-key receive address', async () => {
        const address = signerPublicKey(root).addresses[2];
        expect(await findSingleKeyAddress(root, addressFromText(address).script)).toEqual({ fingerprint: '73C5DA0A', branch: 0, index: 2 });
    });
});
