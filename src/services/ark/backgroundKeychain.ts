import * as Keychain from 'react-native-keychain';

/**
 * Cleanup for the retired background-readable copy of the Ark seed.
 *
 * The old background VTXO-refresh feature mirrored the seed into this
 * separate keychain service (readable after first unlock, no biometric)
 * so headless wakes could open the wallet. The background wake machinery
 * is gone; no copy of the seed should exist outside the biometry-locked
 * primary `ark-seed-phrase` entry. This module survives only to delete
 * the legacy entry on installs that had the feature enabled — see the
 * boot-time call in notificationHandler.ts. Safe to remove entirely once
 * the installed base has rolled past a version that ran the cleanup.
 */
const BG_KEYCHAIN_SERVICE = 'ark-seed-phrase-bg';

export async function deleteBackgroundArkSeed(): Promise<void> {
    try {
        await Keychain.resetGenericPassword({ service: BG_KEYCHAIN_SERVICE });
    } catch {
        // Already absent or never written. Either way we're at the desired state.
    }
}
