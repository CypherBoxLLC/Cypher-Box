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
 * Does the Bark vault hold anything that can expire?
 *
 * The un-gated copy exists for exactly one job: let an unattended wake refresh
 * capsules before they expire. A vault with nothing in it has nothing to
 * expire, so the copy buys no safety there and is pure exposure — a plain
 * `getGenericPassword` away for anything that can reach the keychain, readable
 * while the phone is locked, and sitting there for as long as the app stays
 * installed. A user who tried Bark once, emptied it and moved on should not be
 * leaving a mnemonic behind in that state, and the seed still controls every
 * address the vault would receive on next, so "empty" is not "worthless".
 *
 * Fails CLOSED towards KEEPING the copy: returns true unless it can positively
 * confirm the vault is empty. An unhydrated store reads as all-defaults
 * (`arkVtxos: []`, `arkBalance: 0`), which is indistinguishable from a genuinely
 * empty vault and is what a background wake on a locked iPhone sees, so treat
 * it as unknown and keep the copy. Same reasoning as the hasHydrated guards
 * below.
 *
 * Every numeric field of the balance detail counts, rather than a named list:
 * a new pending bucket added later must not silently make a funded vault look
 * empty and drop the seed that protects it.
 */
export function arkVaultHasValueToProtect(): boolean {
    if (!useAuthStore.persist.hasHydrated()) return true;
    const state = useAuthStore.getState();
    if ((state.arkVtxos?.length ?? 0) > 0) return true;
    if ((state.arkBalance ?? 0) > 0) return true;
    const detail = state.arkBalanceDetail;
    if (detail) {
        for (const value of Object.values(detail)) {
            if (typeof value === 'number' && value > 0) return true;
        }
    }
    return false;
}

/**
 * Mirror the seed into the background-readable entry. Call ONLY with the
 * mnemonic already in hand (foreground — e.g. `getCachedArkMnemonic()` or just
 * after a wallet open). We never read the biometry-gated primary from here.
 */
export async function writeBackgroundArkSeed(mnemonic: string): Promise<void> {
    if (!mnemonic) return;
    if (!seedOnDeviceConsented()) {
        // Until the auth store has loaded, arkWallet is its default (null) and
        // reads as no consent, which proves nothing. That is what a background
        // wake on a locked iPhone sees, as the store's key is unreadable then.
        // Leave the copy alone: a later wake needs it to refresh capsules
        // before they expire.
        if (!useAuthStore.persist.hasHydrated()) return;
        // Arming the reminders toggle used to write this copy unconditionally,
        // so a user who turned OFF "save seed to Keystore" still got their full
        // 12 words written here with NO biometric gate, readable with a plain
        // getGenericPassword by anyone holding the unlocked phone. Refuse, and
        // clean up any copy an earlier build already wrote.
        console.warn('[Ark bg] seed mirror skipped: no on-device seed consent recorded');
        await deleteBackgroundArkSeed();
        return;
    }
    if (!arkVaultHasValueToProtect()) {
        // Nothing to refresh, so nothing to justify an un-gated mnemonic.
        // Re-armed by the next wallet-open once the vault holds value again.
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
        // Only on loaded values. A background wake on a locked iPhone opens
        // the wallet from the background copy while the auth store is still
        // at its defaults (its key is unreadable until the phone is unlocked),
        // where arkWallet is null and reads as no consent: the self-heal below
        // would delete the very copy that wake opened the wallet with. The
        // next wallet-open checks again.
        if (!useAuthStore.persist.hasHydrated()) return;
        if (!useAuthStore.getState().arkBgRefreshEnabled) return;
        if (!seedOnDeviceConsented()) {
            // Self-heal on every wallet open: remove a mirror written before
            // this gate existed. Checked BEFORE the early-return below, which
            // would otherwise treat an existing unwanted copy as "done".
            await deleteBackgroundArkSeed();
            return;
        }
        if (!arkVaultHasValueToProtect()) {
            // Checked BEFORE the already-exists early return below, so a vault
            // that has since been emptied drops its copy instead of keeping it
            // forever on the grounds that one is already there.
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

/**
 * Drop the un-gated copy from inside a background wake once the vault is empty.
 *
 * The foreground gate in `ensureBackgroundArkSeed` only fires when the user
 * opens the app. The case this covers is the one where they never do again:
 * everything offboarded or spent, app left installed, mnemonic sitting in a
 * keychain entry with no biometric gate indefinitely.
 *
 * `spendableCount` must come from a live `fetchArkVtxos()` in the caller, NOT
 * from the store: a background wake can run with the store at its defaults,
 * where an empty `arkVtxos` proves nothing and would delete the very copy that
 * wake just opened the wallet with. A direct fetch cannot be fooled that way,
 * which is why this takes the count as an argument instead of calling
 * `arkVaultHasValueToProtect()`.
 *
 * Safe at this point in the run because an active unilateral exit already
 * returned earlier, and a round submitted by the maintenance call has been
 * pulled in by the `syncArkWallet()` above, so an empty spendable set here
 * means there is genuinely no capsule left to expire.
 *
 * Residual risk, accepted: if value arrives while the app stays closed, the
 * next wake finds no seed and cannot refresh. A newly received capsule has its
 * full expiry window ahead of it, the local expiry reminders still fire, and
 * the next wallet-open re-arms the copy — so the exposure traded away is
 * permanent and the risk taken on is bounded.
 */
export async function pruneBackgroundArkSeedIfEmpty(spendableCount: number): Promise<void> {
    if (spendableCount > 0) return;
    try {
        if (!(await readBackgroundArkSeed())) return;
        console.log('[Ark bg] vault empty after refresh; dropping the background seed copy');
        await deleteBackgroundArkSeed();
    } catch {
        // Best-effort: the next wallet-open prunes it too.
    }
}
