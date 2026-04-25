import RNFS from 'react-native-fs';
import * as Keychain from 'react-native-keychain';

import { ARK_DATADIR } from './datadir';
import { getArkWalletHandle, openArkWallet } from './walletHandle';

const KEYCHAIN_SERVICE = 'ark-seed-phrase';

/**
 * Outcome of a restore attempt.
 *
 *   restored: true         — `openArkWallet` succeeded; caller should flip zustand.
 *   already-open           — in-memory handle already present (same process, second call).
 *   no-datadir             — nothing on disk; treat as "fresh device, offer creation".
 *   no-keychain            — datadir present but no mnemonic in Keychain (biometric
 *                            declined, cleared by user, or orphaned state from a partial
 *                            create). UI should surface Reset.
 *   open-failed            — both present but `Wallet.open` threw. Usually means the
 *                            datadir and the seed don't match (wrong wallet for this
 *                            device). UI should surface Reset.
 */
export type ArkRestoreResult =
    | { restored: true }
    | { restored: false; reason: 'already-open' | 'no-datadir' | 'no-keychain' | 'open-failed'; error?: Error };

export async function hasArkDatadir(): Promise<boolean> {
    try {
        return await RNFS.exists(ARK_DATADIR);
    } catch {
        return false;
    }
}

/**
 * Reopen the Ark wallet from on-disk state at boot time.
 *
 * Both the datadir AND the Keychain mnemonic must be present. Anything else
 * returns a reason code so the caller can reconcile zustand and route the UI
 * (restore into home, show "existing wallet" panel on CreateArkScreen, etc.).
 *
 * Safe to call multiple times — an existing in-memory handle short-circuits.
 * Does NOT mutate zustand; that is the caller's job (keeps this module pure
 * the same way the rest of `services/ark` is).
 */
export async function restoreArkWalletFromDisk(): Promise<ArkRestoreResult> {
    if (getArkWalletHandle()) {
        return { restored: false, reason: 'already-open' };
    }

    if (!(await hasArkDatadir())) {
        return { restored: false, reason: 'no-datadir' };
    }

    let creds: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
    try {
        creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    } catch (err) {
        return { restored: false, reason: 'no-keychain', error: err as Error };
    }
    if (!creds || !creds.password) {
        return { restored: false, reason: 'no-keychain' };
    }

    try {
        await openArkWallet(creds.password);
        return { restored: true };
    } catch (err) {
        return { restored: false, reason: 'open-failed', error: err as Error };
    }
}
