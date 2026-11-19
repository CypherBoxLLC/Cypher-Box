/**
 * Signing once from a backup: the transaction has to belong to the backup, change has to really come back to it,
 * and the signature has to be valid. All keys here come from the public BIP39 test phrase.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import {
    SIGN_BACKUP_MISMATCH,
    SIGN_FALSE_CHANGE,
    SIGN_INVALID_BACKUP,
    SIGN_NO_KEY_INFO,
    SIGN_NOT_A_TRANSACTION,
    SIGN_VAULT_MISMATCH,
    assertBackupMatches,
    assertKeyMatches,
    backupToMnemonic,
    looksLikePsbt,
    parseUnsignedPsbt,
    reviewWithRoot,
    reviewWithWallet,
    rootFromBackup,
    signWithRoot,
} from '../../src/helpers/signOnce';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(PHRASE));
const ACCOUNT = "m/84'/0'/0'";
const PAYEE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x5a) });

const keyAt = (path: string) => root.derivePath(path);
const p2wpkh = (path: string) => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyAt(path).publicKey) });

const unsigned = ({ changeScript, withDerivations = true }: { changeScript?: Buffer; withDerivations?: boolean } = {}) => {
    const inPath = `${ACCOUNT}/0/0`;
    const changePath = `${ACCOUNT}/1/0`;
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
        hash: Buffer.alloc(32, 0xc4),
        index: 0,
        sequence: 0xfffffffd,
        witnessUtxo: { script: p2wpkh(inPath).output as Buffer, value: 150_000 },
        ...(withDerivations
            ? { bip32Derivation: [{ masterFingerprint: Buffer.from(root.fingerprint), path: inPath, pubkey: Buffer.from(keyAt(inPath).publicKey) }] }
            : {}),
    });
    psbt.addOutput({ script: PAYEE.output as Buffer, value: 120_000 });
    psbt.addOutput({
        script: changeScript ?? (p2wpkh(changePath).output as Buffer),
        value: 29_000,
        ...(withDerivations
            ? { bip32Derivation: [{ masterFingerprint: Buffer.from(root.fingerprint), path: changePath, pubkey: Buffer.from(keyAt(changePath).publicKey) }] }
            : {}),
    });
    return psbt;
};

describe('reading the backup', () => {
    it('accepts the phrase with stray spacing and capitals', () => {
        expect(backupToMnemonic(`  ${PHRASE.toUpperCase().replace(/ /g, '   ')}\n`)).toBe(PHRASE);
    });

    it('reads a standard SeedQR', () => {
        // eleven "abandon" (0000) and "about" (0003)
        expect(backupToMnemonic('0000'.repeat(11) + '0003')).toBe(PHRASE);
    });

    it('refuses a bad checksum, an unknown word, or the wrong length', () => {
        expect(() => backupToMnemonic(PHRASE.replace('about', 'abandon'))).toThrow(SIGN_INVALID_BACKUP);
        expect(() => backupToMnemonic(PHRASE.replace('about', 'abuot'))).toThrow('"abuot" isn\'t a recovery phrase word');
        expect(() => backupToMnemonic('abandon about')).toThrow("That's 2 words");
    });

    it('ignores odd separators a keyboard may insert', () => {
        expect(backupToMnemonic(PHRASE.replace(/ /g, '\u00a0,\n'))).toBe(PHRASE);
    });

    it('gives a different key with a passphrase', () => {
        expect(Buffer.from(rootFromBackup(PHRASE, 'extra').fingerprint)).not.toEqual(Buffer.from(root.fingerprint));
        expect(Buffer.from(rootFromBackup(PHRASE).fingerprint)).toEqual(Buffer.from(root.fingerprint));
    });
});

describe('matching the transaction to the backup', () => {
    it('accepts the right backup', () => {
        expect(() => assertBackupMatches(unsigned(), rootFromBackup(PHRASE))).not.toThrow();
    });

    it('catches a wrong passphrase', () => {
        expect(() => assertBackupMatches(unsigned(), rootFromBackup(PHRASE, 'typo'))).toThrow(SIGN_BACKUP_MISMATCH);
    });

    it('says when the transaction carries no key details', () => {
        expect(() => assertBackupMatches(unsigned({ withDerivations: false }), root)).toThrow(SIGN_NO_KEY_INFO);
    });

    it('talks about the Hot Vault, not a backup, when the Hot Vault is the key', () => {
        const otherVault = Buffer.from(rootFromBackup(PHRASE, 'other').fingerprint).toString('hex');
        expect(() => assertKeyMatches(unsigned(), otherVault, SIGN_VAULT_MISMATCH)).toThrow(SIGN_VAULT_MISMATCH);
        expect(() => assertKeyMatches(unsigned(), Buffer.from(root.fingerprint).toString('hex'), SIGN_VAULT_MISMATCH)).not.toThrow();
    });
});

describe('reviewing before signing', () => {
    it('shows the payment, verified change and fee', () => {
        const review = reviewWithRoot(unsigned(), root);
        expect(review.outputs).toEqual([
            { address: PAYEE.address, value: 120_000, change: false },
            { address: p2wpkh(`${ACCOUNT}/1/0`).address, value: 29_000, change: true },
        ]);
        expect(review.fee).toBe(1_000);
        expect(review.ownInputs).toBe(1);
        expect(review.inputCount).toBe(1);
    });

    it('stops a transaction that labels someone else as change', () => {
        const attacker = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x66) });
        expect(() => reviewWithRoot(unsigned({ changeScript: attacker.output as Buffer }), root)).toThrow(SIGN_FALSE_CHANGE);
    });

    it('uses the wallet to spot change for the Hot Vault', () => {
        const own = p2wpkh(`${ACCOUNT}/1/0`).address;
        // the wallet reports its fingerprint in capitals
        const review = reviewWithWallet(unsigned(), a => a === own, Buffer.from(root.fingerprint).toString('hex').toUpperCase());
        expect(review.outputs.map(o => o.change)).toEqual([false, true]);
        expect(review.ownInputs).toBe(1);
    });
});

describe('signing', () => {
    it('adds a valid signature and leaves finalizing to the other wallet', () => {
        const { psbt, signed } = signWithRoot(unsigned(), root);
        expect(signed).toBe(1);
        expect(psbt.data.inputs[0].partialSig).toHaveLength(1);
        expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
        const tx = psbt.finalizeAllInputs().extractTransaction();
        expect(tx.outs).toHaveLength(2);
    });

    it('does not touch the original', () => {
        const original = unsigned();
        signWithRoot(original, root);
        expect(original.data.inputs[0].partialSig).toBeUndefined();
    });
});

describe('recognising a transaction', () => {
    it('reads base64 and hex, and refuses anything else', () => {
        const base64 = unsigned().toBase64();
        expect(looksLikePsbt(base64)).toBe(true);
        expect(looksLikePsbt(unsigned().toHex())).toBe(true);
        expect(looksLikePsbt('bc1qxyz')).toBe(false);
        expect(parseUnsignedPsbt(unsigned().toHex()).toBase64()).toBe(base64);
        expect(() => parseUnsignedPsbt('bc1qxyz')).toThrow(SIGN_NOT_A_TRANSACTION);
    });
});
