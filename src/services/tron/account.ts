/**
 * The user's Tron account, from the Hot Vault.
 *
 * USDT rides on the Hot Vault's seed rather than a new one: the phrase the user
 * already backs up restores their dollars too, and at the standard BIP44 path
 * any other wallet restores the same address. See ./keys for the derivation.
 *
 * Wallets are passed in rather than reached for, matching the other derive
 * services here, so this stays testable and free of React.
 *
 * The passphrase matters. A Hot Vault can carry a BIP39 passphrase, and
 * deriving without it produces a different, empty address that no recovery
 * would ever find. It is read through the wallet's own getter and included.
 *
 * Nothing here logs: everything in scope is seed material.
 */

import { type TronAccount, deriveTronAccount } from './keys';

/** The slice of a BlueWallet HD wallet this needs. */
export type SeedBearingWallet = {
    getID?: () => string;
    getSecret?: () => string;
    getPassphrase?: () => string | undefined;
};

/**
 * Derive the Tron account for one wallet.
 *
 * Returns null when the wallet cannot supply a phrase at all: a watch-only or
 * cold wallet holds no secret, and that is an ordinary state rather than a
 * fault. Throws when a phrase is present but not a valid mnemonic, because
 * that means we are reading the wrong thing and a silent null would hide it.
 */
export function deriveTronAccountFromWallet(
    wallet: SeedBearingWallet | null | undefined,
): TronAccount | null {
    const secret = typeof wallet?.getSecret === 'function' ? wallet.getSecret() : null;
    if (typeof secret !== 'string' || secret.trim().length === 0) {
        return null;
    }
    // A single-word or hex secret is a WIF or xpub wallet, not a mnemonic one.
    const phrase = secret.trim().replace(/\s+/g, ' ');
    if (!phrase.includes(' ')) {
        return null;
    }
    const passphrase =
        typeof wallet?.getPassphrase === 'function' ? wallet.getPassphrase() || undefined : undefined;
    return deriveTronAccount(phrase, 0, 0, passphrase);
}

/**
 * Find the Hot Vault among the app's wallets and derive its Tron account.
 *
 * Takes the wallet list and the active Hot Vault id, which is what every screen
 * already has to hand (`wallets` from the storage context, `walletID` from the
 * auth store), so a caller needs one line and no knowledge of derivation.
 *
 * Returns null when there is no Hot Vault yet. A user who has only connected
 * Strike or CoinOS has no seed of their own, and the receive flow has to create
 * a Hot Vault before it can show a USDT address.
 */
export function resolveHotVaultTronAccount(
    wallets: readonly SeedBearingWallet[] | null | undefined,
    walletID: string | null | undefined,
): TronAccount | null {
    if (!wallets?.length || !walletID) {
        return null;
    }
    const wallet = wallets.find(w => typeof w?.getID === 'function' && w.getID() === walletID);
    return wallet ? deriveTronAccountFromWallet(wallet) : null;
}
