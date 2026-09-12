import * as Keychain from 'react-native-keychain';

import useAuthStore from '@Cypher/stores/authStore';

/**
 * Background-readable copy of the Ark seed, for the opt-in background
 * maintenance path (unattended delegated refresh before expiry).
 *
 * The primary `ark-seed-phrase` entry is biometry-gated (a FaceID / passcode
 * prompt on every read), so a background wake cannot open the wallet from it.
 * When the user opts into background refresh (the reminders toggle) we mirror
 * the seed into this separate service at `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`:
 * readable by a headless task once the device has been unlocked since boot,
 * never while the device is cold-locked, and never synced off-device.
 * Biometric protection still applies at the app-UI level; this copy exists
 * ONLY to let the maintenance task open the wallet without a prompt.
 *
 * Lifecycle: written on opt-in and on wallet-open (while opted in), deleted on
 * opt-out / reset and, as a safety net, at boot whenever the feature is off, so
 * no seed copy lingers outside the biometry-locked primary once it's disabled.
 */
const BG_KEYCHAIN_SERVICE = 'ark-seed-phrase-bg';
const BG_KEYCHAIN_ACCOUNT = 'ark';

/**
 * Did the user consent to keeping the seed on this device?
 *
 * `arkWallet.keychainSaved` records the outcome of the "save seed to Keystore"
 * choice at create (ArkSeedPhraseScreen's toggle) and at recover. When it is
 * not true, the user either declined or the save did not succeed, and in both
 * cases there should be NO seed material sitting on the device.
 *
 * Anything other than an explicit `true` FAILS CLOSED, including wallets
 * created before the field existed. Losing the unattended maintenance backstop
 * is the lesser harm: the documented primary expectation is that the user
 * opens the app before expiry, whereas the alternative is an un-gated copy of
 * a mnemonic the user never agreed to store.
 */
function seedOnDeviceConsented(): boolean {
    return useAuthStore.getState().arkWallet?.keychainSaved === true;
}

/**
 * Mirror the seed into the background-readable entry. Call ONLY with the
 * mnemonic already in hand (foreground — e.g. `getCachedArkMnemonic()` or just
 * after a wallet open). We never read the biometry-gated primary from here.
 */
export async function writeBackgroundArkSeed(mnemonic: string): Promise<void> {
    if (!mnemonic) return;
    if (!seedOnDeviceConsented()) {
        // Arming the reminders toggle used to write this copy unconditionally,
        // so a user who turned OFF "save seed to Keystore" still got their full
        // 12 words written here with NO biometric gate, readable with a plain
        // getGenericPassword by anyone holding the unlocked phone. Refuse, and
        // clean up any copy an earlier build already wrote.
        console.warn('[Ark bg] seed mirror skipped: no on-device seed consent recorded');
        await deleteBackgroundArkSeed();
        return;
    }
    await Keychain.setGenericPassword(BG_KEYCHAIN_ACCOUNT, mnemonic, {
        service: BG_KEYCHAIN_SERVICE,
        // No accessControl: a background wake cannot answer a biometric prompt.
        // AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = readable in the background after
        // the first post-boot unlock, not while cold-locked, not backed up.
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
}

/**
 * Read the background-readable seed. Returns null if the feature was never
 * enabled (entry absent) or the read fails. No biometric prompt.
 */
export async function readBackgroundArkSeed(): Promise<string | null> {
    try {
        const creds = await Keychain.getGenericPassword({ service: BG_KEYCHAIN_SERVICE });
        return creds && creds.password ? creds.password : null;
    } catch {
        return null;
    }
}

/**
 * Backstop after wallet-open: while background refresh is enabled (the default),
 * ensure the background-readable copy exists, writing it if missing. Mnemonic in
 * hand so no biometric prompt. No-op when the feature is off or a copy already
 * exists. Best-effort — a failure just retries on the next open.
 */
export async function ensureBackgroundArkSeed(mnemonic: string): Promise<void> {
    if (!mnemonic) return;
    try {
        if (!useAuthStore.getState().arkBgRefreshEnabled) return;
        if (!seedOnDeviceConsented()) {
            // Self-heal on every wallet open: remove a mirror written before
            // this gate existed. Checked BEFORE the early-return below, which
            // would otherwise treat an existing unwanted copy as "done".
            await deleteBackgroundArkSeed();
            return;
        }
        if (await readBackgroundArkSeed()) return;
        await writeBackgroundArkSeed(mnemonic);
    } catch {
        // best-effort; the next wallet-open retries.
    }
}

/**
 * Delete the background-readable seed. Called on opt-out, reset, and (as a
 * safety cleanup) at boot whenever the feature is disabled.
 */
export async function deleteBackgroundArkSeed(): Promise<void> {
    try {
        await Keychain.resetGenericPassword({ service: BG_KEYCHAIN_SERVICE });
    } catch {
        // Already absent or never written. Either way we're at the desired state.
    }
}
