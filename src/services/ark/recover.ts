import * as Keychain from 'react-native-keychain';

import { deriveBackupFingerprint } from './backupFingerprint';
import { deleteArkDatadir } from './datadir';
import { clearArkWalletHandle, createArkWallet } from './walletHandle';

/**
 * Keychain storage convention — MUST match ArkSeedPhraseScreen and reset.ts.
 * If either side drifts, recovery becomes a silent no-op on the Keychain.
 */
const KEYCHAIN_SERVICE = 'ark-seed-phrase';

/**
 * Read-only fetch of the stored Ark mnemonic. Triggers a biometric
 * prompt (FaceID / passcode) on iOS due to the access-control flags
 * `ArkSeedPhraseScreen` sets when writing.
 *
 * Returns null if the Keychain has no entry (e.g. a wallet that was
 * never offered backup, or a backup the user explicitly removed) or
 * if the user cancelled the biometric prompt — callers should treat
 * the two states identically: don't surface the seed.
 *
 * Distinct from `recoverArkWalletFromKeychain` above, which is the
 * destructive recovery flow. This helper is for the Settings "Show
 * seed phrase" UI: we just want to show the 12 words, not touch any
 * wallet state.
 */
/**
 * Result of `checkArkSeedKeychainConflict`. Discriminated so the caller
 * can render distinct copy per outcome rather than a single generic
 * "are you sure" prompt.
 *
 *   no-existing       — keychain slot is empty; safe to write.
 *   same-wallet       — existing seed has the same fingerprint as the
 *                       new mnemonic (overwrite is a no-op in practice
 *                       and doesn't lose anything).
 *   different-wallet  — a DIFFERENT wallet's seed is currently stored.
 *                       Caller MUST prompt the user before writing —
 *                       silent overwrite is the silent-loss vector for
 *                       keep-on-device users who skipped paper backup.
 *   unreadable        — slot occupied but we couldn't read it (biometric
 *                       declined, keychain hardware error, etc.).
 *                       Conservative: caller treats as different-wallet
 *                       and prompts.
 */
export type ArkSeedKeychainConflict =
    | { kind: 'no-existing' }
    | { kind: 'same-wallet' }
    | { kind: 'different-wallet'; existingFingerprint: string }
    | { kind: 'unreadable'; reason: string };

/**
 * Check whether writing `nextMnemonic` to the Ark keychain slot would
 * silently overwrite a different wallet's saved seed. Caller is
 * responsible for showing the confirmation UI on `different-wallet`
 * and `unreadable` outcomes; this helper does no UI itself.
 *
 * Why this matters: the keychain holds at most ONE seed at a time
 * (single `service: ark-seed-phrase`, single `account: ark`). When a
 * user creates a new wallet while a previous wallet's seed is still
 * stored (e.g. they used "keep on device" on delete and then created
 * a fresh wallet), the new seed silently replaces the old one. If the
 * user has a paper backup of the old seed, no harm — they can always
 * type-recover via the multi-wallet `.cbark` files we preserve. If
 * they relied SOLELY on the keychain as their seed copy, the old
 * wallet becomes unrecoverable despite its encrypted backup files
 * still existing at every destination.
 *
 * Performance:
 *   - Step 1 enumerates `getAllGenericPasswordServices` (cheap, no
 *     biometric prompt) to short-circuit on empty slot.
 *   - Step 2 reads the existing seed (TRIGGERS a biometric prompt on
 *     iOS / Touch ID on Android) only when the slot is occupied.
 *   - Step 3 derives fingerprints for both seeds via the native
 *     `Aes.pbkdf2`-backed `deriveBackupFingerprint` (~50 ms each).
 *
 * Never throws — IO failures collapse into an `unreadable` outcome
 * with a reason string. The caller's safest default is "treat as
 * different-wallet and prompt."
 */
export async function checkArkSeedKeychainConflict(
    nextMnemonic: string,
): Promise<ArkSeedKeychainConflict> {
    // Step 1: cheap probe — does the slot exist at all?
    let services: string[] = [];
    try {
        const list = await Keychain.getAllGenericPasswordServices();
        if (Array.isArray(list)) services = list;
    } catch (err: any) {
        // Conservative: if we can't enumerate, fall through to the
        // unreadable outcome rather than assuming the slot is empty.
        return {
            kind: 'unreadable',
            reason: err?.message ?? 'keychain enumeration failed',
        };
    }
    if (!services.includes(KEYCHAIN_SERVICE)) {
        return { kind: 'no-existing' };
    }

    // Step 2: slot occupied — read it. Triggers biometric prompt.
    let existingPassword: string | null = null;
    try {
        const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
        if (creds && creds.password) existingPassword = creds.password;
    } catch (err: any) {
        return {
            kind: 'unreadable',
            reason: err?.message ?? 'keychain read declined',
        };
    }
    if (!existingPassword) {
        // Slot listed but empty — race condition or stale metadata.
        // Treat as no-existing; the upcoming write will populate it.
        return { kind: 'no-existing' };
    }

    // Step 3: compare fingerprints. Native PBKDF2-SHA512 is fast.
    let existingFingerprint: string;
    let nextFingerprint: string;
    try {
        [existingFingerprint, nextFingerprint] = await Promise.all([
            deriveBackupFingerprint(existingPassword),
            deriveBackupFingerprint(nextMnemonic),
        ]);
    } catch (err: any) {
        return {
            kind: 'unreadable',
            reason: err?.message ?? 'fingerprint derivation failed',
        };
    }

    if (existingFingerprint === nextFingerprint) {
        return { kind: 'same-wallet' };
    }
    return { kind: 'different-wallet', existingFingerprint };
}

export async function readArkSeedPhrase(): Promise<string | null> {
    try {
        const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
        if (!creds || !creds.password) {
            console.log('[Ark seed] keychain has no entry for', KEYCHAIN_SERVICE);
            return null;
        }
        return creds.password;
    } catch (err) {
        // Most common cause: user cancelled the FaceID prompt. Don't
        // log loudly — it's expected UX.
        if (__DEV__) console.log('[Ark seed] keychain read declined / failed:', err);
        return null;
    }
}

export type ArkRecoveryResult = {
    /** True when the recovery completed and the wallet handle is live again. */
    ok: boolean;
    /** Why we bailed — only populated when `ok` is false. */
    reason?: 'no-seed-in-keychain' | 'datadir-delete-failed' | 'wallet-create-failed';
    /** Raw error for logging. */
    cause?: unknown;
};

/**
 * Seed-only recovery: keep the Keychain mnemonic, wipe the local datadir,
 * re-create the wallet from the saved seed.
 *
 * Use case: stuck rounds, corrupted SQLite, "app reinstalled and state
 * vanished" scenarios. On iOS the Keychain persists across reinstalls but
 * the Documents directory does NOT, so a fresh install effectively lands
 * users in this flow automatically.
 *
 * ⚠️ DESTRUCTIVE FOR PENDING VTXOs. Bark state (signed forfeit txs,
 * preimages, arkoor refs, round commitments) is NOT derivable from the
 * seed — it lives in the datadir we're about to delete. Any Locked /
 * pending-round VTXOs, mid-flight board transactions, and un-finalised
 * exits become unreachable from the client after this call. The ASP
 * still has records of them; whether Second.tech can help reconstruct
 * is a support question, not something the SDK can do.
 *
 * Caller responsibilities:
 *   - Show a confirm dialog that names the destructive consequence.
 *   - After this resolves with `ok: true`, clear stale zustand fields
 *     (arkVtxos, arkBalance, arkBalanceDetail, arkChainTipHeight) so
 *     the UI doesn't flash ghost state before the next sync tick.
 */
export async function recoverArkWalletFromKeychain(): Promise<ArkRecoveryResult> {
    console.log('[Ark recover] start');
    let creds;
    try {
        creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    } catch (err) {
        console.log('[Ark recover] keychain read threw', err);
        return { ok: false, reason: 'no-seed-in-keychain', cause: err };
    }
    if (!creds || !creds.password) {
        console.log('[Ark recover] keychain returned no creds for service', KEYCHAIN_SERVICE);
        return { ok: false, reason: 'no-seed-in-keychain' };
    }
    const mnemonic = creds.password;
    console.log('[Ark recover] seed loaded, length=', mnemonic.split(/\s+/).filter(Boolean).length, 'words');

    // Drop the native handle first so the SQLite file isn't held open when
    // we try to unlink it. Awaiting is essential — the movement watcher
    // tears down asynchronously and its holder pins SQLite FDs until
    // destroyed. Without await, deleteArkDatadir fails with "resource
    // busy" on iOS, or the next Wallet.open/create errors with
    // BarkError.Database.
    await clearArkWalletHandle();
    console.log('[Ark recover] cleared native handle');

    try {
        await deleteArkDatadir();
        console.log('[Ark recover] datadir deleted');
    } catch (err: any) {
        console.log('[Ark recover] datadir delete failed:', err?.message ?? err, err);
        return { ok: false, reason: 'datadir-delete-failed', cause: err };
    }

    try {
        // bark 0.15.0: forceRescan=true opens with the recovery mailbox scan
        // enabled (WalletOpenArgs.skipRecovery=false), which reconstructs the
        // VTXOs the ASP still tracks for this seed — the seed-only VTXO restore
        // that pre-0.15 bark could not do (it had no rescan API, so this path
        // used to land an empty wallet). The scan outcome is logged as
        // "[Ark recover] recoveryReport". The .cbark backup remains the
        // belt-and-suspenders path for anything the mailbox scan can't reach
        // (already-exited / foreign VTXOs).
        // ⚠ Phase 2 / device QA: verify recovered balance on a funded seed and
        // confirm an empty recoveryReport is not misread as "no funds".
        await createArkWallet(mnemonic, true);
        console.log('[Ark recover] wallet recreated with recovery mailbox scan (see recoveryReport)');
    } catch (err: any) {
        console.log('[Ark recover] createArkWallet failed:', err?.message ?? err, err);
        return { ok: false, reason: 'wallet-create-failed', cause: err };
    }

    return { ok: true };
}
