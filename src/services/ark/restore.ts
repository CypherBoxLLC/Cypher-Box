import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

import { ESPLORA_URLS } from './config';
import { ARK_DATADIR } from './datadir';
import { cacheArkMnemonicForReopen, getArkWalletHandle, getCachedArkMnemonic, openArkWallet } from './walletHandle';

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

// Guards against two opens running against the same datadir at once — the
// boot restore (useArkRestoreOnBoot) and the sync-loop self-heal
// (reopenArkWalletFromCache) can both fire. Racing opens corrupt SQLite/sled
// FDs (BarkError.Database), so whichever gets here first wins and the other
// no-ops until it clears.
let openInFlight = false;

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

    const seed = creds.password;
    // Cache the seed immediately so a later self-heal re-open
    // (reopenArkWalletFromCache) can retry WITHOUT another Keychain read —
    // the Ark seed entry is biometric-gated, so re-reading re-prompts FaceID.
    // Cached even if the open below fails and the handle stays null.
    cacheArkMnemonicForReopen(seed);

    if (openInFlight) {
        // Another open is already running against this datadir; don't race it.
        return { restored: false, reason: 'already-open' };
    }
    openInFlight = true;
    try {
        return await openWithRetry(seed);
    } finally {
        openInFlight = false;
    }
}

/**
 * Shared open-with-retry loop. Rotates esplora providers across attempts —
 * the dominant failure mode is one provider's CDN refusing bark's client (a
 * bot-block page instead of chain data), so retrying the same blocked
 * endpoint five times just burns the window. Only transient connection
 * errors are retried; a genuine seed/datadir mismatch fails fast. Callers
 * (restoreArkWalletFromDisk, reopenArkWalletFromCache) own the openInFlight
 * guard around this.
 */
async function openWithRetry(seed: string): Promise<ArkRestoreResult> {
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
            // Esplora provider returned junk instead of chain data — a CDN
            // bot-block / error page that bark parses as "bad response from
            // server (not a blockhash)" / "failed to parse hex". This is
            // provider-specific (blockstream refusing bark's client on some
            // networks), so rotating to the next ESPLORA_URLS entry
            // (mempool.space) is the correct recovery. Treat it as retryable
            // alongside the raw connection errors — otherwise the loop breaks
            // on attempt 1 and never tries the working fallback, and the wallet
            // never opens (handle-not-ready spam, empty balance, exit gated).
            const transient = /ServerConnection|Connection|timeout|timed out|network|bad response from server|not a blockhash|failed to parse hex|Esplora client/i.test(detail);
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

/**
 * Open the Ark wallet with the SAME esplora provider rotation the boot path
 * uses, but THROW the last error on final failure instead of returning a
 * result code. The `.cbark` restore flow (`restoreArkBackupBlob` in backup.ts)
 * needs the failure to propagate so the recovery screen can tell a "decrypted
 * fine, server unreachable" open failure apart from a genuinely corrupt backup.
 *
 * Reuses `openWithRetry` (transient-only retry + provider rotation) and the
 * shared `openInFlight` guard so it can't race a boot/self-heal open against
 * the same datadir.
 */
export async function openArkWalletWithRotation(seed: string): Promise<void> {
    openInFlight = true;
    try {
        const result = await openWithRetry(seed);
        if (!result.restored) {
            throw result.error ?? new Error('Ark wallet open failed after trying all esplora providers');
        }
    } finally {
        openInFlight = false;
    }
}

/**
 * Self-heal re-open for the sync loop.
 *
 * `useArkRestoreOnBoot` runs exactly once per mount; if its open fails the
 * handle stays null forever and nothing re-opens until a full relaunch (the
 * old "will retry on next sync tick" comment was a lie — nothing re-opened).
 * This lets `useArkSync` retry the open on its regular tick, reusing the
 * CACHED seed so there is no repeat biometric prompt. No-ops when the seed
 * hasn't been cached yet (boot hook hasn't done the first, biometric,
 * Keychain read) — that read belongs to the boot hook, not a background tick.
 */
export async function reopenArkWalletFromCache(): Promise<ArkRestoreResult> {
    if (getArkWalletHandle()) {
        return { restored: false, reason: 'already-open' };
    }
    const seed = getCachedArkMnemonic();
    if (!seed) {
        return { restored: false, reason: 'no-keychain' };
    }
    if (openInFlight) {
        return { restored: false, reason: 'already-open' };
    }
    openInFlight = true;
    try {
        return await openWithRetry(seed);
    } finally {
        openInFlight = false;
    }
}

/**
 * Wait for the Ark wallet handle to be open, kicking a cache-based re-open if
 * needed, and return it. Turns the boot-time "handle not ready" race into a
 * short wait instead of a hard failure.
 *
 * The bug it fixes: user-facing entry points (create a receive invoice for a
 * Strike→Bark swap, get an Ark address) called `getArkWalletHandle()` and
 * threw "Ark wallet not initialized" the instant they ran before the boot
 * open finished — so the user had to retry until the open caught up (a bad
 * "fail twice, then it works" UX). This awaits whichever open is in flight
 * (boot restore, or a self-heal re-open it nudges) for up to `timeoutMs`.
 * Reuses the cached seed, so no Keychain read / FaceID prompt. Throws a
 * friendly, user-showable message only if the handle never comes up in time.
 */
export async function ensureArkWalletHandleReady(
    timeoutMs = 15000,
): Promise<NonNullable<ReturnType<typeof getArkWalletHandle>>> {
    let handle = getArkWalletHandle();
    if (handle) return handle;
    // Nudge a self-heal re-open. No-op when a boot open is already in flight
    // (we just wait for it) or the seed isn't cached yet (the boot hook owns
    // the first, biometric, Keychain read — don't trigger FaceID from here).
    void reopenArkWalletFromCache().catch(() => {});
    const start = Date.now();
    const POLL_MS = 300;
    while (!handle && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        handle = getArkWalletHandle();
    }
    if (!handle) {
        throw new Error('Ark wallet is still starting up. Please try again in a moment.');
    }
    return handle;
}
