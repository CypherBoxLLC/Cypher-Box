import * as Keychain from 'react-native-keychain';

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
    // we try to unlink it. Without this, deleteArkDatadir can fail with
    // "resource busy" on iOS.
    clearArkWalletHandle();
    console.log('[Ark recover] cleared native handle');

    try {
        await deleteArkDatadir();
        console.log('[Ark recover] datadir deleted');
    } catch (err: any) {
        console.log('[Ark recover] datadir delete failed:', err?.message ?? err, err);
        return { ok: false, reason: 'datadir-delete-failed', cause: err };
    }

    try {
        // forceRescan=true → SDK queries the ASP for VTXOs owned by this
        // seed's pubkey and rehydrates the empty datadir with them.
        // This is what makes seed-only recovery actually return funds
        // instead of an empty wallet.
        await createArkWallet(mnemonic, true);
        console.log('[Ark recover] wallet recreated successfully (with ASP rescan)');
    } catch (err: any) {
        console.log('[Ark recover] createArkWallet failed:', err?.message ?? err, err);
        return { ok: false, reason: 'wallet-create-failed', cause: err };
    }

    return { ok: true };
}
