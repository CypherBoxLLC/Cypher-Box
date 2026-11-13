import { Platform } from 'react-native';
import defaultLoc from '../../loc';

/**
 * Text for the Hot Vault's optional second copy of its seed in the phone's
 * secure store (src/services/hotVaultKeychain.ts).
 *
 * The two platforms keep that copy under different rules, so they can't share
 * one set of strings:
 *
 *   iOS      An iPhone Keychain item for this device only, read behind Face ID
 *            or the passcode. It stays when the app is deleted, so it can bring
 *            the vault back after a reinstall.
 *   Android  react-native-keychain stores it encrypted with an Android Keystore
 *            key that only a strong biometric (a fingerprint on most phones)
 *            unlocks, and backupHotVaultSeed refuses any other key. Android
 *            deletes an app's Keystore keys and data when the app is
 *            uninstalled, and allowBackup is off, so the copy is gone after a
 *            reinstall. Nothing here may promise otherwise.
 *
 * Each Android string sits next to its iOS key, under the same name plus
 * `_android`. Call this while rendering, not at module load, so a language
 * switch shows up. The `loc` parameter is only there so tests can pass one
 * language's JSON; every key is still written out as a full `loc.` path
 * because scripts/find-unused-loc.js looks for that literal text.
 */
export function hotVaultKeychainText(os: string = Platform.OS, loc: any = defaultLoc) {
    const android = os === 'android';
    return {
        // SavingVault: the switch under the new seed, its status line and toasts
        create: {
            label: android
                ? loc.cypherbox.vault.saving_vault.keychain_label_android
                : loc.cypherbox.vault.saving_vault.keychain_label,
            sub: android
                ? loc.cypherbox.vault.saving_vault.keychain_sub_android
                : loc.cypherbox.vault.saving_vault.keychain_sub,
            saved: android
                ? loc.cypherbox.vault.saving_vault.keychain_saved_android
                : loc.cypherbox.vault.saving_vault.keychain_saved,
            failed: android
                ? loc.cypherbox.vault.saving_vault.keychain_failed_android
                : loc.cypherbox.vault.saving_vault.keychain_failed,
            skippedToast: android
                ? loc.cypherbox.vault.saving_vault.keychain_skipped_android
                : loc.cypherbox.vault.saving_vault.keychain_skipped,
            failedToast: android
                ? loc.cypherbox.vault.saving_vault.keychain_failed_toast_android
                : loc.cypherbox.vault.saving_vault.keychain_failed_toast,
        },
        // HotStorageVault Settings: the backup tile, its toasts, the remove dialog, and a signing phone's remove row
        settings: {
            backUp: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_back_up_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_back_up,
            savedRemove: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_saved_remove_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_saved_remove,
            updating: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_updating_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_updating,
            savedToast: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_saved_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_saved,
            saveFailedToast: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_save_failed_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_save_failed,
            removeTitle: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_remove_title_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_remove_title,
            removeBody: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_remove_body_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_remove_body,
            // a signing phone makes no copy, but can remove one made before
            signerRemove: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_signer_remove_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_signer_remove,
            signerRemoving: android
                ? loc.cypherbox.vault.storage_vault.settings.keychain_signer_removing_android
                : loc.cypherbox.vault.storage_vault.settings.keychain_signer_removing,
        },
        // RecoverSavingVault: the section above the 12 word boxes and its dialogs
        recover: {
            title: android
                ? loc.cypherbox.vault.recover_saving_vault.keychain_title_android
                : loc.cypherbox.vault.recover_saving_vault.keychain_title,
            noBackup: android
                ? loc.cypherbox.vault.recover_saving_vault.no_keychain_backup_android
                : loc.cypherbox.vault.recover_saving_vault.no_keychain_backup,
            tapToUnlock: android
                ? loc.cypherbox.vault.recover_saving_vault.tap_to_unlock_android
                : loc.cypherbox.vault.recover_saving_vault.tap_to_unlock,
            recoverButton: android
                ? loc.cypherbox.vault.recover_saving_vault.recover_from_keychain_android
                : loc.cypherbox.vault.recover_saving_vault.recover_from_keychain,
            notFoundMessage: android
                ? loc.cypherbox.vault.recover_saving_vault.backup_not_found_message_android
                : loc.cypherbox.vault.recover_saving_vault.backup_not_found_message,
            removeTitle: android
                ? loc.cypherbox.vault.recover_saving_vault.remove_backup_title_android
                : loc.cypherbox.vault.recover_saving_vault.remove_backup_title,
            removeMessage: android
                ? loc.cypherbox.vault.recover_saving_vault.remove_backup_message_android
                : loc.cypherbox.vault.recover_saving_vault.remove_backup_message,
            removeFailedMessage: android
                ? loc.cypherbox.vault.recover_saving_vault.remove_failed_message_android
                : loc.cypherbox.vault.recover_saving_vault.remove_failed_message,
            removeA11y: android
                ? loc.cypherbox.vault.recover_saving_vault.remove_backup_a11y_android
                : loc.cypherbox.vault.recover_saving_vault.remove_backup_a11y,
        },
    };
}

export type HotVaultKeychainText = ReturnType<typeof hotVaultKeychainText>;
