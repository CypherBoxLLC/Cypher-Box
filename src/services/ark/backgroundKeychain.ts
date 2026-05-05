import * as Keychain from 'react-native-keychain';

/**
 * Background-readable copy of the Ark seed.
 *
 * Lives at a different keychain service from the primary `ark-seed-phrase`
 * entry, which stays biometry-locked exactly as before this feature shipped.
 * This entry is only written when the user opts into background VTXO refresh
 * and is deleted the moment they opt out — so users who never enable the
 * toggle have an identical keychain posture to a build without this feature.
 *
 * iOS access class: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY. Readable without
 * user presence as long as the device has been unlocked once since boot,
 * which is the lightest gating that still survives common attack scenarios
 * (lost-and-locked phone). Not synced via iCloud Keychain.
 *
 * Android: react-native-keychain backs onto EncryptedSharedPreferences,
 * which has equivalent semantics (available after first unlock, no
 * biometric prompt) when no `accessControl` option is passed.
 */
const BG_KEYCHAIN_SERVICE = 'ark-seed-phrase-bg';
const BG_KEYCHAIN_ACCOUNT = 'ark';

export async function writeBackgroundArkSeed(mnemonic: string): Promise<void> {
    await Keychain.setGenericPassword(BG_KEYCHAIN_ACCOUNT, mnemonic, {
        service: BG_KEYCHAIN_SERVICE,
        accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
}

export async function readBackgroundArkSeed(): Promise<string | null> {
    const creds = await Keychain.getGenericPassword({ service: BG_KEYCHAIN_SERVICE });
    if (!creds || !creds.password) return null;
    return creds.password;
}

export async function deleteBackgroundArkSeed(): Promise<void> {
    try {
        await Keychain.resetGenericPassword({ service: BG_KEYCHAIN_SERVICE });
    } catch {
        // Already absent or never written. Either way we're at the desired state.
    }
}

export async function hasBackgroundArkSeed(): Promise<boolean> {
    const creds = await Keychain.getGenericPassword({ service: BG_KEYCHAIN_SERVICE });
    return Boolean(creds && creds.password);
}
