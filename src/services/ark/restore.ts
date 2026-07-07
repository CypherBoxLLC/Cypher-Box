import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

import { ESPLORA_URLS } from './config';
import { ARK_DATADIR } from './datadir';
import { getArkWalletHandle, openArkWallet } from './walletHandle';

const KEYCHAIN_SERVICE = 'ark-seed-phrase';

/**
 * The ASP gRPC connection in `Wallet.open` fails intermittently on mobile
 * (`BarkError.ServerConnection`) even when the network is healthy , it
 * succeeds on a retry seconds later (confirmed across this session). The boot
 * previously tried exactly once and then bricked the handle until a manual
 * relaunch. Since the keychain seed is already in hand when the open throws, we
 * re-attempt the OPEN (never the keychain read, so no repeat FaceID prompt) a
 * few times before giving up. Only transient connection errors are retried; a
 * genuine seed/datadir mismatch fails fast.
 */
const OPEN_ATTEMPTS = 5;
const OPEN_RETRY_DELAY_MS = 6000;

/**
 * Outcome of a restore attempt.
 *
 *   restored: true         — `openArkWallet` succeeded; caller should flip zustand.
 *   already-open           — in-memory handle already present (same process, second call).
 *   no-datadir             — nothing on disk; treat as "fresh device, offer creation".
 *   no-keychain            — datadir present but no mnemonic in Keychain (biometric
 *                            declined, cleared by user, or orphaned state from a partial
 *                            create). UI should surface Reset.
 *   open-failed            — both present but `Wallet.open` threw. Usually means the
 *                            datadir and the seed don't match (wrong wallet for this
 *                            device). UI should surface Reset.
 */
export type ArkRestoreResult =
    | { restored: true }
    | { restored: false; reason: 'already-open' | 'no-datadir' | 'no-keychain' | 'open-failed'; error?: Error };

export async function hasArkDatadir(): Promise<boolean> {
    try {
        return await RNFS.exists(ARK_DATADIR);
    } catch {
        return false;
    }
}

/**
 * Reopen the Ark wallet from on-disk state at boot time.
 *
 * Both the datadir AND the Keychain mnemonic must be present. Anything else
 * returns a reason code so the caller can reconcile zustand and route the UI
 * (restore into home, show "existing wallet" panel on CreateArkScreen, etc.).
 *
 * Safe to call multiple times — an existing in-memory handle short-circuits.
 * Does NOT mutate zustand; that is the caller's job (keeps this module pure
 * the same way the rest of `services/ark` is).
 */
export async function restoreArkWalletFromDisk(): Promise<ArkRestoreResult> {
    if (getArkWalletHandle()) {
        return { restored: false, reason: 'already-open' };
    }

    if (!(await hasArkDatadir())) {
        return { restored: false, reason: 'no-datadir' };
    }

    let creds: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
    try {
        creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    } catch (err) {
        return { restored: false, reason: 'no-keychain', error: err as Error };
    }
    if (!creds || !creds.password) {
        return { restored: false, reason: 'no-keychain' };
    }

    // Retry the open (seed already read above, so no repeat FaceID) to ride out
    // the intermittent ASP ServerConnection failures. Each attempt rotates to
    // the next esplora provider: the dominant failure mode is one provider's
    // CDN refusing bark's client (bot-block page instead of chain data), and
    // retrying the same blocked endpoint five times just burns the window.
    const seed = creds.password;
    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
        const esploraUrl = ESPLORA_URLS[(attempt - 1) % ESPLORA_URLS.length];
        try {
            await openArkWallet(seed, { esploraUrl });
            if (__DEV__ && (attempt > 1 || esploraUrl !== ESPLORA_URLS[0])) {
                console.log(
                    `[Ark restore] open succeeded on attempt ${attempt}/${OPEN_ATTEMPTS} via ${esploraUrl}`,
                );
            }
            return { restored: true };
        } catch (err) {
            lastErr = err as Error;
            const e = err as { tag?: string; message?: string; inner?: { errorMessage?: string; message?: string } };
            const detail = `${e?.tag ?? ''} ${e?.message ?? ''}`;
            const transient = /ServerConnection|Connection|timeout|timed out|network/i.test(detail);
            if (!transient || attempt === OPEN_ATTEMPTS) break;
            if (__DEV__) {
                // Stringify the inner UniFFI payload inline: the tag alone
                // (BarkError.ServerConnection) hides whether the failure was
                // DNS, TCP, TLS, or a gRPC status from the ASP, and object
                // args don't survive log forwarding as text.
                console.log(
                    `[Ark restore] open attempt ${attempt}/${OPEN_ATTEMPTS} via ${esploraUrl} failed (${detail.trim()}); ` +
                    `inner=${e?.inner?.errorMessage ?? e?.inner?.message ?? 'n/a'} ` +
                    `raw=${JSON.stringify(e, Object.getOwnPropertyNames(e ?? {}))}; ` +
                    `retrying in ${OPEN_RETRY_DELAY_MS}ms`,
                );
            }
            await new Promise((r) => setTimeout(r, OPEN_RETRY_DELAY_MS));
        }
    }
    return { restored: false, reason: 'open-failed', error: lastErr };
}
