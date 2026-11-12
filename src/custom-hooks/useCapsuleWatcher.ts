import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { BlueStorageContext } from '../../blue_modules/storage-context';
import useAuthStore from '@Cypher/stores/authStore';
import { hydrateCapsuleStore, isCapsuleStoreHydrated, onCapsuleStoreHydrated } from '@Cypher/stores/capsuleReceivedStore';
import { CapsuleTarget, checkVaultsForNewCapsules, setCapsuleCheckRequester } from '@Cypher/services/capsuleReceived';

/** How often both vaults are checked while the app is open. */
const POLL_MS = 60_000;

/**
 * Looks for newly confirmed capsules in the Hot Vault and the Cold Vault: when
 * the wallets are unlocked, when the app comes back to the foreground, once a
 * minute while it stays there, and when a push asks for it
 * (requestCapsuleCheck). Off in Offline Seed-Signer mode and when Electrum is
 * turned off in the network settings.
 */
export default function useCapsuleWatcher() {
    const { wallets, walletsInitialized, isElectrumDisabled } = useContext(BlueStorageContext);
    const walletID = useAuthStore(s => s.walletID);
    const coldStorageWalletID = useAuthStore(s => s.coldStorageWalletID);
    const signingMode = useAuthStore(s => s.signingMode);
    const [hydrated, setHydrated] = useState(isCapsuleStoreHydrated);

    useEffect(() => onCapsuleStoreHydrated(() => setHydrated(true)), []);

    // The saved queue loads once the wallets are unlocked and the app is in the
    // foreground: then the phone is unlocked and the store's key can be read.
    useEffect(() => {
        if (!walletsInitialized || signingMode || hydrated) return;
        if (AppState.currentState === 'active') {
            hydrateCapsuleStore();
            return;
        }
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') hydrateCapsuleStore();
        });
        return () => subscription.remove();
    }, [walletsInitialized, signingMode, hydrated]);

    // The wallets list changes on every save; reading it through a ref keeps
    // saves from starting checks.
    const latest = useRef({ wallets, walletID, coldStorageWalletID });
    latest.current = { wallets, walletID, coldStorageWalletID };

    const getTargets = useCallback((): CapsuleTarget[] => {
        const { wallets: all, walletID: hotId, coldStorageWalletID: coldId } = latest.current;
        const targets: CapsuleTarget[] = [];
        const hot = hotId ? all.find((w: any) => w.getID() === hotId) : undefined;
        if (hot) targets.push({ wallet: hot, vault: 'hot' });
        const cold = coldId && coldId !== hotId ? all.find((w: any) => w.getID() === coldId) : undefined;
        if (cold) targets.push({ wallet: cold, vault: 'cold' });
        return targets;
    }, []);

    const enabled = walletsInitialized && hydrated && !isElectrumDisabled && !signingMode && !!(walletID || coldStorageWalletID);

    useEffect(() => {
        if (!enabled) return;
        const check = () => {
            checkVaultsForNewCapsules(getTargets);
        };
        // now: on unlock, and when a vault is created, recovered or connected
        check();
        let timer: ReturnType<typeof setInterval> | null = AppState.currentState === 'background' ? null : setInterval(check, POLL_MS);
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') {
                check();
                if (!timer) timer = setInterval(check, POLL_MS);
            } else if (state === 'background' && timer) {
                clearInterval(timer);
                timer = null;
            }
        });
        setCapsuleCheckRequester(check);
        return () => {
            subscription.remove();
            if (timer) clearInterval(timer);
            setCapsuleCheckRequester(null);
        };
    }, [enabled, walletID, coldStorageWalletID, getTargets]);
}
