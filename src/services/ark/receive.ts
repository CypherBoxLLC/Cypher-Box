import { ensureArkOnchainHandle } from './walletHandle';
import { ensureArkWalletHandleReady } from './restore';

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
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error('Invalid invoice amount');
    }
    // Wait for the wallet handle instead of throwing the instant it's not
    // open yet. At boot the open can lag a user tapping "swap to Bark", and a
    // hard "not initialized" throw forced the retry-until-it-works loop Bam
    // hit. ensureArkWalletHandleReady awaits the in-flight open (reusing the
    // cached seed — no FaceID) and only throws a friendly message on timeout.
    const handle = await ensureArkWalletHandleReady();
    // bark 0.2.x: bolt11Invoice gained a second `description` arg (optional).
    // Pass undefined to preserve the prior no-description behavior.
    const { invoice } = await handle.bolt11Invoice(BigInt(Math.floor(amountSats)), undefined);
    return invoice;
}

/**
 * Return a fresh Ark-side address for receiving VTXOs from another Ark user.
 */
export async function getArkAddress(): Promise<string> {
    const handle = await ensureArkWalletHandleReady();
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
