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
 * Deriving is paid for once per session. Every USDT screen and the card on
 * Home used to derive on opening, and each derivation froze the app for 5.3
 * seconds on an iPhone XR, which is what made their buttons feel dead. The
 * account is now derived natively (see loadHotVaultTronAccount) and kept by
 * wallet ID, public parts only.
 *
 * Nothing here logs: everything in scope is seed material.
 */

import { type TronAccount, deriveTronAccount, deriveTronAccountNative } from './keys';
import { type UsdtTransferSigner, signUsdtTransferNative } from './transaction';

/** The slice of a BlueWallet HD wallet this needs. */
export type SeedBearingWallet = {
    getID?: () => string;
    getSecret?: () => string;
    getPassphrase?: () => string | undefined;
};

/**
 * Accounts derived this session, by wallet ID. Path, address and public key
 * only, never a key. A wallet's ID is a hash of its type, phrase, passphrase
 * and path, so one ID always derives one account and an entry cannot go stale.
 */
const derivedAccounts = new Map<string, TronAccount>();

/** The wallet's phrase and passphrase, or null when it holds no phrase. */
function walletPhrase(
    wallet: SeedBearingWallet | null | undefined,
): { mnemonic: string; passphrase: string | undefined } | null {
    const secret = typeof wallet?.getSecret === 'function' ? wallet.getSecret() : null;
    if (typeof secret !== 'string' || secret.trim().length === 0) {
        return null;
    }
    // A single-word or hex secret is a WIF or xpub wallet, not a mnemonic one.
    const mnemonic = secret.trim().replace(/\s+/g, ' ');
    if (!mnemonic.includes(' ')) {
        return null;
    }
    const passphrase =
        typeof wallet?.getPassphrase === 'function' ? wallet.getPassphrase() || undefined : undefined;
    return { mnemonic, passphrase };
}

/**
 * Whether this wallet could hold USDT, without deriving anything.
 *
 * deriveTronAccountFromWallet runs BIP39's PBKDF2 over 2048 rounds, which is
 * far too expensive for Home's carousel, which only needs to know whether to
 * add the USDT slide. This is the same phrase check stopped short of the
 * derivation, so the gate matches exactly when the card will have an address.
 */
export function walletCanHoldUsdt(wallet: SeedBearingWallet | null | undefined): boolean {
    return walletPhrase(wallet) !== null;
}

/**
 * Derive the Tron account for one wallet.
 *
 * Returns null when the wallet cannot supply a phrase at all: a watch-only or
 * cold wallet holds no secret, and that is an ordinary state rather than a
 * fault. Throws when a phrase is present but not a valid mnemonic, because
 * that means we are reading the wrong thing and a silent null would hide it.
 *
 * Synchronous, so the seed step runs in JavaScript and takes seconds on a
 * phone. Screens go through resolveHotVaultTronAccount, which reuses the
 * session's account.
 */
export function deriveTronAccountFromWallet(
    wallet: SeedBearingWallet | null | undefined,
): TronAccount | null {
    const phrase = walletPhrase(wallet);
    return phrase ? deriveTronAccount(phrase.mnemonic, 0, 0, phrase.passphrase) : null;
}

/**
 * A transfer signer for this wallet's Tron account, for the send flow.
 *
 * Reads the phrase and passphrase from the wallet each time it signs instead
 * of keeping a copy, and signs only through signUsdtTransferNative, which
 * builds the bytes itself and checks the signature recovers to the sender.
 * Returns null for a wallet with no phrase, as deriveTronAccountFromWallet
 * does.
 */
export function tronTransferSignerForWallet(
    wallet: SeedBearingWallet | null | undefined,
): UsdtTransferSigner | null {
    if (!wallet || !walletPhrase(wallet)) {
        return null;
    }
    return async request => {
        const phrase = walletPhrase(wallet);
        if (!phrase) {
            throw new Error('This wallet no longer holds its recovery phrase, so it cannot sign');
        }
        return signUsdtTransferNative(request, phrase.mnemonic, phrase.passphrase);
    };
}

function findHotVault(
    wallets: readonly SeedBearingWallet[] | null | undefined,
    walletID: string | null | undefined,
): SeedBearingWallet | null {
    if (!wallets?.length || !walletID) {
        return null;
    }
    return wallets.find(w => typeof w?.getID === 'function' && w.getID() === walletID) ?? null;
}

/**
 * Find the Hot Vault among the app's wallets and return its Tron account.
 *
 * Takes the wallet list and the active Hot Vault id, which is what every screen
 * already has to hand (`wallets` from the storage context, `walletID` from the
 * auth store), so a caller needs one line and no knowledge of derivation.
 *
 * Returns null when there is no Hot Vault yet. A user who has only connected
 * Strike or CoinOS has no seed of their own, and the receive flow has to create
 * a Hot Vault before it can show a USDT address.
 *
 * Answers from the session's account, which the card on Home loads natively
 * before any USDT screen can be opened. Only when nothing has loaded it yet
 * does it derive here, synchronously and slowly, and keep the result.
 */
export function resolveHotVaultTronAccount(
    wallets: readonly SeedBearingWallet[] | null | undefined,
    walletID: string | null | undefined,
): TronAccount | null {
    const wallet = findHotVault(wallets, walletID);
    if (!wallet || !walletID) {
        return null;
    }
    const known = derivedAccounts.get(walletID);
    if (known) {
        return known;
    }
    const account = deriveTronAccountFromWallet(wallet);
    if (account) {
        derivedAccounts.set(walletID, account);
    }
    return account;
}

/**
 * What is known about the Hot Vault's account without deriving anything: the
 * account once this session has it, null when there is no Hot Vault or it
 * holds no phrase, and undefined while it has yet to be derived.
 */
export function peekHotVaultTronAccount(
    wallets: readonly SeedBearingWallet[] | null | undefined,
    walletID: string | null | undefined,
): TronAccount | null | undefined {
    const wallet = findHotVault(wallets, walletID);
    if (!wallet || !walletID || !walletCanHoldUsdt(wallet)) {
        return null;
    }
    return derivedAccounts.get(walletID);
}

/**
 * The Hot Vault's account, derived natively and kept for the session.
 *
 * Milliseconds instead of seconds, and off the JS thread for the expensive
 * part, so nothing freezes. Throws on a phrase that is not a valid mnemonic,
 * as deriveTronAccountFromWallet does.
 */
export async function loadHotVaultTronAccount(
    wallets: readonly SeedBearingWallet[] | null | undefined,
    walletID: string | null | undefined,
): Promise<TronAccount | null> {
    const wallet = findHotVault(wallets, walletID);
    if (!wallet || !walletID) {
        return null;
    }
    const known = derivedAccounts.get(walletID);
    if (known) {
        return known;
    }
    const phrase = walletPhrase(wallet);
    if (!phrase) {
        return null;
    }
    const account = await deriveTronAccountNative(phrase.mnemonic, 0, 0, phrase.passphrase);
    derivedAccounts.set(walletID, account);
    return account;
}

/** Forget the session's accounts. For tests. */
export function forgetDerivedTronAccounts(): void {
    derivedAccounts.clear();
}
