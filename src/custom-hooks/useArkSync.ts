import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import {
    fetchArkBalance,
    fetchArkVtxos,
    fetchChainTipHeight,
    syncArkWallet,
    tryClaimArkLightningReceives,
} from '@Cypher/services/ark';
import useAuthStore from '@Cypher/stores/authStore';

/**
 * Keep Ark wallet state in zustand fresh.
 *
 * Lifecycle:
 *   - On mount (if authed): immediate fetch.
 *   - Every INTERVAL_MS while mounted + authed: background fetch.
 *   - On AppState 'active' (user returns from background): fetch.
 *   - Ignores fetches if handle is null (wallet not initialized yet).
 *
 * We intentionally DO NOT block the UI on the fetch — the card renders
 * from whatever zustand currently holds (cached value from a prior session,
 * or the default 0 for a fresh install). `isSyncing` lets the caller show a
 * subtle spinner if desired, nothing more.
 *
 * Error policy: swallow errors into `lastError` and keep going. A one-off
 * esplora flake or ASP hiccup shouldn't spam the user — they'll see stale
 * data for up to one interval, which is fine for a balance view.
 */
const INTERVAL_MS = 30_000;

export type UseArkSync = {
    isSyncing: boolean;
    lastError: Error | null;
    /** Manual refresh — use for pull-to-refresh gestures or after a send. */
    refresh: () => Promise<void>;
};

export default function useArkSync(): UseArkSync {
    const isArkAuth = useAuthStore((s) => s.isArkAuth);
    const setArkBalance = useAuthStore((s) => s.setArkBalance);
    const setArkBalanceDetail = useAuthStore((s) => s.setArkBalanceDetail);
    const setArkVtxos = useAuthStore((s) => s.setArkVtxos);
    const setArkChainTipHeight = useAuthStore((s) => s.setArkChainTipHeight);
    const setArkLastSyncedAt = useAuthStore((s) => s.setArkLastSyncedAt);

    const [isSyncing, setIsSyncing] = useState(false);
    const [lastError, setLastError] = useState<Error | null>(null);

    // Guard against overlapping fetches: if a previous sync is still
    // in-flight when the interval fires, skip the new one. This also means
    // a slow esplora round-trip doesn't stack up calls behind it.
    const inFlight = useRef(false);

    const sync = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setIsSyncing(true);
        console.log('[Ark sync] cycle start');
        try {
            // Drive forward any pending Lightning receives BEFORE reading
            // VTXOs. Without this, a successful Lightning receive sits in
            // `claimableLightningReceiveSats` on the balance but never
            // materializes into a VTXO for the capsules tab — the SDK
            // doesn't run the claim automatically from a background daemon
            // on mobile. Fire-and-forget (wait=false): the claim finalizes
            // asynchronously; this cycle's vtxo fetch may not yet see the
            // new VTXO, but the next 30s tick will. Errors are swallowed
            // inside the wrapper so a claim flake doesn't break sync.
            await tryClaimArkLightningReceives();

            // Pull round finalizations + server-side updates into the local
            // datadir. MUST run before the SQLite reads below or they'll
            // return stale state (old VTXOs lingering as Spendable after a
            // refresh, new incoming VTXOs invisible, etc.). Swallow errors
            // so a transient ASP/esplora flake doesn't nuke the whole cycle
            // — we'd rather render slightly stale data than nothing.
            try {
                await syncArkWallet();
            } catch (syncErr) {
                console.warn('[Ark sync] wallet.sync() failed, continuing with cached state:', syncErr);
            }

            // Run balance + vtxos + tip concurrently. These are independent
            // — balance reads SQLite, vtxos reads SQLite, tip hits esplora.
            const [balance, vtxos, tip] = await Promise.all([
                fetchArkBalance(),
                fetchArkVtxos(),
                fetchChainTipHeight(),
            ]);

            // Compose balance + vtxos for the headline number.
            //
            // `balance.totalSats` as returned by fetchArkBalance excludes
            // `pendingInRoundSats` (SDK double-counts both sides of a
            // pending round — see comments in balance.ts). That was correct
            // for the 2× overshoot problem, but it meant that during a
            // VTXO refresh — when the input VTXO becomes Locked — the
            // headline dropped to 0 until the round finalised.
            //
            // The accurate in-round amount IS available though: the SDK's
            // allVtxos() list contains the new output VTXO as Locked with
            // its exact post-fee sat amount. Summing visible (non-Spent)
            // VTXOs gives the user's true retained balance, input OR
            // output, without the 2× overcount.
            //
            // We take max(balance.totalSats, vtxoSum + claimableLn). In
            // steady state the two agree; mid-round the vtxo path wins
            // and keeps the headline stable. `claimableLightningReceive`
            // isn't in the VTXO list (it's arkd-side until the claim
            // flow materialises it), so we add it back explicitly.
            if (balance && vtxos) {
                const vtxoSum = vtxos.spendable.reduce((s, v) => s + v.sats, 0);
                const claimableLn = balance.claimableLightningReceiveSats;
                const headline = Math.max(balance.totalSats, vtxoSum + claimableLn);
                console.log(
                    '[Ark sync] headline=', headline,
                    '(balance.totalSats=', balance.totalSats,
                    'vtxoSum=', vtxoSum,
                    'claimableLn=', claimableLn, ')',
                );
                setArkBalance(headline);
                setArkBalanceDetail(balance);
            } else if (balance) {
                // vtxos fetch failed — trust the balance bucket as-is.
                setArkBalance(balance.totalSats);
                setArkBalanceDetail(balance);
            }
            if (vtxos) {
                console.log(
                    '[Ark sync] writing',
                    vtxos.spendable.length,
                    'vtxos to store (of',
                    vtxos.all.length,
                    'total)',
                );
                setArkVtxos(vtxos.spendable);
            } else {
                console.log('[Ark sync] fetchArkVtxos returned null (no handle)');
            }
            // tip is allowed to be null (esplora offline / network flake) —
            // leave the previous value in place rather than clearing.
            if (tip !== null) {
                setArkChainTipHeight(tip);
            }
            setArkLastSyncedAt(Date.now());
            setLastError(null);
        } catch (err) {
            console.warn('[Ark] sync failed:', err);
            setLastError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            inFlight.current = false;
            setIsSyncing(false);
        }
    }, [
        setArkBalance,
        setArkBalanceDetail,
        setArkVtxos,
        setArkChainTipHeight,
        setArkLastSyncedAt,
    ]);

    // Primary driver: mount + interval. Restarts whenever auth flips on,
    // so the moment a wallet is created the first fetch fires.
    useEffect(() => {
        if (!isArkAuth) return;
        void sync();
        const id = setInterval(() => {
            void sync();
        }, INTERVAL_MS);
        return () => clearInterval(id);
    }, [isArkAuth, sync]);

    // Foreground kick — refresh the moment the user returns to the app,
    // regardless of where the interval is in its cycle.
    useEffect(() => {
        if (!isArkAuth) return;
        const onChange = (status: AppStateStatus) => {
            if (status === 'active') void sync();
        };
        const sub = AppState.addEventListener('change', onChange);
        return () => sub.remove();
    }, [isArkAuth, sync]);

    return { isSyncing, lastError, refresh: sync };
}
