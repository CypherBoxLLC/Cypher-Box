import { useContext, useEffect, useRef } from 'react';

import {
    deriveArkExitAddress,
    deriveLegacyReservedSlotAddress,
} from '@Cypher/services/arkExitDestination';
import useAuthStore from '@Cypher/stores/authStore';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — blue_modules is plain JS, no types
import { BlueStorageContext } from '../../blue_modules/storage-context';

/**
 * Backfill `arkExitDestinationAddress` from the user's Hot Vault when it's
 * unset.
 *
 * One reactive hook covers three cases that would otherwise need separate
 * wiring:
 *
 *   1. **Ark wallet creation** — user just created an Ark wallet, navigated
 *      to home. `arkAuth` flips true, this hook fires, destination derived.
 *   2. **Ark wallet recovery** — same flow as create, just different entry
 *      point. The reactive trigger is the same (`arkAuth` becoming true).
 *   3. **Existing-user backfill** — user has had Ark + Hot Vault since
 *      before this code shipped, but `arkExitDestinationAddress` is null
 *      because no flow ever wrote it. On first home-screen mount after
 *      app upgrade, this hook fires and writes the derived address.
 *
 * Guards:
 *   - `arkAuth=false` → user has no Ark wallet, no destination needed
 *   - `walletID=null` → no Hot Vault, can't derive (auto-eject simply
 *     stays disabled until the user creates a Hot Vault)
 *   - `arkExitDestinationAddress` already set → respect the existing
 *     value, with ONE exception: if it's the legacy node-2 reserved slot
 *     (which the Hot Vault never scanned, leaving exit funds invisible),
 *     migrate it once to a scanned node-1 address. A manual custom override
 *     never matches the legacy derivation, so it's left untouched.
 *   - `wallets` not yet loaded → wait for the next render with a
 *     populated array.
 *
 * Edge case NOT handled: if the user resets their Hot Vault and creates a
 * new one (new walletID), the existing `arkExitDestinationAddress` will
 * point to the old Hot Vault's address — which is now an orphan derivation
 * with no spending key on this device. The user's only recovery path is
 * the manual override in Settings. We accept this trade-off because the
 * alternative (auto-overwriting on walletID change) would silently mutate
 * a value the user may have manually set, which is worse.
 *
 * Mount alongside `useArkSync` and `useArkRestoreOnBoot` in HomeScreen.
 */
export default function useArkExitDestinationBackfill(): void {
    const { wallets } = useContext(BlueStorageContext);
    const walletID = useAuthStore((s) => s.walletID);
    const arkAuth = useAuthStore((s) => s.isArkAuth);
    const arkExitDestinationAddress = useAuthStore(
        (s) => s.arkExitDestinationAddress,
    );
    const setArkExitDestinationAddress = useAuthStore(
        (s) => s.setArkExitDestinationAddress,
    );

    // Last logged input signature. `wallets` arrives from context with a fresh
    // array identity on nearly every provider render, so this effect re-runs
    // constantly even when nothing it cares about changed.
    const lastLoggedRef = useRef<string | null>(null);

    useEffect(() => {
        // Diagnostic: surface which guard short-circuits us so we can tell
        // "no Hot Vault" from "already set" from "wallets not loaded yet".
        // Cheap; remove once the feature has shipped a couple of releases.
        //
        // Logged only when the inputs actually change. Unconditionally, this
        // fired about once a second for an entire session (observed live during
        // a 36h unilateral exit) and buried the exit-drive lines sitting next
        // to it, which is the opposite of what a diagnostic is for. The effect
        // body below is already a no-op once the destination is set, so it is
        // only the log that needed rate-limiting, not the work.
        const signature = [
            arkAuth,
            walletID ?? '',
            arkExitDestinationAddress ?? '',
            Array.isArray(wallets) ? wallets.length : 'not-array',
        ].join('|');
        if (lastLoggedRef.current !== signature) {
            lastLoggedRef.current = signature;
            console.log(
                '[ArkExitBackfill] tick',
                'arkAuth=', arkAuth,
                'walletID=', walletID ? `${walletID.slice(0, 8)}…` : null,
                'destination=', arkExitDestinationAddress ? `${arkExitDestinationAddress.slice(0, 12)}…` : null,
                'walletsLen=', Array.isArray(wallets) ? wallets.length : 'not-array',
            );
        }
        if (!arkAuth) return;
        if (!walletID) return;
        if (!Array.isArray(wallets) || wallets.length === 0) return;

        const hotVault = wallets.find(
            (w: any) => typeof w?.getID === 'function' && w.getID() === walletID,
        );
        if (!hotVault) {
            // wallets array is loaded but the Hot Vault isn't in it — could
            // be a transient state during recovery, or the user wiped the
            // vault from another flow. Either way, retry on next render.
            console.log('[ArkExitBackfill] hot vault not found in wallets array');
            return;
        }

        if (arkExitDestinationAddress) {
            // One-time migration off the legacy node-2 reserved slot
            // (m/84'/0'/0'/2/0), which the Hot Vault never scanned, so exit
            // funds landed invisible + unspendable in-app. Only repoint when
            // the saved value IS that auto-derived legacy address; a manual
            // custom override won't match, so it's left untouched.
            const legacy = deriveLegacyReservedSlotAddress(hotVault);
            if (legacy && arkExitDestinationAddress === legacy) {
                const fresh = deriveArkExitAddress(hotVault);
                if (fresh && fresh !== legacy) {
                    console.log(
                        '[ArkExitBackfill] migrating exit destination off legacy node-2 slot ->',
                        fresh,
                    );
                    setArkExitDestinationAddress(fresh);
                }
            }
            return;
        }

        const address = deriveArkExitAddress(hotVault);
        if (!address) {
            // Helper already logged the specific failure mode.
            return;
        }

        console.log(
            '[ArkExitBackfill] auto-set arkExitDestinationAddress from Hot Vault change address:',
            address,
        );
        setArkExitDestinationAddress(address);
    }, [
        arkAuth,
        walletID,
        arkExitDestinationAddress,
        wallets,
        setArkExitDestinationAddress,
    ]);
}
