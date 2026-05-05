import * as Keychain from 'react-native-keychain';

import { clearArkKeyCache } from './backup';
import { deleteArkDatadir } from './datadir';
import { clearArkWalletHandle } from './walletHandle';

/**
 * Keychain storage convention — MUST match ArkSeedPhraseScreen:
 *   service: 'ark-seed-phrase'
 *   account: 'ark'
 * If either side drifts, reset becomes a silent no-op on the Keychain.
 */
const KEYCHAIN_SERVICE = 'ark-seed-phrase';

export interface ResetArkWalletOptions {
    /**
     * When true, the on-device datadir is wiped but the seed mnemonic is
     * left in the Keychain. Lets a future Recover flow surface the
     * biometric (Face/Touch ID) fast path so the user doesn't have to
     * re-type 12 words on the same device.
     *
     * Defaults to false — i.e. the historic "nuke everything" behavior
     * for reset paths that explicitly want a clean slate (DEV-only reset
     * in CreateArkScreen, the auto-reset triggered after a successful
     * unilateral exit in `useArkSync`).
     */
    keepSeedInKeychain?: boolean;
}

/**
 * Nuke on-device Ark wallet state:
 *   1. In-memory wallet handle (singleton in walletHandle.ts)
 *   2. Native SQLite datadir (VTXOs, round state, exit txs)
 *   3. Keychain-stored mnemonic — UNLESS `keepSeedInKeychain` is true, in
 *      which case the seed survives so the user can re-recover into a
 *      fresh wallet via biometric without typing the 12 words again.
 *      (May prompt biometric on iOS during the Keychain delete because of
 *      `accessControl: BIOMETRY_ANY_OR_DEVICE_PASSCODE` — unavoidable.)
 *
 * Zustand fields (`isArkAuth`, `arkWallet`, `arkBalance`, `arkVtxos`, etc.)
 * are left to the caller via `clearArkAuth()` — keeps this service tree
 * store-free and makes the side effects obvious at the call site.
 *
 * DESTRUCTIVE: funds in unconfirmed VTXOs without an external backup are
 * unrecoverable after this regardless of the keychain option — VTXO state
 * lives in the datadir, not in the seed.
 */
export async function resetArkWalletState(
    options: ResetArkWalletOptions = {},
): Promise<void> {
    const { keepSeedInKeychain = false } = options;

    clearArkWalletHandle();
    // Scrub the in-memory PBKDF2 key so it doesn't carry over to a new wallet.
    clearArkKeyCache();

    try {
        await deleteArkDatadir();
    } catch (err) {
        console.warn('[Ark] deleteArkDatadir failed:', err);
        // Swallow — a missing datadir is the success state anyway.
    }

    if (!keepSeedInKeychain) {
        try {
            await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
        } catch (err) {
            console.warn('[Ark] Keychain reset failed:', err);
        }
    }
}
