/**
 * Everything the signer's key screen shows, from one root key. BIP84's published vectors and the @scure-made multisig
 * keys of multisigKey.test.ts anchor it; BlueWallet's wallet class, which the screen used before, has to agree with it
 * for random phrases and passphrases, so nothing a watch-only wallet was given before changes.
 */

import crypto from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';

import ecc from '../../blue_modules/noble_ecc';
import { HDSegwitBech32Wallet } from '../../class';
import { multisigKeyExpression } from '../../src/helpers/multisigKey';
import { SIGNER_KEY_PATH, findSingleKeyAddress, findSingleKeyAddressIn, signerAccountOf, signerPublicKey } from '../../src/helpers/signerPublicKey';
import b58 from 'bs58check';
import { addressFromText } from '../../src/helpers/multisigPolicy';

const bip32 = BIP32Factory(ecc);
const rootOf = (mnemonic: string, passphrase = '') => bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase));

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// BIP84's published account key and first two receive addresses for ABANDON
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const BIP84_RECEIVE = ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'];
// BIP84's first change address for the same phrase
const BIP84_CHANGE_0 = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
const MULTISIG_KEY =
    '[73c5da0a/48h/0h/0h/2h]xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf';

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
        multisigKey: multisigKeyExpression(mnemonic, passphrase),
    };
};

describe('signerPublicKey', () => {
    it("gives BIP84's account key and addresses, with the origin, and the multisig key", () => {
        const info = signerPublicKey(rootOf(ABANDON));
        expect(info.fingerprint).toBe('73C5DA0A');
        expect(info.path).toBe("m/84'/0'/0'");
        expect(SIGNER_KEY_PATH).toBe("m/84'/0'/0'");
        expect(info.xpub).toBe(ZPUB);
        expect(info.key).toBe(`[73c5da0a/84h/0h/0h]${ZPUB}`);
        expect(info.addresses).toHaveLength(3);
        expect(info.addresses.slice(0, 2)).toEqual(BIP84_RECEIVE);
        expect(info.multisigKey).toBe(MULTISIG_KEY);
        // the same account key as a plain xpub: BIP84's zpub with xpub's version bytes
        const zpub = Buffer.from(b58.decode(ZPUB));
        expect(info.accountXpub).toBe(b58.encode(Buffer.concat([Buffer.from('0488b21e', 'hex'), zpub.subarray(4)])));
        expect(signerAccountOf(info)).toEqual({ fingerprint: '73c5da0a', path: "m/84'/0'/0'", xpub: info.accountXpub, addedAt: expect.any(Number) });
    });

    it('agrees with the wallet class it replaces, for random 12- and 24-word phrases and passphrases', () => {
        const passphrases = ['', 'TREZOR', 'Ünïcödé ₿ 🔑', ' spaced  out '];
        for (let i = 0; i < 8; i++) {
            const mnemonic = bip39.entropyToMnemonic(crypto.randomBytes(i % 2 ? 32 : 16).toString('hex'));
            const passphrase = passphrases[i % passphrases.length];
            const info = signerPublicKey(rootOf(mnemonic, passphrase));
            const before = viaWalletClass(mnemonic, passphrase);
            expect({ xpub: info.xpub, fingerprint: info.fingerprint, addresses: info.addresses, path: info.path, multisigKey: info.multisigKey })
                .toEqual(before);
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

describe('findSingleKeyAddressIn', () => {
    it('finds an address from remembered public keys alone, no seed', async () => {
        const legal = signerAccountOf(signerPublicKey(rootOf('legal winner thank year wave sausage worth useful legal winner thank yellow')));
        const abandon = signerAccountOf(signerPublicKey(rootOf(ABANDON)));
        const script = addressFromText(BIP84_CHANGE_0).script;
        expect(await findSingleKeyAddressIn([legal, abandon], script)).toEqual({ fingerprint: '73C5DA0A', branch: 1, index: 0 });
        expect(await findSingleKeyAddressIn([legal], script, { limit: 30 })).toBeNull();
        expect(await findSingleKeyAddressIn([], script)).toBeNull();
    });
});

describe('findSingleKeyAddress', () => {
    const script = (address: string) => addressFromText(address).script;
    const root = rootOf(ABANDON);

    it("finds BIP84's receive and change addresses, saying which", async () => {
        expect(await findSingleKeyAddress(root, script(BIP84_RECEIVE[0]))).toEqual({ fingerprint: '73C5DA0A', branch: 0, index: 0 });
        expect(await findSingleKeyAddress(root, script(BIP84_RECEIVE[1]))).toEqual({ fingerprint: '73C5DA0A', branch: 0, index: 1 });
        expect(await findSingleKeyAddress(root, script(BIP84_CHANGE_0))).toEqual({ fingerprint: '73C5DA0A', branch: 1, index: 0 });
    });

    it('finds a later address, as the wallet class derives it', async () => {
        const w = new HDSegwitBech32Wallet();
        w.setSecret(ABANDON);
        expect(await findSingleKeyAddress(root, script(w._getExternalAddressByIndex(37)))).toEqual({ fingerprint: '73C5DA0A', branch: 0, index: 37 });
        expect(await findSingleKeyAddress(root, script(w._getInternalAddressByIndex(12)))).toEqual({ fingerprint: '73C5DA0A', branch: 1, index: 12 });
    });

    it("doesn't find another seed's address, or this one's without its passphrase, and counts how far it looked", async () => {
        const legal = signerPublicKey(rootOf('legal winner thank year wave sausage worth useful legal winner thank yellow')).addresses[0];
        const progress: number[] = [];
        expect(await findSingleKeyAddress(root, script(legal), { limit: 50, onProgress: n => progress.push(n) })).toBeNull();
        expect(progress[progress.length - 1]).toBe(50);
        expect(await findSingleKeyAddress(rootOf(ABANDON, 'TREZOR'), script(BIP84_RECEIVE[0]), { limit: 30 })).toBeNull();
    });

    it('only looks for native SegWit single-key addresses, and stops when told', async () => {
        const multisig = bitcoin.payments.p2wsh({ hash: Buffer.alloc(32, 1) }).output as Buffer;
        expect(await findSingleKeyAddress(root, multisig)).toBeNull();
        const other = signerPublicKey(rootOf('legal winner thank year wave sausage worth useful legal winner thank yellow')).addresses[1];
        const progress: number[] = [];
        expect(await findSingleKeyAddress(root, script(other), { onProgress: n => progress.push(n), isCancelled: () => true })).toBeNull();
        expect(progress).toEqual([20]);
    });
});
