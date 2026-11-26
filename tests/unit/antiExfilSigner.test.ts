/**
 * The signing phone's side of verified signing as the sign-once screen uses it: the Cold Vault's request is unwrapped
 * to the transaction inside, and the protocol gets its keys from a backup or from the Hot Vault, each key checked
 * against the public key the transaction states before it is handed out. Both key sources run the whole four-hop
 * exchange here, against the Cold Vault's side of it, to an ok verdict. All keys come from the public BIP39 test phrase.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import {
    ANTI_EXFIL_DAMAGED,
    ANTI_EXFIL_NEWER_VERSION,
    keyAccessFromRoot,
    keyAccessFromWallet,
    unwrapAntiExfilCommit,
} from '../../src/helpers/antiExfilSigner';
import { hostCommitStep, hostRevealStep, hostVerifyStep, signerCommitStep, signerSignStep } from '../../src/helpers/antiExfilController';
import { decodeAntiExfilMessage, encodeAntiExfilMessage } from '../../src/helpers/antiExfilTransport';

const crypto = require('crypto');

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(PHRASE));
const ACCOUNT = "m/84'/0'/0'";
const fingerprint = Buffer.from(root.fingerprint);
// someone else's key, for the recipient
const other = BIP32Factory(ecc).fromSeed(Buffer.alloc(64, 7)).derivePath(`${ACCOUNT}/0/0`);

const p2wpkh = (pubkey: Buffer) => bitcoin.payments.p2wpkh({ pubkey });

/** A spend of two of the account's coins, as a Cypher Box Cold Vault makes it: key details on every input. */
function unsignedPsbt(): bitcoin.Psbt {
    const psbt = new bitcoin.Psbt();
    for (let i = 0; i < 2; i++) {
        const path = `${ACCOUNT}/0/${i}`;
        const pubkey = Buffer.from(root.derivePath(path).publicKey);
        psbt.addInput({
            hash: Buffer.alloc(32, 0xa0 + i),
            index: i,
            witnessUtxo: { script: p2wpkh(pubkey).output as Buffer, value: 100000 },
            bip32Derivation: [{ masterFingerprint: fingerprint, path, pubkey }],
        });
    }
    psbt.addOutput({ address: p2wpkh(Buffer.from(other.publicKey)).address as string, value: 150000 });
    const changePath = `${ACCOUNT}/1/0`;
    const changePubkey = Buffer.from(root.derivePath(changePath).publicKey);
    psbt.addOutput({
        address: p2wpkh(changePubkey).address as string,
        value: 49000,
        bip32Derivation: [{ masterFingerprint: fingerprint, path: changePath, pubkey: changePubkey }],
    });
    return psbt;
}

const randomness = () => Uint8Array.from(crypto.randomBytes(32));
const decodeOk = (raw: string) => {
    const r = decodeAntiExfilMessage(raw);
    if (r.kind !== 'ok') throw new Error(`expected an ok message, got ${r.kind}`);
    return r.message;
};

// the Hot Vault's key accessor, as BlueWallet's HD wallets have it: a WIF by (change, index) off the account
const hotVault = {
    _getWIFByIndex: (internal: boolean, index: number) => root.derivePath(`${ACCOUNT}/${internal ? 1 : 0}/${index}`).toWIF(),
};

describe('unwrapping what was scanned to sign', () => {
    it('passes a plain transaction through, with no exchange to run', () => {
        const psbt = unsignedPsbt().toBase64();
        expect(unwrapAntiExfilCommit(psbt)).toEqual({ psbt, commit: null });
    });

    it("gives the transaction inside a Cold Vault's request, and the request", () => {
        const psbt = unsignedPsbt().toBase64();
        const { message } = hostCommitStep(psbt, randomness);
        const unwrapped = unwrapAntiExfilCommit(message);
        expect(unwrapped.psbt).toBe(psbt);
        expect(unwrapped.commit?.hop).toBe('commit');
        expect(unwrapped.commit?.inputs).toEqual([0, 1]);
    });

    it('refuses a request from a newer version as such, not as damaged', () => {
        expect(() => unwrapAntiExfilCommit('AEFX2:' + Buffer.from('{}').toString('base64'))).toThrow(ANTI_EXFIL_NEWER_VERSION);
    });

    it('refuses a damaged request, and a hop that is not the request', () => {
        expect(() => unwrapAntiExfilCommit('AEFX1:not base64 json')).toThrow(ANTI_EXFIL_DAMAGED);
        const open = encodeAntiExfilMessage({ hop: 'open', sessionId: 's', inputs: [0], openings: ['02' + '11'.repeat(32)] });
        expect(() => unwrapAntiExfilCommit(open)).toThrow(ANTI_EXFIL_DAMAGED);
    });
});

describe('keys for the exchange', () => {
    const path = `${ACCOUNT}/0/1`;
    const pubkey = Uint8Array.from(root.derivePath(path).publicKey);

    it('from a backup: the key at the path, only when it is the stated public key', () => {
        const access = keyAccessFromRoot(root);
        const key = access.derive(path, pubkey);
        expect(key).toHaveLength(32);
        expect(Buffer.from(key as Uint8Array).equals(Buffer.from(root.derivePath(path).privateKey as Buffer))).toBe(true);
        // hardened steps written with h
        expect(access.derive("m/84h/0h/0h/0/1", pubkey)).toHaveLength(32);
        expect(access.derive(path, Uint8Array.from(other.publicKey))).toBeNull();
        expect(access.derive('not a path', pubkey)).toBeNull();
    });

    it('from the Hot Vault: by change and index, only when it is the stated public key', () => {
        const access = keyAccessFromWallet(hotVault);
        const key = access.derive(path, pubkey);
        expect(key).toHaveLength(32);
        expect(Buffer.from(key as Uint8Array).equals(Buffer.from(root.derivePath(path).privateKey as Buffer))).toBe(true);
        expect(access.derive(path, Uint8Array.from(other.publicKey))).toBeNull();
        expect(access.derive(`${ACCOUNT}/2/1`, pubkey)).toBeNull();
        expect(access.derive(`${ACCOUNT}/0/-1`, pubkey)).toBeNull();
    });
});

describe('the whole exchange with the sign-once screen\'s key sources', () => {
    for (const [name, access] of [
        ['a backup', keyAccessFromRoot(root)],
        ['the Hot Vault', keyAccessFromWallet(hotVault)],
    ] as const) {
        it(`signs with ${name} and the Cold Vault verifies every input`, () => {
            const unsigned = unsignedPsbt();
            const host1 = hostCommitStep(unsigned.toBase64(), randomness);
            const { psbt, commit } = unwrapAntiExfilCommit(host1.message);
            expect(psbt).toBe(unsigned.toBase64());

            const signer1 = signerCommitStep(commit!, access);
            const host2 = hostRevealStep(decodeOk(signer1.message), host1.session);
            const signer2 = signerSignStep(decodeOk(host2.message), signer1.session, access);
            const verdict = hostVerifyStep(decodeOk(signer2.message), host2.session);

            expect(verdict.verdict).toBe('ok');
            expect(verdict.perInput.map(p => p.ok)).toEqual([true, true]);
            // and the signed transaction is complete
            const signed = bitcoin.Psbt.fromBase64(verdict.signedPsbtBase64 as string);
            expect(() => signed.finalizeAllInputs().extractTransaction()).not.toThrow();
        });
    }

    it('refuses to commit when a key is not the one the transaction states', () => {
        const unsigned = unsignedPsbt();
        const host1 = hostCommitStep(unsigned.toBase64(), randomness);
        const { commit } = unwrapAntiExfilCommit(host1.message);
        const wrongRoot = BIP32Factory(ecc).fromSeed(Buffer.alloc(64, 9));
        expect(() => signerCommitStep(commit!, keyAccessFromRoot(wrongRoot))).toThrow(/antiExfil: no private key/);
    });
});
