import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { triggerPaymentNotification } from '@Cypher/components/PaymentNotification';
import {
    getNotifSeenTxids,
    setNotifSeenTxids,
} from '@Cypher/services/activityCursors';

// Detects new inbound on-chain transactions on the Hot Vault and Cold
// Storage wallets and fires the PaymentNotification banner once per new
// UTXO at 0 confirmations. Confirmed follow-up is intentionally NOT emitted
// (per the "fire once at 0-conf, done" product call) so the user isn't
// double-banner'd for the same receive.
//
// Why polling and not a callback: BlueWallet wallets receive tx updates
// through Electrum sync in `fetchBalance` / `fetchTransactions` — there's
// no per-event hook. We poll the wallet's local tx list on an interval and
// diff against the last snapshot; the actual network sync is driven by
// HomeScreen (getWallet/onRefresh) and BlueWallet's own periodic ticks.
//
// Cursor persistence: a per-vault set of "already banner'd" txids is
// stored in MMKV via activityCursors so a cold restart doesn't refire on
// every mempool-pending tx the user already saw. First-sync (cursor null)
// snapshots the world without emitting so an existing wallet doesn't dump
// its history into the banner queue.
//
// Self-send filtering: BlueWallet's transaction records use signed sats
// (positive = net inbound, negative = net outbound), so a self-send lands
// as a negative value (fee is spent) and the `value > 0` gate below skips
// it correctly. Zero-value entries are also skipped for the same reason.

type NotifTx = {
    txid?: string;
    value?: number;
    confirmations?: number;
};

type NotifWallet = {
    getTransactions?: () => NotifTx[];
} | null | undefined;

type WalletBundle = {
    hot?: NotifWallet;
    cold?: NotifWallet;
};

const POLL_INTERVAL_MS = 15_000;

function scanVault(vault: 'hot' | 'cold', wallet: NotifWallet): void {
    if (!wallet || typeof wallet.getTransactions !== 'function') return;

    let txs: NotifTx[] = [];
    try {
        txs = wallet.getTransactions() ?? [];
    } catch (err) {
        if (__DEV__) console.warn('[IncomingUtxo] getTransactions threw for', vault, err);
        return;
    }
    if (!Array.isArray(txs) || txs.length === 0) return;

    const allTxids = txs
        .map((t) => t?.txid)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const cursor = getNotifSeenTxids(vault);

    // First-sync: snapshot the current world without emitting. Prevents an
    // existing wallet's full receive history from dumping into the banner
    // queue the first time this hook mounts on a device.
    if (cursor === null) {
        setNotifSeenTxids(vault, allTxids);
        return;
    }

    const seen = new Set(cursor);
    const nextSeen: string[] = [...cursor];
    let fired = 0;

    for (const tx of txs) {
        if (!tx || typeof tx.txid !== 'string' || tx.txid.length === 0) continue;
        if (seen.has(tx.txid)) continue;
        // Track this txid regardless of whether we fire, so a still-pending
        // send (value <= 0) doesn't re-enter the diff every tick.
        nextSeen.push(tx.txid);
        seen.add(tx.txid);

        const value = typeof tx.value === 'number' ? tx.value : 0;
        // Skip outbound (value < 0) and self-sends (value <= 0 after the
        // fee subtraction). Only positive net-inbound triggers the banner.
        if (value <= 0) continue;

        triggerPaymentNotification(
            value,
            false /* fire at 0-conf per product call */,
            vault,
            undefined /* let PaymentNotification pick its default label */,
            value /* capsuleValue — drives the capsule color + fill in the banner */,
        );
        fired += 1;
    }

    if (nextSeen.length !== cursor.length) {
        setNotifSeenTxids(vault, nextSeen);
    }

    if (__DEV__ && fired > 0) {
        console.log('[IncomingUtxo] fired', fired, 'banner(s) for', vault);
    }
}

export default function useIncomingUtxoDetector(wallets: WalletBundle): void {
    // Latest wallet refs so the interval callback always sees the current
    // wallet instances without having to be recreated on every wallet swap.
    const walletsRef = useRef<WalletBundle>(wallets);
    walletsRef.current = wallets;

    useEffect(() => {
        const tick = () => {
            const { hot, cold } = walletsRef.current;
            scanVault('hot', hot);
            scanVault('cold', cold);
        };

        // Initial pass on mount. First-sync suppression inside scanVault
        // means this call bootstraps the cursor without banner spam if the
        // wallets already carry history.
        tick();
        const id = setInterval(tick, POLL_INTERVAL_MS);

        // Foreground kick — the moment the user comes back to the app, do
        // an extra scan without waiting for the next interval slot. This
        // covers the "phone was locked while a receive confirmed in the
        // background" case where BlueWallet's own foreground sync populates
        // fresh txs before our poll interval fires.
        const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
            if (status === 'active') tick();
        });

        return () => {
            clearInterval(id);
            sub.remove();
        };
    }, []);
}
