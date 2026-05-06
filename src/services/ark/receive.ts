import useAuthStore from '@Cypher/stores/authStore';

import { writeArkAutoBackup } from './backup';
import { ensureArkOnchainHandle, getArkWalletHandle, getCachedArkMnemonic } from './walletHandle';

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
 *
 * After the SDK call we fire a backup write off the critical path. Why:
 * `bolt11Invoice()` writes the invoice's preimage into Bark's local SQLite
 * (the SDK's pending-receives table). It does NOT change `balance.totalSats`,
 * the spendable VTXO count, or the chain tip — none of the things the
 * sync-tick auto-backup uses to decide a write is needed, and none of the
 * fields that move when the counterparty actually pays. So between this call
 * and the next state-changing event, the on-disk `.cbark` (Documents + SAF
 * folder + Drive) does not yet contain the preimage. If the user uninstalls
 * or pm-clears in that window, recovery from any backup channel produces a
 * wallet with no record of the in-flight invoice — `tryClaimAllLightningReceives`
 * finds nothing, the ASP commits the round, and the resulting HTLC output
 * sits unclaimable until timeout-refund. Confirmed live on the A14 on
 * 2026-05-06: 100 sats from a CoinOS → Ark Lightning swap stuck this way.
 *
 * Triggering the backup the moment the preimage exists closes that window
 * to roughly the duration of one AES-encrypt + file write (≤1s). Fire-and-
 * forget: invoice creation must return immediately so the UI can render the
 * QR. Errors swallowed — the next sync tick will retry.
 */
export async function createArkLightningInvoice(amountSats: number): Promise<string> {
    const handle = getArkWalletHandle();
    if (!handle) throw new Error('Ark wallet not initialized');
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error('Invalid invoice amount');
    }
    const { invoice } = await handle.bolt11Invoice(BigInt(Math.floor(amountSats)));

    const mnemonic = getCachedArkMnemonic();
    if (mnemonic) {
        writeArkAutoBackup(mnemonic)
            .then(({ createdAt }) => {
                useAuthStore.getState().setArkLastBackupAt(createdAt);
                if (__DEV__) console.log('[Ark invoice] post-create backup written');
            })
            .catch((err: any) => {
                if (__DEV__) {
                    console.warn(
                        '[Ark invoice] post-create backup failed:',
                        err?.message ?? err,
                    );
                }
            });
    }

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
