import { ensureArkOnchainHandle, getArkWalletHandle } from './walletHandle';

/**
 * Create a BOLT11 invoice against the user's Ark wallet.
 *
 * The SDK returns `{ invoice, amountSats }` — we only surface the bech32
 * invoice string; the caller already knows the amount. Bigint → number is
 * safe here because we bounded it to a reasonable sat count on the way in.
 *
 * Throws if the wallet handle is unset (boot didn't restore / user never
 * created). Amount validation is deliberately minimal — server-side will
 * reject zero / overflow.
 */
export async function createArkLightningInvoice(amountSats: number): Promise<string> {
    const handle = getArkWalletHandle();
    if (!handle) throw new Error('Ark wallet not initialized');
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error('Invalid invoice amount');
    }
    const { invoice } = await handle.bolt11Invoice(BigInt(Math.floor(amountSats)));
    return invoice;
}

/**
 * Return a fresh Ark-side address for receiving VTXOs from another Ark user.
 */
export async function getArkAddress(): Promise<string> {
    const handle = getArkWalletHandle();
    if (!handle) throw new Error('Ark wallet not initialized');
    return await handle.newAddress();
}

/**
 * Return a fresh on-chain Bitcoin address for boarding funds into Ark.
 *
 * Spawns the BDK-backed `OnchainWallet` lazily on first call (shared seed +
 * datadir with the Ark wallet). The first call may prompt biometric for the
 * Keychain read; subsequent calls hit the in-memory cache.
 */
export async function getArkOnchainAddress(): Promise<string> {
    const onchain = await ensureArkOnchainHandle();
    return await onchain.newAddress();
}
