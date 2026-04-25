import { useEffect, useRef, useState } from 'react';

import {
    FEATURE_ARK_ENABLED,
    hasArkDatadir,
    restoreArkWalletFromDisk,
} from '@Cypher/services/ark';
import useAuthStore from '@Cypher/stores/authStore';

export type ArkRestoreBootStatus =
    | 'idle'
    | 'running'
    | 'restored'
    | 'no-state'
    | 'needs-reset';

/**
 * Reconcile in-memory Ark state with what's actually on disk, once per mount.
 *
 * Handles the drift scenarios that bit us during dev:
 *   - zustand says authed but Metro reload wiped the handle → reopen silently.
 *   - zustand cleared but datadir/Keychain still on disk → reopen + flip auth,
 *     so the home carousel renders the Ark card again.
 *   - datadir orphaned (Keychain missing or mnemonic/datadir mismatch) → leave
 *     zustand false and report `needs-reset`, so CreateArkScreen / settings
 *     can surface a Reset escape hatch instead of failing on create retry.
 *   - nothing on disk → ensure zustand isArkAuth/allBTCWallets[ARK] are cleared.
 *
 * Deliberately does NOT trigger the Keychain biometric prompt just to check
 * presence: `restoreArkWalletFromDisk` gates on datadir first, and if the user
 * declines biometric we fall into `no-keychain` / `needs-reset`.
 */
export default function useArkRestoreOnBoot(): ArkRestoreBootStatus {
    const once = useRef(false);
    const [status, setStatus] = useState<ArkRestoreBootStatus>('idle');

    const isArkAuth = useAuthStore(s => s.isArkAuth);
    const allBTCWallets = useAuthStore(s => s.allBTCWallets);
    const setArkAuth = useAuthStore(s => s.setArkAuth);
    const setAllBTCWallets = useAuthStore(s => s.setAllBTCWallets);
    const clearArkAuth = useAuthStore(s => s.clearArkAuth);

    useEffect(() => {
        if (once.current) return;
        once.current = true;

        // Feature-flag short-circuit: don't touch Keychain (avoids a biometric
        // prompt), don't open the wallet, don't read the datadir. We DO still
        // clear any stale zustand auth so the carousel doesn't render a ghost
        // Ark card if the flag is flipped off after previous use.
        if (!FEATURE_ARK_ENABLED) {
            const latest = useAuthStore.getState();
            if (latest.isArkAuth || latest.allBTCWallets.includes('ARK')) {
                if (__DEV__) console.log('[Ark] Feature disabled — clearing stale auth');
                latest.clearArkAuth();
            }
            setStatus('no-state');
            return;
        }

        (async () => {
            setStatus('running');
            const result = await restoreArkWalletFromDisk();

            if (result.restored) {
                if (__DEV__) console.log('[Ark] Boot: restored wallet from disk');
                const latest = useAuthStore.getState();
                if (!latest.isArkAuth) latest.setArkAuth(true);
                if (!latest.allBTCWallets.includes('ARK')) {
                    latest.setAllBTCWallets([...latest.allBTCWallets, 'ARK']);
                }
                setStatus('restored');
                return;
            }

            if (result.reason === 'already-open') {
                setStatus('restored');
                return;
            }

            if (result.reason === 'no-datadir') {
                const latest = useAuthStore.getState();
                if (latest.isArkAuth || latest.allBTCWallets.includes('ARK')) {
                    if (__DEV__) console.log('[Ark] Boot: no datadir — clearing stale auth');
                    latest.clearArkAuth();
                }
                setStatus('no-state');
                return;
            }

            // Datadir present but Keychain missing or open failed.
            // Leave zustand pointing at "not authed" so the UI doesn't lie,
            // and surface the drift so CreateArkScreen can show Reset.
            if (__DEV__) {
                // The stringified Error at the top level is opaque (e.g.
                // "[Error: BarkError.Internal]") — the SDK's UniFFI wrapper
                // attaches the real message + cause on the properties, so
                // spread those too. Helps distinguish "datadir/seed mismatch"
                // from "SQLite corrupted" from "ASP unreachable".
                const err = result.error as Error | undefined;
                console.log(
                    '[Ark] Boot: restore failed —',
                    result.reason,
                    err && {
                        name: err.name,
                        message: err.message,
                        stack: err.stack,
                        // any UniFFI fields hanging off the object
                        extras: JSON.stringify(err, Object.getOwnPropertyNames(err)),
                    },
                );
            }
            const latest = useAuthStore.getState();
            if (latest.isArkAuth) {
                latest.setArkAuth(false);
            }
            setStatus('needs-reset');
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return status;
}

export { hasArkDatadir };
