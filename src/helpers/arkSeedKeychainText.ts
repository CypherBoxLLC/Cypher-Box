import { Platform } from 'react-native';
import defaultLoc from '../../loc';

/**
 * Text for the Ark seed's copy in the phone's secure store
 * (src/services/ark/seedKeychain.ts), on the Ark create, recover and settings
 * screens.
 *
 * The two platforms keep that copy under different rules, so they can't share
 * one set of strings:
 *
 *   iOS      An iPhone Keychain item for this device only, read behind Face ID
 *            or the passcode (BIOMETRY_ANY_OR_DEVICE_PASSCODE).
 *   Android  react-native-keychain encrypts it with an Android Keystore key
 *            that only a strong biometric (a fingerprint on most phones)
 *            unlocks. Its read prompt allows BIOMETRIC_STRONG only, so there
 *            is no PIN or passcode fallback, and saveArkSeedToKeychain refuses
 *            any other cipher. Android deletes an app's Keystore keys and data
 *            when the app is uninstalled, and allowBackup is off, so the copy
 *            is gone after a reinstall. Touch ID is Apple's name, never
 *            Android's.
 *
 * A string whose words differ has an `_android` twin next to its iOS key. A
 * string that only names the store or the unlock method keeps one key with a
 * {keychain}, {store} or {biometric} placeholder; fill those from `keychain`,
 * `store` and `biometric` below. Call this while rendering, not at module load,
 * so a language switch shows up. The `loc` parameter is only there so tests can
 * pass one language's JSON; every key is still written out as a full `loc.`
 * path because scripts/find-unused-loc.js looks for that literal text.
 */
export function arkSeedKeychainText(os: string = Platform.OS, loc: any = defaultLoc) {
    const android = os === 'android';
    return {
        // Values for the {keychain}, {store} and {biometric} placeholders
        keychain: android ? 'Keystore' : 'Keychain',
        store: android ? 'Android Keystore' : 'iPhone Keychain',
        biometric: android ? loc.cypherbox.account.common.fingerprint : 'Face ID',
        // ArkSeedPhraseScreen and RecoverArkScreen: a different seed is already saved
        conflict: {
            title: android
                ? loc.cypherbox.account.common.replace_keychain_seed_title_android
                : loc.cypherbox.account.common.replace_keychain_seed_title,
            // {keychain} {biometric} {fingerprint}
            different: android
                ? loc.cypherbox.account.common.keychain_conflict_different_android
                : loc.cypherbox.account.common.keychain_conflict_different,
            // {keychain} {reason}
            unreadable: loc.cypherbox.account.common.keychain_conflict_unreadable,
            // {keychain}
            keepOld: loc.cypherbox.account.common.keep_old_seed_in,
            // {keychain}
            saveNew: loc.cypherbox.account.common.save_new_seed_in,
        },
        // CreateArkScreen: a wallet is already on this device
        create: {
            existsBody: android
                ? loc.cypherbox.account.create_ark.exists_body_1_android
                : loc.cypherbox.account.create_ark.exists_body_1,
            resetBody: android
                ? loc.cypherbox.account.create_ark.reset_body_android
                : loc.cypherbox.account.create_ark.reset_body,
        },
        // ArkSeedPhraseScreen: the switch under the new seed, its status line and toast
        seed: {
            // {store} {biometric}
            saveTo: loc.cypherbox.account.ark_seed.save_to,
            saved: android
                ? loc.cypherbox.account.ark_seed.saved_keychain_android
                : loc.cypherbox.account.ark_seed.saved_keychain,
            failed: android
                ? loc.cypherbox.account.ark_seed.keychain_failed_manual_android
                : loc.cypherbox.account.ark_seed.keychain_failed_manual,
            failedToast: android
                ? loc.cypherbox.account.ark_seed.keychain_save_failed_android
                : loc.cypherbox.account.ark_seed.keychain_save_failed,
        },
        // RecoverArkScreen: unlocking the saved seed instead of typing it
        recover: {
            // {biometric} {cloud}
            chooseBody: android
                ? loc.cypherbox.account.recover_ark.choose_body_android
                : loc.cypherbox.account.recover_ark.choose_body,
            // {biometric}
            unlockWith: loc.cypherbox.account.recover_ark.unlock_with,
            // {biometric}
            tapUnlockFirst: loc.cypherbox.account.recover_ark.tap_unlock_first,
            // {biometric}
            backToUnlock: loc.cypherbox.account.recover_ark.back_to_unlock,
            noSeed: android
                ? loc.cypherbox.account.recover_ark.keychain_no_seed_android
                : loc.cypherbox.account.recover_ark.keychain_no_seed,
            // {biometric}
            declined: android
                ? loc.cypherbox.account.recover_ark.biometric_declined_android
                : loc.cypherbox.account.recover_ark.biometric_declined,
            // {error}. Names the other backup sources, iCloud Drive or Google Drive.
            backupCorrupt: android
                ? loc.cypherbox.account.recover_ark.backup_corrupt_android
                : loc.cypherbox.account.recover_ark.backup_corrupt,
        },
        // Strike/CheckingAccountNew Settings: the delete-vault dialog's checkbox
        settings: {
            // {biometric}
            keepSeedOnDevice: android
                ? loc.cypherbox.strike.ark_settings.keep_seed_on_device_android
                : loc.cypherbox.strike.ark_settings.keep_seed_on_device,
        },
    };
}

export type ArkSeedKeychainText = ReturnType<typeof arkSeedKeychainText>;
