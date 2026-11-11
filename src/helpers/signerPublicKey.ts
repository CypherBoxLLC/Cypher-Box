import * as bitcoin from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import b58 from 'bs58check';

import { multisigKeyFromRoot } from './multisigKey';
import { ADDRESS_SEARCH_LIMIT, PolicyKey, forgetKeyCache, isP2wpkhScript, policyKeyPubkey } from './multisigPolicy';
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
    /** the m/48' key with its origin, for a multisig coordinator such as Nunchuk or Sparrow */
    multisigKey: string;
    /** the account key as a plain xpub: what's remembered for address checks */
    accountXpub: string;
}

/**
 * A single-key account remembered on the signer, so "Receive - Check Address" can check its addresses without the
 * seed's SeedQR. Public key only, but it shows every address of the wallet, so it lives in the encrypted store.
 */
export interface SignerAccount {
    /** the seed's master fingerprint, lower case */
    fingerprint: string;
    path: string;
    xpub: string;
    addedAt: number;
}

/** What's remembered of a seed whose SeedQR was scanned to check an address. */
export const signerAccountFromRoot = (root: BIP32Interface): SignerAccount => ({
    fingerprint: Buffer.from(root.fingerprint).toString('hex'),
    path: SIGNER_KEY_PATH,
    xpub: root.derivePath(SIGNER_KEY_PATH).neutered().toBase58(),
    addedAt: Date.now(),
});

/** What a seed's key screen remembers of it. */
export const signerAccountOf = (info: SignerPublicKey): SignerAccount => ({
    fingerprint: info.fingerprint.toLowerCase(),
    path: info.path,
    xpub: info.accountXpub,
    addedAt: Date.now(),
});

/**
 * Everything the signer's key screen shows, from the seed's root key. It used to be worked out through BlueWallet's
 * wallet class, which turned the words into a seed again for each value; the root is made once now, so the slow
 * step runs once.
 */
export function signerPublicKey(root: BIP32Interface): SignerPublicKey {
    const fingerprint = Buffer.from(root.fingerprint).toString('hex').toUpperCase();
    const account = root.derivePath(SIGNER_KEY_PATH);
    const accountXpub = account.neutered().toBase58();
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
        multisigKey: multisigKeyFromRoot(root),
        accountXpub,
    };
}

export interface SingleKeyMatch {
    /** the seed's master fingerprint, upper case */
    fingerprint: string;
    /** 0 receive, 1 change */
    branch: 0 | 1;
    index: number;
}

type SearchOptions = { limit?: number; onProgress?: (checked: number) => void; isCancelled?: () => boolean };

/**
 * Looks for a native SegWit single-key address among the first `limit` receive and change addresses of these accounts
 * (m/84'/0'/0' public keys), lowest index first, yielding to the screen now and then. Null if it isn't there.
 */
export async function findSingleKeyAddressIn(
    accounts: Array<Pick<SignerAccount, 'fingerprint' | 'path' | 'xpub'>>,
    script: Buffer,
    options: SearchOptions = {},
): Promise<SingleKeyMatch | null> {
    const limit = options.limit ?? ADDRESS_SEARCH_LIMIT;
    if (!isP2wpkhScript(script) || !accounts.length) return null;
    const keys: PolicyKey[] = accounts.map(a => ({ fingerprint: a.fingerprint.toLowerCase(), path: a.path, xpub: a.xpub }));
    for (let index = 0; index < limit; index++) {
        for (const key of keys) {
            for (const branch of [0, 1] as const) {
                const pubkey = policyKeyPubkey(key, branch, index);
                if ((bitcoin.payments.p2wpkh({ pubkey }).output as Buffer).equals(script)) {
                    return { fingerprint: key.fingerprint.toUpperCase(), branch, index };
                }
            }
        }
        if (index % 20 === 19) {
            options.onProgress?.(index + 1);
            await new Promise(resolve => setTimeout(resolve, 0));
            if (options.isCancelled?.()) return null;
        }
    }
    options.onProgress?.(limit);
    return null;
}

/**
 * The same search through one seed's account, from its root key, as when its SeedQR was scanned for the check.
 * Only the account's public key is used, and what the search keeps of it is dropped at the end.
 */
export async function findSingleKeyAddress(root: BIP32Interface, script: Buffer, options: SearchOptions = {}): Promise<SingleKeyMatch | null> {
    const account = {
        fingerprint: Buffer.from(root.fingerprint).toString('hex'),
        path: SIGNER_KEY_PATH,
        xpub: root.derivePath(SIGNER_KEY_PATH).neutered().toBase58(),
    };
    try {
        return await findSingleKeyAddressIn([account], script, options);
    } finally {
        forgetKeyCache(account.xpub);
    }
}
