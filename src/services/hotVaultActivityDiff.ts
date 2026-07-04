import { recordEvent } from "@Cypher/stores/eventLogStore";
import {
    getHotVaultSeenTxids,
    setHotVaultSeenTxids,
} from "@Cypher/services/activityCursors";

// Detect on-chain receives by diffing the wallet's transaction list across
// refreshes. Hot Vault is the only on-chain wallet in the v1 schema (Cold
// Vault is watch-only — receives there are still surfaced as Hot via the
// shared mempool but the schema's `wallet: 'hot-vault'` discriminator is
// scoped to the hot-spendable side).
//
// Why diff rather than push: BlueWallet wallets get tx lists via Electrum
// subscription / sync, not via a per-event callback. There's no clean
// "payment arrived" hook to subscribe to — only a periodic state snapshot
// to compare against the last one we processed.
//
// First-sync suppression: when no cursor exists (fresh install / first time
// the activity log has ever looked at this wallet), we record every current
// txid as "seen" without emitting events. Without this, opening the app
// after a long absence would dump the full wallet history into Activity.

type HotVaultLikeWallet = {
    getTransactions: () => Array<{
        txid: string;
        value: number;     // sats, signed: positive = incoming, negative = outgoing
        received?: number; // ms epoch
        confirmations?: number;
    }>;
};

const MIN_CONFIRMATIONS_TO_EMIT = 1;

export function processHotVaultTxsForActivity(wallet: HotVaultLikeWallet | null | undefined): void {
    if (!wallet || typeof wallet.getTransactions !== "function") return;

    let txs: ReturnType<typeof wallet.getTransactions>;
    try {
        txs = wallet.getTransactions();
    } catch {
        return;
    }
    if (!Array.isArray(txs) || txs.length === 0) return;

    const allTxids = txs.map((t) => t.txid).filter((id): id is string => typeof id === "string" && id.length > 0);
    const cursor = getHotVaultSeenTxids();

    // First-sync: snapshot the world without emitting.
    if (cursor === null) {
        setHotVaultSeenTxids(allTxids);
        return;
    }

    const seen = new Set(cursor);
    const newReceives: Array<{ txid: string; sats: number; ts: number }> = [];

    for (const tx of txs) {
        if (!tx.txid || seen.has(tx.txid)) continue;
        // Skip outgoing txs (already emitted by the broadcast path) and
        // unconfirmed receives (avoid emitting then unwinding on a
        // mempool-eviction / RBF replacement).
        if (tx.value <= 0) continue;
        if ((tx.confirmations ?? 0) < MIN_CONFIRMATIONS_TO_EMIT) continue;
        newReceives.push({
            txid: tx.txid,
            sats: tx.value,
            ts: typeof tx.received === "number" ? tx.received : Date.now(),
        });
    }

    // Sort oldest-first so the activity log shows them in chronological order.
    newReceives.sort((a, b) => a.ts - b.ts);
    for (const r of newReceives) {
        recordEvent({ kind: "onchain-received", wallet: "hot-vault", sats: r.sats });
    }

    // Persist the union of (cursor + everything currently visible). Pending
    // unconfirmed txs go into the cursor too — once they confirm on a
    // future tick they're already "seen" and won't re-emit.
    setHotVaultSeenTxids([...new Set([...cursor, ...allTxids])]);
}
