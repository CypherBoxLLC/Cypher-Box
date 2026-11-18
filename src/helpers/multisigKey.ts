import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';

import ecc from '../../blue_modules/noble_ecc';

/**
 * The seed-signer's key for a multisig wallet made in a coordinator such as Nunchuk, where this seed is one key of
 * several. It is a different key from the single-key (m/84') one: the standard native SegWit multisig path, given with
 * its origin so the coordinator knows which seed it belongs to and where it was derived.
 */

const bip32 = BIP32Factory(ecc);

export const MULTISIG_KEY_PATH = "m/48'/0'/0'/2'";

/** The same key, from a seed's root key that's already been made. */
export function multisigKeyFromRoot(root: BIP32Interface): string {
    const fingerprint = Buffer.from(root.fingerprint).toString('hex');
    const origin = MULTISIG_KEY_PATH.replace(/^m/, fingerprint).replace(/'/g, 'h');
    return `[${origin}]${root.derivePath(MULTISIG_KEY_PATH).neutered().toBase58()}`;
}

/**
 * `[fingerprint/48h/0h/0h/2h]xpub…` for a recovery phrase: the master fingerprint in lowercase hex, `h` for hardened
 * steps and a plain xpub (not Zpub), the form coordinators read from an air-gapped signer's QR.
 */
export function multisigKeyExpression(mnemonic: string, passphrase = ''): string {
    if (!bip39.validateMnemonic(mnemonic)) throw new Error("Those words aren't a valid recovery phrase.");
    return multisigKeyFromRoot(bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase)));
}
