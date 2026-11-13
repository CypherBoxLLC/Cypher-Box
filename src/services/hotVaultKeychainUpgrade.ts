import { Alert, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import useAuthStore from '@Cypher/stores/authStore';
import { dropUnprotectedHotVaultBackups } from './hotVaultKeychain';
import loc from '../../loc';

/**
 * Once the wallets are loaded (the caller passes their IDs) and the auth store has loaded (it holds the "saved" flags),
 * removes the seed copies of those Hot Vaults that open without the fingerprint (see dropUnprotectedHotVaultBackups),
 * clears their flags so the backup tile offers a protected copy again, and says so once. Copies of vaults no longer in
 * the app are left alone. Android only; cheap when there's nothing to remove, so it runs on every launch.
 */
export function startHotVaultKeychainCheck(walletIDsInApp: readonly string[]): void {
    if (Platform.OS !== 'android' || !walletIDsInApp.length) return;
    const run = () => {
        void checkNow(walletIDsInApp).catch(e => console.warn('[HotVault] Keychain protection check failed:', e?.message ?? e));
    };
    if (useAuthStore.persist.hasHydrated()) {
        run();
        return;
    }
    const stop = useAuthStore.persist.onFinishHydration(() => {
        stop();
        run();
    });
}

async function checkNow(walletIDsInApp: readonly string[]): Promise<void> {
    const dropped = await dropUnprotectedHotVaultBackups(walletIDsInApp);
    if (!dropped.length) return;
    const { setHotVaultKeychainBackup, signingMode } = useAuthStore.getState();
    for (const walletID of dropped) setHotVaultKeychainBackup(walletID, false);
    // a signing phone has no Hot Vault to back up again; removing the copy is all it needs
    if (signingMode) return;
    // A phone that still has no fingerprint gets the message the backup tile shows for that case; one that has one
    // now can simply back up again.
    let biometry: string | null = null;
    try {
        biometry = await Keychain.getSupportedBiometryType();
    } catch {
        biometry = null;
    }
    Alert.alert(
        loc.cypherbox.home.hot_vault,
        biometry
            ? loc.cypherbox.vault.storage_vault.settings.keychain_unprotected_removed
            : loc.cypherbox.vault.storage_vault.settings.keychain_no_fingerprint,
    );
}
