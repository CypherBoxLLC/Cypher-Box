import * as Keychain from 'react-native-keychain';

import { deleteArkDatadir } from './datadir';
import { clearArkWalletHandle } from './walletHandle';

/**
 * Keychain storage convention — MUST match ArkSeedPhraseScreen:
 *   service: 'ark-seed-phrase'
 *   account: 'ark'
 * If either side drifts, reset becomes a silent no-op on the Keychain.
 */
const KEYCHAIN_SERVICE = 'ark-seed-phrase';

/**
 * Nuke all on-device Ark wallet state:
 *   1. In-memory wallet handle (singleton in walletHandle.ts)
 *   2. Native SQLite datadir (VTXOs, round state, exit txs)
 *   3. Keychain-stored mnemonic (may prompt biometric on iOS — unavoidable
 *      with `accessControl: BIOMETRY_ANY_OR_DEVICE_PASSCODE`)
 *
 * Zustand fields (`isArkAuth`, `arkWallet`, `arkBalance`, `arkVtxos`, etc.)
 * are left to the caller via `clearArkAuth()` — keeps this service tree
 * store-free and makes the side effects obvious at the call site.
 *
 * DESTRUCTIVE: funds in unconfirmed VTXOs without an external backup are
 * unrecoverable after this. Gate UI behind a confirm dialog + __DEV__ for
 * now; the real "delete wallet" flow for prod needs backup verification.
 */
export async function resetArkWalletState(): Promise<void> {
    clearArkWalletHandle();

    try {
        await deleteArkDatadir();
    } catch (err) {
        console.warn('[Ark] deleteArkDatadir failed:', err);
        // Swallow — a missing datadir is the success state anyway.
    }

    try {
        await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
    } catch (err) {
        console.warn('[Ark] Keychain reset failed:', err);
    }
}
