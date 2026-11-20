import * as Keychain from 'react-native-keychain';

import { readBackgroundArkSeed } from './backgroundKeychain';

/**
 * The biometry-gated primary Ark seed entry. MUST stay in sync with
 * seedKeychain.ts / restore.ts / walletHandle.ts / recover.ts.
 */
export const ARK_SEED_KEYCHAIN_SERVICE = 'ark-seed-phrase';

export interface ResolvedArkSeed {
    /** the mnemonic, or null when neither entry yields one */
    seed: string | null;
    /** true when the primary entry was gone/unreadable and the non-gated background copy was used */
    recoveredFromBackup: boolean;
    /** the error the primary read threw, if any, kept for the caller's reason/telemetry */
    primaryError?: Error;
}

/**
 * The seed to reopen the saved Ark wallet with.
 *
 * The primary entry (seedKeychain.ts) is biometry-gated and device-bound
 * (WHEN_PASSCODE_SET_THIS_DEVICE_ONLY). iOS deletes it the moment the device
 * passcode is removed, it never migrates to a new device, and a keystore/TEE
 * fault makes the read throw. When it is gone or unreadable we fall back to the
 * non-gated background-refresh copy (backgroundKeychain.ts,
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY), which holds the SAME seed, is written
 * only with the user's recorded on-device-seed consent, and is already readable
 * without a prompt by design (the background refresh worker reads it that way).
 *
 * Reading it here to reopen the user's OWN wallet exposes nothing the
 * background worker could not already read, and it is the difference between
 * silently reopening and routing the user to a destructive Reset while a
 * readable copy of their seed sits on the device. When the primary IS readable
 * it is always preferred, so the biometric gate still governs the normal path.
 *
 * Returns seed: null only when neither entry yields a mnemonic.
 */
export async function resolveArkSeedForRestore(): Promise<ResolvedArkSeed> {
    let primaryError: Error | undefined;
    try {
        const creds = await Keychain.getGenericPassword({ service: ARK_SEED_KEYCHAIN_SERVICE });
        if (creds && creds.password) {
            return { seed: creds.password, recoveredFromBackup: false };
        }
    } catch (err) {
        primaryError = err as Error;
    }

    let background: string | null = null;
    try {
        background = await readBackgroundArkSeed();
    } catch (_) {
        background = null;
    }
    if (background) {
        return { seed: background, recoveredFromBackup: true, primaryError };
    }

    return { seed: null, recoveredFromBackup: false, primaryError };
}
