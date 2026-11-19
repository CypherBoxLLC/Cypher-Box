/**
 * A watch-only wallet set up from a bare xpub doesn't know the master fingerprint and writes 00000000 in its
 * transactions. BlueWallet does, so a Cypher Box Cold Vault paired from the Hot Vault's xpub screen does too. The signer
 * has to recognise those by public key, as the Hot Vault's cosigning did in v0.1.12, and still refuse anyone else's.
 * The signer's own key screen now hands out the key with its origin, so new pairings carry the real fingerprint.
 * All keys come from public BIP39 test phrases.
 */

import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { HDSegwitBech32Wallet, MultisigHDWallet, WatchOnlyWallet } from '../../class';
import {
    SIGN_BACKUP_MISMATCH,
    SIGN_FALSE_CHANGE,
    SIGN_NOTHING_SIGNED,
    SIGN_VAULT_MISMATCH,
    assertBackupMatches,
    assertKeyOwns,
    isForKey,
    keyWithOrigin,
    reviewWithRoot,
    reviewWithWallet,
    rootFromBackup,
    signWithRoot,
    signingKeyForWallet,
} from '../../src/helpers/signOnce';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
// BIP84's published vector for PHRASE: master fingerprint 73c5da0a, account m/84'/0'/0'
const BIP84_ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const PAYEE = 'bc1qhu8jqyzfazgatpctqn44xr7pdd3mdx6qy2r6xa';
const UNKNOWN = Buffer.alloc(4);

const hdWallet = (phrase: string) => {
    const w = new HDSegwitBech32Wallet();
    w.setSecret(phrase);
    return w;
};
const hotVault = hdWallet(PHRASE);
const root = rootFromBackup(PHRASE);
const otherRoot = rootFromBackup(OTHER_PHRASE);

/** An unsigned transaction made by a watch-only wallet set up from `watchKey`, spending `owner`'s first address. */
const fromWatchOnly = async (watchKey: string, owner = hotVault): Promise<bitcoin.Psbt> => {
    const w = new WatchOnlyWallet();
    w.setSecret(watchKey);
    w.init();
    const utxos = [{ height: 1, value: 100_000, address: owner._getExternalAddressByIndex(0), txId: 'aa'.repeat(32), vout: 0 }];
    const { psbt } = await w.createTransaction(utxos, [{ address: PAYEE, value: 5_000 }], 1, owner._getInternalAddressByIndex(0));
    return psbt;
};

const fingerprintsOf = (psbt: bitcoin.Psbt) =>
    psbt.data.inputs.flatMap(i => (i.bip32Derivation ?? []).map(d => Buffer.from(d.masterFingerprint).toString('hex')));

const validSignatures = (psbt: bitcoin.Psbt) =>
    psbt.validateSignaturesOfAllInputs((pubkey, msghash, signature) => ecc.verify(msghash, pubkey, signature));

/** One input and a change output, every key detail written as 00000000, change paying `changeScript` if given. */
const writtenAsUnknown = ({ changeScript, changeKey = root }: { changeScript?: Buffer; changeKey?: typeof root } = {}) => {
    const inPath = "m/84'/0'/0'/0/0";
    const changePath = "m/84'/0'/0'/1/0";
    const changePubkey = Buffer.from(changeKey.derivePath(changePath).publicKey);
    const psbt = new bitcoin.Psbt();
    psbt.addInput({
        hash: Buffer.alloc(32, 0xc4),
        index: 0,
        sequence: 0xfffffffd,
        witnessUtxo: { script: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(root.derivePath(inPath).publicKey) }).output as Buffer, value: 150_000 },
        bip32Derivation: [{ masterFingerprint: UNKNOWN, path: inPath, pubkey: Buffer.from(root.derivePath(inPath).publicKey) }],
    });
    psbt.addOutput({ address: PAYEE, value: 120_000 });
    psbt.addOutput({
        script: changeScript ?? (bitcoin.payments.p2wpkh({ pubkey: changePubkey }).output as Buffer),
        value: 29_000,
        bip32Derivation: [{ masterFingerprint: UNKNOWN, path: changePath, pubkey: changePubkey }],
    });
    return psbt;
};

describe("the signer's key screen", () => {
    it('gives the key with its fingerprint and path, as BIP84 has them', () => {
        // as the key screen builds it
        const path = hotVault.getDerivationPath() ?? "m/84'/0'/0'";
        expect(keyWithOrigin(String(hotVault.getMasterFingerprintHex()), path, hotVault.getXpub())).toBe(
            `[73c5da0a/84h/0h/0h]${BIP84_ZPUB}`,
        );
    });

    it("is read by the Cold Vault's import: not taken for a multisig, fingerprint, path and addresses right", () => {
        const text = `[73c5da0a/84h/0h/0h]${BIP84_ZPUB}`;
        const multisig = new MultisigHDWallet();
        multisig.setSecret(text);
        expect(multisig.getM()).toBe(0);
        const w = new WatchOnlyWallet();
        w.setSecret(text);
        expect(w.valid()).toBe(true);
        w.init();
        expect(w.getMasterFingerprintHex()).toBe('73c5da0a');
        expect(w.getDerivationPath()).toBe("m/84'/0'/0'");
        expect(w._getExternalAddressByIndex(0)).toBe(hotVault._getExternalAddressByIndex(0));
    });

    it('lets a watch-only wallet write the real fingerprint, which signs as before', async () => {
        const psbt = await fromWatchOnly(`[73c5da0a/84h/0h/0h]${BIP84_ZPUB}`);
        expect(fingerprintsOf(psbt)).toEqual(['73c5da0a']);
        expect(() => assertBackupMatches(psbt, root)).not.toThrow();
        expect(signWithRoot(psbt, root).signed).toBe(1);
    });
});

describe('a watch-only wallet set up from a bare xpub', () => {
    it('writes 00000000 for the fingerprint', async () => {
        expect(fingerprintsOf(await fromWatchOnly(BIP84_ZPUB))).toEqual(['00000000']);
    });

    it('is signed for from the seed, with change verified and its key details left as written', async () => {
        const psbt = await fromWatchOnly(BIP84_ZPUB);
        expect(() => assertBackupMatches(psbt, root)).not.toThrow();
        const review = reviewWithRoot(psbt, root);
        expect(review.ownInputs).toBe(1);
        expect(review.outputs.map(o => [o.address, o.change])).toEqual([
            [PAYEE, false],
            [hotVault._getInternalAddressByIndex(0), true],
        ]);
        const { psbt: signed, signed: count } = signWithRoot(psbt, root);
        expect(count).toBe(1);
        expect(validSignatures(signed)).toBe(true);
        expect(fingerprintsOf(signed)).toEqual(['00000000']);
    });

    it('is recognised by the Hot Vault, whose cosigning signs it', async () => {
        const psbt = await fromWatchOnly(hotVault.getXpub());
        const key = signingKeyForWallet(hotVault);
        expect(isForKey(psbt, key)).toBe(true);
        expect(() => assertKeyOwns(psbt, key, SIGN_VAULT_MISMATCH)).not.toThrow();
        expect(reviewWithWallet(psbt, a => hotVault.weOwnAddress(a), key).ownInputs).toBe(1);
        const copy = psbt.clone();
        hotVault.cosignPsbt(copy);
        const input = copy.data.inputs[0];
        expect((input.partialSig?.length ?? 0) > 0 || !!input.finalScriptWitness).toBe(true);
    });
});

describe('00000000 is not a pass for anyone', () => {
    it("refuses another seed's transaction", async () => {
        const other = hdWallet(OTHER_PHRASE);
        const psbt = await fromWatchOnly(other.getXpub(), other);
        expect(fingerprintsOf(psbt)).toEqual(['00000000']);
        expect(() => assertBackupMatches(psbt, root)).toThrow(SIGN_BACKUP_MISMATCH);
        expect(() => signWithRoot(psbt, root)).toThrow(SIGN_NOTHING_SIGNED);
        expect(() => assertKeyOwns(psbt, signingKeyForWallet(hotVault), SIGN_VAULT_MISMATCH)).toThrow(SIGN_VAULT_MISMATCH);
    });

    it("doesn't take the Hot Vault's public key under another account's path", async () => {
        const psbt = await fromWatchOnly(BIP84_ZPUB);
        (psbt.data.inputs[0].bip32Derivation ?? [])[0].path = "m/44'/0'/0'/0/0";
        expect(() => assertKeyOwns(psbt, signingKeyForWallet(hotVault), SIGN_VAULT_MISMATCH)).toThrow(SIGN_VAULT_MISMATCH);
        expect(() => assertBackupMatches(psbt, root)).toThrow(SIGN_BACKUP_MISMATCH);
    });

    it('stops change written as 00000000 that pays someone else', () => {
        const attacker = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 0x66) });
        expect(() => reviewWithRoot(writtenAsUnknown({ changeScript: attacker.output as Buffer }), root)).toThrow(SIGN_FALSE_CHANGE);
        expect(reviewWithRoot(writtenAsUnknown(), root).outputs[1].change).toBe(true);
    });

    it("shows an output with someone else's key as a payment, not as change", () => {
        const review = reviewWithRoot(writtenAsUnknown({ changeKey: otherRoot }), root);
        expect(review.outputs[1].change).toBe(false);
        expect(review.ownInputs).toBe(1);
    });
});
