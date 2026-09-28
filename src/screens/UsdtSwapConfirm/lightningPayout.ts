/**
 * Getting a Lightning invoice from one of the app's own wallets, so a USDT
 * swap can pay the bitcoin into it.
 *
 * CoinOS and the Bark Vault both already implement the app's Lightning rail
 * contract (services/lightningSwap), which is how the buy flow moves bitcoin
 * between them. A USDT swap needs the same one thing from them: an invoice for
 * the bitcoin it is about to deliver. So this reaches for that contract rather
 * than a second way of asking each wallet.
 *
 * Kept beside the screen rather than in services/tron, so the Tron code does
 * not take a dependency on the Lightning rails to send a stablecoin.
 */

import { getLightningSwapProvider } from "@Cypher/services/lightningSwap";

import type { SwapWallet } from "./WalletPicker";

/** The picked wallets that receive bitcoin over Lightning. */
export type LightningPayoutWallet = Extract<SwapWallet, 'coinos' | 'ark'>;

export const isLightningPayoutWallet = (wallet: SwapWallet): wallet is LightningPayoutWallet =>
    wallet === 'coinos' || wallet === 'ark';

/**
 * A BOLT11 invoice on that wallet for `sats`.
 *
 * The amount has to be named, because neither rail offers an open invoice, so
 * the swap is priced backwards from it: the quote works out the USDT it takes
 * and the review screen shows that before anything is paid.
 *
 * Throws with a message safe to show. An invoice the rail gives a short expiry
 * is not rejected here: the quote step classifies it and refuses one with less
 * than ten minutes left, which is the same rule a pasted invoice gets.
 */
export async function invoiceForSwapPayout(wallet: LightningPayoutWallet, sats: number): Promise<string> {
    if (!Number.isInteger(sats) || sats <= 0) {
        throw new Error('That amount is too small to receive over Lightning.');
    }
    const provider = getLightningSwapProvider(wallet);
    if (!provider.isAvailable()) {
        throw new Error(`${provider.displayName} is not connected right now.`);
    }
    const bolt11 = await provider.createInvoice(sats, 'Swap USDT to bitcoin');
    if (!bolt11 || typeof bolt11 !== 'string') {
        throw new Error(`${provider.displayName} did not give an invoice to pay into. Try again.`);
    }
    return bolt11;
}
