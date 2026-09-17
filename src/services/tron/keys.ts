/**
 * Tron keys, derived from the wallet's existing seed.
 *
 * One seed, one recovery phrase: the Tron account comes from the same mnemonic
 * as everything else, at BIP44 coin type 195, so a user who backs up their
 * phrase has already backed up their USDT. There is no separate Tron seed to
 * create, lose, or explain.
 *
 * The private key never leaves this module as a return value. Callers that need
 * to sign pass a function to withTronPrivateKey, which zeroes the buffer
 * afterwards, so the key exists for as long as the signature takes and no
 * longer. Nothing here logs, for the same reason.
 */

import { getPublicKey } from '@noble/secp256k1';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';

import ecc from '../../../blue_modules/noble_ecc';
import { tronAddressFromPublicKey } from './address';

const bip32 = BIP32Factory(ecc);

/** BIP44 coin type for Tron, as registered in SLIP-44. */
export const TRON_COIN_TYPE = 195;

/**
 * The path every Tron wallet uses, so the same phrase restores the same
 * address in other wallets. Account and address indexes are exposed for
 * completeness; we ship index 0 and have no reason to move.
 */
export const tronDerivationPath = (accountIndex = 0, addressIndex = 0): string =>
    `m/44'/${TRON_COIN_TYPE}'/${accountIndex}'/0/${addressIndex}`;

export type TronAccount = {
    /** The derivation path used, worth recording next to a stored address. */
    readonly path: string;
    /** Base58 form, what the user sees and what senders paste. */
    readonly address: string;
    /** Uncompressed public key hex, for callers that verify a signature. */
    readonly publicKey: string;
};

function assertMnemonic(mnemonic: string): void {
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid recovery phrase');
    }
}

function derivePrivateKey(
    mnemonic: string,
    accountIndex: number,
    addressIndex: number,
    passphrase?: string,
): { privateKey: Buffer; path: string } {
    assertMnemonic(mnemonic);
    const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
    const path = tronDerivationPath(accountIndex, addressIndex);
    const node = bip32.fromSeed(seed).derivePath(path);
    if (!node.privateKey) {
        throw new Error('Derivation produced no private key');
    }
    return { privateKey: Buffer.from(node.privateKey), path };
}

/**
 * The user's Tron account: path, address, public key. No private key, so this
 * is safe to hold in state and show in a UI.
 */
export function deriveTronAccount(
    mnemonic: string,
    accountIndex = 0,
    addressIndex = 0,
    passphrase?: string,
): TronAccount {
    const { privateKey, path } = derivePrivateKey(mnemonic, accountIndex, addressIndex, passphrase);
    try {
        const publicKey = Buffer.from(getPublicKey(privateKey, false));
        return { path, address: tronAddressFromPublicKey(publicKey), publicKey: publicKey.toString('hex') };
    } finally {
        privateKey.fill(0);
    }
}

/**
 * Run something with the private key in hand, then wipe it.
 *
 * Shaped this way so a key cannot be held by accident: the caller gets it for
 * the duration of one call. Do not return it, copy it, or close over it.
 */
export function withTronPrivateKey<T>(
    mnemonic: string,
    use: (privateKey: Buffer) => T,
    accountIndex = 0,
    addressIndex = 0,
    passphrase?: string,
): T {
    const { privateKey } = derivePrivateKey(mnemonic, accountIndex, addressIndex, passphrase);
    try {
        return use(privateKey);
    } finally {
        privateKey.fill(0);
    }
}
