/**
 * Getting an on-chain address from one of the app's own vaults, so a USDT
 * swap can pay the bitcoin into it.
 *
 * The Lightning rails answer with an invoice for a named amount; a vault
 * answers with a receive address and no amount, which is the better of the
 * two for a swap: the user's USDT amount stays the amount, priced exact_in,
 * with none of the drift an invoice's fixed sats introduce.
 *
 * Resolved the way the buy flow resolves a vault deposit address: ask the
 * wallet's server first, and fall back to deriving the next free address
 * locally when it does not answer quickly. A swap should not wait on a server
 * for an address it can work out itself.
 */

import type { SwapWallet } from "./WalletPicker";

/** How long to wait for the vault's server before deriving an address locally. */
const ADDRESS_TIMEOUT_MS = 1500;

/** The picked wallets that receive bitcoin on chain. */
export type VaultPayoutWallet = Extract<SwapWallet, 'hot' | 'cold'>;

export const isVaultPayoutWallet = (wallet: SwapWallet): wallet is VaultPayoutWallet =>
    wallet === 'hot' || wallet === 'cold';

export type VaultWalletIds = {
    readonly hot: string | undefined;
    readonly cold: string | undefined;
};

/**
 * A receive address on that vault.
 *
 * Throws with a message safe to show. The address is not validated here: the
 * quote step classifies it, and refuses a testnet or malformed one with the
 * same rule a pasted address gets.
 */
/** The wallet object for a picked vault, or undefined when this phone has none. */
export function findVaultWallet(
    wallet: VaultPayoutWallet,
    wallets: readonly any[],
    ids: VaultWalletIds,
): any | undefined {
    const id = wallet === 'cold' ? ids.cold : ids.hot;
    return id ? (wallets || []).find((w: any) => typeof w?.getID === 'function' && w.getID() === id) : undefined;
}

export async function addressForVaultPayout(
    wallet: VaultPayoutWallet,
    wallets: readonly any[],
    ids: VaultWalletIds,
): Promise<string> {
    const label = wallet === 'cold' ? 'Cold Vault' : 'Hot Vault';
    const id = wallet === 'cold' ? ids.cold : ids.hot;
    const target = id ? (wallets || []).find((w: any) => typeof w?.getID === 'function' && w.getID() === id) : undefined;
    if (!target) {
        throw new Error(`This phone no longer has a ${label}.`);
    }

    let address: string | undefined;
    try {
        address = await Promise.race<any>([
            target.getAddressAsync?.(),
            new Promise((resolve) => setTimeout(() => resolve(undefined), ADDRESS_TIMEOUT_MS)),
        ]);
    } catch {
        address = undefined;
    }
    if (!address && target._getExternalAddressByIndex) {
        try {
            address = target._getExternalAddressByIndex(target.getNextFreeAddressIndex());
        } catch {
            address = undefined;
        }
    }
    if (!address) {
        throw new Error(`Could not get an address from your ${label}. Try again.`);
    }
    return address;
}
