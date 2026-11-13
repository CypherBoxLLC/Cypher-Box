/**
 * Everything the signer's key screen shows, from one root key. BIP84's published vectors anchor it; BlueWallet's
 * wallet class, which the screen used before, has to agree with it for random phrases and passphrases, so nothing a
 * watch-only wallet was given before changes.
 */

import crypto from 'crypto';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import { HDSegwitBech32Wallet } from '../../class';
import { SIGNER_KEY_PATH, signerPublicKey } from '../../src/helpers/signerPublicKey';

const bip32 = BIP32Factory(ecc);
const rootOf = (mnemonic: string, passphrase = '') => bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase));

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// BIP84's published account key and first two receive addresses for ABANDON
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const BIP84_RECEIVE = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'];

// what CreateSignerSeed worked out before, through BlueWallet's wallet class
const viaWalletClass = (mnemonic: string, passphrase: string) => {
    const w = new HDSegwitBech32Wallet();
    w.setSecret(mnemonic);
    if (passphrase) w.setPassphrase(passphrase);
    return {
        xpub: w.getXpub(),
        fingerprint: String(w.getMasterFingerprintHex()).toUpperCase(),
        addresses: [0, 1, 2].map(i => w._getExternalAddressByIndex(i)),
        path: w.getDerivationPath(),
    };
};

describe('signerPublicKey', () => {
    it("gives BIP84's account key and addresses, with the origin", () => {
        const info = signerPublicKey(rootOf(ABANDON));
        expect(info.fingerprint).toBe('73C5DA0A');
        expect(info.path).toBe("m/84'/0'/0'");
        expect(SIGNER_KEY_PATH).toBe("m/84'/0'/0'");
        expect(info.xpub).toBe(ZPUB);
        expect(info.key).toBe(`[73c5da0a/84h/0h/0h]${ZPUB}`);
        expect(info.addresses).toHaveLength(3);
        expect(info.addresses.slice(0, 2)).toEqual(BIP84_RECEIVE);
    });

    it('agrees with the wallet class it replaces, for random 12- and 24-word phrases and passphrases', () => {
        const passphrases = ['', 'TREZOR', 'Ünïcödé ₿ 🔑', ' spaced  out '];
        for (let i = 0; i < 8; i++) {
            const mnemonic = bip39.entropyToMnemonic(crypto.randomBytes(i % 2 ? 32 : 16).toString('hex'));
            const passphrase = passphrases[i % passphrases.length];
            const info = signerPublicKey(rootOf(mnemonic, passphrase));
            const before = viaWalletClass(mnemonic, passphrase);
            expect({ xpub: info.xpub, fingerprint: info.fingerprint, addresses: info.addresses, path: info.path }).toEqual(before);
            expect(info.key).toBe(`[${before.fingerprint.toLowerCase()}/84h/0h/0h]${before.xpub}`);
        }
    });

    it("doesn't make the seed again: everything comes from the root it's given", () => {
        const root = rootOf(ABANDON);
        const spy = jest.spyOn(bip39, 'mnemonicToSeedSync');
        try {
            signerPublicKey(root);
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
