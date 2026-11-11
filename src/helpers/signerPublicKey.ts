import * as bitcoin from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import b58 from 'bs58check';

import { keyWithOrigin } from './signOnce';

/** The seed-signer's single-key account: native SegWit, the path a Cold Vault or Sparrow watches. */
export const SIGNER_KEY_PATH = "m/84'/0'/0'";

// SLIP-132's version for a native SegWit account key, as BlueWallet writes it
const ZPUB_VERSION = Buffer.from('04b24746', 'hex');

export interface SignerPublicKey {
    /** the account key as a zpub */
    xpub: string;
    /** the xpub with its origin, `[fingerprint/84h/0h/0h]zpub…`: what the watch-only wallet is given */
    key: string;
    /** the master key fingerprint, upper case */
    fingerprint: string;
    /** receive addresses 0, 1 and 2 */
    addresses: string[];
    path: string;
}

/**
 * Everything the signer's key screen shows, from the seed's root key. It used to be worked out through BlueWallet's
 * wallet class, which turned the words into a seed again for each value; the root is made once now, so the slow
 * step runs once.
 */
export function signerPublicKey(root: BIP32Interface): SignerPublicKey {
    const fingerprint = Buffer.from(root.fingerprint).toString('hex').toUpperCase();
    const account = root.derivePath(SIGNER_KEY_PATH);
    const xpub = b58.encode(Buffer.concat([ZPUB_VERSION, Buffer.from(b58.decode(account.neutered().toBase58()).subarray(4))]));
    const receive = account.derive(0);
    const addresses = [0, 1, 2].map(i => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(receive.derive(i).publicKey) }).address as string);
    return {
        xpub,
        // a bare xpub leaves the watch-only wallet without the master fingerprint
        key: keyWithOrigin(fingerprint, SIGNER_KEY_PATH, xpub),
        fingerprint,
        addresses,
        path: SIGNER_KEY_PATH,
    };
}
