import { getArkWalletHandle } from './walletHandle';

/**
 * Pull round finalizations, incoming payments, and blockchain state from
 * the ASP + esplora into the local datadir.
 *
 * This is the only thing that updates VTXO state (Spendable → Spent after
 * a refresh/send, or new VTXOs appearing after a round). Without it,
 * `allVtxos()` / `balance()` only show what the client has previously
 * ingested, and stale state lingers indefinitely.
 *
 * Returns `false` when the wallet handle isn't initialised yet (normal at
 * cold start before the user has created/opened an Ark wallet), `true`
 * when the sync completed. Errors are left to bubble — callers decide
 * whether to swallow (periodic poll) or surface (explicit refresh).
 */
export async function syncArkWallet(): Promise<boolean> {
    const handle = getArkWalletHandle();
    if (!handle) return false;
    await handle.sync();
    return true;
}
