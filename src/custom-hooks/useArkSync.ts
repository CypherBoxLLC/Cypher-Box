import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';

import {
    fetchArkBalance,
    fetchArkVtxos,
    fetchChainTipHeight,
    getArkWalletHandle,
    getCachedArkMnemonic,
    syncArkWallet,
    tryClaimArkLightningReceives,
    writeArkAutoBackup,
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
 *
 * PERFORMANCE NOTE: every cycle does ~5s of JS-thread-blocking UniFFI calls
 * into Bark's Rust crate (`syncArkWallet` ~2.3s, `fetchBalance/Vtxos/Tip`
 * ~2.6s on Galaxy A14). The Rust crate runs synchronously on the JS thread
 * because that's how `bark-react-native`'s UniFFI bindings work today, so
 * during those 5 seconds JS-driven UI updates stop. We can't make Rust
 * faster, but we can make the freezes less frequent and less noticeable:
 *   1. Longer interval on Android (slower phones, bigger relative cost)
 *   2. `InteractionManager.runAfterInteractions` so a cycle never starts
 *      mid-tap or mid-scroll — the work still runs, but only after the
 *      user's gesture completes, so they don't feel the freeze.
 *   3. Skip the slowest call (`syncArkWallet`) when there are no VTXOs
 *      and the prior sync was recent — nothing to sync against the ASP.
 */
const INTERVAL_MS_IOS = 30_000;
// Android (Galaxy A14 in particular) feels every 5s freeze; halving the
// freeze frequency to once a minute makes the wallet feel ~2x snappier
// while balance staleness stays acceptable for a non-custodial Ark wallet.
const INTERVAL_MS_ANDROID = 60_000;
const INTERVAL_MS = Platform.OS === 'android' ? INTERVAL_MS_ANDROID : INTERVAL_MS_IOS;
// If both balance and vtxo list have been zero/empty for at least N ticks,
// assume the wallet is idle (no incoming Lightning, no in-flight rounds,
// nothing to refresh). Skip the slow `syncArkWallet` call on those ticks
// and just refresh balance/vtxos/tip — saving ~2s per cycle.
const IDLE_SKIP_AFTER_EMPTY_TICKS = 3;

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
    const setArkLastBackupAt = useAuthStore((s) => s.setArkLastBackupAt);

    const [isSyncing, setIsSyncing] = useState(false);
    const [lastError, setLastError] = useState<Error | null>(null);

    // Guard against overlapping fetches: if a previous sync is still
    // in-flight when the interval fires, skip the new one. This also means
    // a slow esplora round-trip doesn't stack up calls behind it.
    const inFlight = useRef(false);
    // Counter used by the idle-skip heuristic. Increments every cycle that
    // returns balance=0 and vtxos.all.length=0; resets the moment either
    // turns non-zero. We use this to avoid the 2s Bark `syncArkWallet`
    // call when the wallet has nothing to settle.
    const consecutiveEmptyTicks = useRef(0);
    // Signature of the wallet state captured by the last successful auto-backup.
    // We skip the backup (which does pure-JS AES on the JS thread — see backup.ts)
    // when the new signature matches the previous one, because re-encrypting the
    // same plaintext to disk is pointless and stalls the UI for several seconds
    // every cycle on slow Android phones (Galaxy A14: ~1min freeze on a fresh wallet).
    const lastBackupSignature = useRef<string | null>(null);

    const sync = useCallback(async () => {
        if (inFlight.current) return;

        // Hard gate on handle readiness. On cold boot, `restoreArkWalletFromDisk`
        // takes 3-5s on a Galaxy A14 to reopen the Bark wallet. If the sync
        // hook fires in that window (mount triggers it immediately), the
        // UniFFI calls inside `fetchArkBalance` etc. block the JS thread
        // waiting for the handle that's still being opened by the boot
        // restore — an extra 4-5 seconds of JS-thread freeze on top of
        // the already-slow boot. Skip until the handle is genuinely ready;
        // the AppState 'active' listener and the next interval tick will
        // pick up where we left off.
        if (!getArkWalletHandle()) {
            if (__DEV__) console.log('[ArkSync] skipped — wallet handle not ready yet');
            return;
        }

        inFlight.current = true;
        setIsSyncing(true);
        // Defer the heavy work until the JS thread is genuinely idle.
        // RN's InteractionManager queues callbacks behind any in-flight
        // gesture / animation / native module callback. If the user is
        // currently tapping a button or scrolling, the sync waits up to
        // a few hundred ms for that to finish — we trade slightly stale
        // data for not pinning the JS thread mid-interaction.
        await new Promise<void>((resolve) =>
            InteractionManager.runAfterInteractions(() => resolve()),
        );
        // TEMPORARY: Bam reported a 20s freeze on cold launch when Ark exists.
        // Per-call timing narrows the JS-thread block to a single SDK call.
        const _t0 = Date.now();
        const _stamp = (label: string) => __DEV__ && console.log(`[ArkSync] ${label} +${Date.now() - _t0}ms`);
        _stamp('cycle start');
        try {
            // Drive forward any pending Lightning receives BEFORE reading
            // VTXOs. (See original comment.)
            await tryClaimArkLightningReceives();
            _stamp('tryClaimArkLightningReceives done');

            // Pull round finalizations + server-side updates into the local
            // datadir. SKIPPED when the wallet has been empty for
            // IDLE_SKIP_AFTER_EMPTY_TICKS in a row — there's nothing on the
            // ASP side to settle against an empty pubkey, and burning 2s of
            // JS-thread time for nothing is the freeze users notice most.
            // The first non-empty balance / vtxo result instantly resets
            // the skip counter, so a Lightning receive or board doesn't
            // get delayed.
            const skipSync = consecutiveEmptyTicks.current >= IDLE_SKIP_AFTER_EMPTY_TICKS;
            if (skipSync) {
                _stamp(`syncArkWallet skipped (idle ${consecutiveEmptyTicks.current} ticks)`);
            } else {
                try {
                    await syncArkWallet();
                    _stamp('syncArkWallet done');
                } catch (syncErr) {
                    console.warn('[Ark sync] wallet.sync() failed, continuing with cached state:', syncErr);
                    _stamp('syncArkWallet FAILED');
                }
            }

            // Run balance + vtxos + tip concurrently. These are independent
            // — balance reads SQLite, vtxos reads SQLite, tip hits esplora.
            const [balance, vtxos, tip] = await Promise.all([
                fetchArkBalance(),
                fetchArkVtxos(),
                fetchChainTipHeight(),
            ]);
            _stamp('fetchBalance/Vtxos/Tip done');

            // Headline = the SDK's `balance.totalSats` (Spendable VTXOs +
            // pendingExit/Lightning/Board buckets). We deliberately do NOT
            // mix in the VTXO list here.
            //
            // History — why this used to be `Math.max(balance.totalSats,
            // vtxoSum + claimableLn)`: during a VTXO refresh the SDK
            // marks the input VTXO Locked and emits a Locked output VTXO,
            // which would temporarily drop `spendableSats` to 0. The
            // Math.max kept the headline stable mid-round by trusting the
            // VTXO list instead. But that path has a worse failure: it
            // ALSO counts Locked VTXOs that are mid-send (i.e. already
            // spent, just waiting for the SDK to flip them to Spent),
            // so post-withdrawal the balance stays artificially high
            // until the spent VTXOs detach from the wallet's pubkey
            // server-side — which can take many minutes. That was the
            // bigger UX hit (users see "balance unchanged" after a tx
            // confirmed in their hot vault), so we revert to trusting
            // `balance.totalSats`.
            //
            // For the refresh-mid-round case: `pendingInRoundSats` is now
            // surfaced through `arkBalanceDetail` and the UI can render
            // a "+ X sats refreshing" indicator beside the headline,
            // rather than inflating the headline itself. That matches
            // user expectation: balance = what you can actually spend
            // right now, with in-flight movements shown separately.
            if (balance) {
                console.log(
                    '[Ark sync] headline=', balance.totalSats,
                    '(spendable=', balance.spendableSats,
                    'pendingInRound=', balance.pendingInRoundSats,
                    'claimableLn=', balance.claimableLightningReceiveSats, ')',
                );
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

            // Update the idle-skip counter based on what this tick saw.
            // Both balance and vtxo list have to be empty for us to count
            // the tick as "idle"; non-zero in either resets the counter
            // immediately so the next tick syncs against the ASP again.
            const isEmpty =
                (!balance || balance.totalSats === 0) &&
                (!vtxos || vtxos.all.length === 0);
            if (isEmpty) {
                consecutiveEmptyTicks.current += 1;
            } else {
                consecutiveEmptyTicks.current = 0;
            }
            // tip is allowed to be null (esplora offline / network flake) —
            // leave the previous value in place rather than clearing.
            if (tip !== null) {
                setArkChainTipHeight(tip);
            }
            setArkLastSyncedAt(Date.now());
            setLastError(null);

            // --- Auto-backup (fire-and-forget, off the critical path) ---
            //
            // After every successful sync the datadir reflects current wallet
            // state. We write an encrypted snapshot to AUTO_BACKUP_PATH in
            // Documents so the user's funds are recoverable even if they never
            // tap "Back up wallet state" manually.
            //
            // We do NOT await this — backup takes ~0.5-1s (file reads + AES)
            // and must not stall the sync cycle or block the UI. The backup
            // runs concurrently; the next sync tick starts fresh either way.
            //
            // We use getCachedArkMnemonic() rather than hitting Keychain so
            // there is no biometric prompt during a background tick. The seed
            // was cached in walletHandle when the wallet was opened.
            // Skip auto-backup if nothing observable changed since the last
            // backup. The encrypt step is pure-JS CryptoJS AES (see backup.ts)
            // which blocks the JS thread; re-encrypting an unchanged datadir
            // every 60s causes ~5-60s of UI freeze per cycle for no benefit.
            // A simple signature on (balance, vtxo counts, tip) is enough —
            // if any of those move, the datadir has changed and we re-back-up.
            const signature = [
                balance?.totalSats ?? 'n',
                vtxos?.all.length ?? 'n',
                vtxos?.spendable.length ?? 'n',
                tip ?? 'n',
            ].join('|');

            const mnemonic = getCachedArkMnemonic();
            if (mnemonic && signature === lastBackupSignature.current) {
                if (__DEV__) console.log('[Ark auto-backup] skipped — state unchanged');
            } else if (mnemonic && signature !== lastBackupSignature.current) {
                writeArkAutoBackup(mnemonic)
                    .then(({ sizeBytes, createdAt }) => {
                        lastBackupSignature.current = signature;
                        setArkLastBackupAt(createdAt);
                        if (__DEV__) {
                            console.log(
                                '[Ark auto-backup] wrote',
                                (sizeBytes / 1024).toFixed(1),
                                'KB to Documents',
                            );
                        }
                    })
                    .catch((err) => {
                        // Swallow — auto-backup is best-effort. The user still
                        // has the manual "Back up wallet state" button. A
                        // failure here is typically a filesystem issue (low
                        // storage) or a concurrent write; it won't repeat
                        // indefinitely since the next successful sync retries.
                        if (__DEV__) {
                            console.warn('[Ark auto-backup] failed:', err?.message ?? err);
                        }
                    });
            }
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
        setArkLastBackupAt,
    ]);

    // Primary driver: mount + interval. Restarts whenever auth flips on,
    // so the moment a wallet is created the first fetch fires.
    //
    // The handle-readiness gate inside `sync()` may return early if the
    // boot restore hasn't finished. Without a fast-retry the user would
    // wait up to INTERVAL_MS (60s on Android) for their balance after
    // first launch. So we also kick off a short polling loop on mount:
    // probe every 600ms for up to 15s, fire the sync the moment the
    // handle becomes ready, then stop polling. After the first
    // successful sync the interval driver takes over.
    useEffect(() => {
        if (!isArkAuth) return;
        void sync();

        // Fast retry: catch the wallet handle the moment boot finishes.
        let pollTries = 0;
        const POLL_INTERVAL_MS = 600;
        const POLL_MAX_TRIES = 25; // 25 * 600ms = 15s ceiling
        const fastPollId = setInterval(() => {
            pollTries += 1;
            if (getArkWalletHandle()) {
                clearInterval(fastPollId);
                void sync();
            } else if (pollTries >= POLL_MAX_TRIES) {
                clearInterval(fastPollId);
            }
        }, POLL_INTERVAL_MS);

        const id = setInterval(() => {
            void sync();
        }, INTERVAL_MS);
        return () => {
            clearInterval(id);
            clearInterval(fastPollId);
        };
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
