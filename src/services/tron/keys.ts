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
 *
 * Every derivation has a Native form, which does BIP39's seed step in native
 * code. The app uses those; see mnemonicToSeedNative for why.
 */

import { getPublicKey } from '@noble/secp256k1';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import Aes from 'react-native-aes-crypto';

import ecc from '../../../blue_modules/noble_ecc';
import { tronAddressFromPublicKey } from './address';

const bip32 = BIP32Factory(ecc);

/** BIP44 coin type for Tron, as registered in SLIP-44. */
export const TRON_COIN_TYPE = 195;

/** BIP39's seed: PBKDF2 with HMAC-SHA512, 2048 rounds, 64 bytes. */
const BIP39_ROUNDS = 2048;
const BIP39_SEED_BITS = 512;

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

type DerivedKey = { privateKey: Buffer; path: string };

function assertMnemonic(mnemonic: string): void {
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid recovery phrase');
    }
}

/**
 * The BIP39 seed, computed by the phone's native PBKDF2.
 *
 * The same function as bip39.mnemonicToSeedSync, fed the same bytes, run in
 * native code instead: Apple's CommonCrypto on iOS, Bouncy Castle on Android.
 * bip39 runs it in JavaScript on the app's only JS thread, measured at 5.3
 * seconds on an iPhone XR against 2 ms natively, with the app frozen for all
 * of it. The Ark backup code moved to the native call for the same reason.
 *
 * The inputs mirror bip39 3.1.0 exactly: the phrase NFKD-normalized, and the
 * salt "mnemonic" followed by the NFKD-normalized passphrase. Both native
 * implementations encode them as UTF-8, as bip39 does.
 */
export async function mnemonicToSeedNative(mnemonic: string, passphrase?: string): Promise<Buffer> {
    const seedHex = await Aes.pbkdf2(
        (mnemonic || '').normalize('NFKD'),
        `mnemonic${(passphrase || '').normalize('NFKD')}`,
        BIP39_ROUNDS,
        BIP39_SEED_BITS, // in bits: Aes.pbkdf2 takes the length in bits
        'sha512',
    );
    // iOS answers a parameter error with an empty string rather than an error,
    // and anything short of a full seed would derive a wrong address that still
    // looks valid.
    if (typeof seedHex !== 'string' || !/^[0-9a-f]{128}$/i.test(seedHex)) {
        throw new Error('Could not derive the wallet seed');
    }
    return Buffer.from(seedHex, 'hex');
}

/** The key at the Tron path under a seed. The seed is wiped once used. */
function privateKeyFromSeed(seed: Buffer, accountIndex: number, addressIndex: number): DerivedKey {
    try {
        const path = tronDerivationPath(accountIndex, addressIndex);
        const node = bip32.fromSeed(seed).derivePath(path);
        if (!node.privateKey) {
            throw new Error('Derivation produced no private key');
        }
        return { privateKey: Buffer.from(node.privateKey), path };
    } finally {
        seed.fill(0);
    }
}

/**
 * The seed step in JavaScript. It blocks the JS thread for seconds on a phone,
 * so the app uses derivePrivateKeyNative; this stays as the reference the
 * native path is tested against, and for a caller that must be synchronous.
 */
function derivePrivateKey(
    mnemonic: string,
    accountIndex: number,
    addressIndex: number,
    passphrase?: string,
): DerivedKey {
    assertMnemonic(mnemonic);
    return privateKeyFromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase), accountIndex, addressIndex);
}

async function derivePrivateKeyNative(
    mnemonic: string,
    accountIndex: number,
    addressIndex: number,
    passphrase?: string,
): Promise<DerivedKey> {
    assertMnemonic(mnemonic);
    return privateKeyFromSeed(await mnemonicToSeedNative(mnemonic, passphrase), accountIndex, addressIndex);
}

/** The public half of a derived key. The private key is wiped either way. */
function accountFromKey({ privateKey, path }: DerivedKey): TronAccount {
    try {
        const publicKey = Buffer.from(getPublicKey(privateKey, false));
        return { path, address: tronAddressFromPublicKey(publicKey), publicKey: publicKey.toString('hex') };
    } finally {
        privateKey.fill(0);
    }
}

/**
 * The user's Tron account: path, address, public key. No private key, so this
 * is safe to hold in state and show in a UI.
 *
 * Synchronous, so the seed step runs in JavaScript. The app uses
 * deriveTronAccountNative.
 */
export function deriveTronAccount(
    mnemonic: string,
    accountIndex = 0,
    addressIndex = 0,
    passphrase?: string,
): TronAccount {
    return accountFromKey(derivePrivateKey(mnemonic, accountIndex, addressIndex, passphrase));
}

/** deriveTronAccount with the seed step done natively: the same account, in milliseconds. */
export async function deriveTronAccountNative(
    mnemonic: string,
    accountIndex = 0,
    addressIndex = 0,
    passphrase?: string,
): Promise<TronAccount> {
    return accountFromKey(await derivePrivateKeyNative(mnemonic, accountIndex, addressIndex, passphrase));
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

/**
 * withTronPrivateKey with the seed step done natively. `use` stays synchronous,
 * so the key is still wiped the moment the one call returns.
 */
export async function withTronPrivateKeyNative<T>(
    mnemonic: string,
    use: (privateKey: Buffer) => T,
    accountIndex = 0,
    addressIndex = 0,
    passphrase?: string,
): Promise<T> {
    const { privateKey } = await derivePrivateKeyNative(mnemonic, accountIndex, addressIndex, passphrase);
    try {
        return use(privateKey);
    } finally {
        privateKey.fill(0);
    }
}
