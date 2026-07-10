import { getArkOnchainHandle, getArkWalletHandle, rotateArkOnchainEsplora, setLastOnchainBalanceSats } from './walletHandle';

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
 *
 * ## Onchain side (boarding detection + auto-board)
 *
 * Bark splits its state into two cooperating wallets — `Wallet` (Ark
 * vtxos / Lightning / rounds) and `OnchainWallet` (BDK-backed Bitcoin
 * scanning at the same seed). `handle.sync()` only refreshes the first.
 * For boarding deposits to be detected we MUST also drive the second,
 * and then invoke `boardAll` to push detected UTXOs through the ASP.
 *
 * Background: prior to this code, the boarding flow consisted of nothing
 * more than `OnchainWallet.newAddress()` shown to the user. A real $400
 * boarding tx (`aa14b67f...`) sat undetected for hours because neither
 * `onchain.sync()` nor `wallet.boardAll(onchain)` nor
 * `wallet.syncPendingBoards()` was called anywhere in the codebase. The
 * recovery was done via the bark CLI in 2.5 seconds against the same
 * ASP+esplora endpoints — proving the SDK works; only the wiring was
 * missing. See `.claude/SESSION_HANDOVER...md` (bark CLI session) for
 * the full debug trail.
 *
 * Order matters and is intentional:
 *   1. `handle.sync()`              → vtxos + LN + round finalizations.
 *   2. `onchain.sync()`             → BDK chain scan; populates bdk_txs /
 *                                     bdk_txouts with any new deposits at
 *                                     previously-revealed boarding addresses.
 *   3. `boardAll(onchain)` (if any) → push detected confirmed UTXOs into
 *                                     the ASP. Idempotent: only fires when
 *                                     confirmedSats > 0 AND nothing is
 *                                     already in pendingBoardSats.
 *   4. `syncPendingBoards()`        → progress in-flight boards through
 *                                     their phases (queued → in-round →
 *                                     materialised vtxo).
 *
 * If `onchain` is null we skip steps 2–4 silently. That happens before the
 * eager-spawn in `walletHandle` has had a chance to run, or in cold-start
 * paths that don't spawn it. The next sync tick after the handle exists
 * will catch up.
 */
export async function syncArkWallet(): Promise<boolean> {
    const handle = getArkWalletHandle();
    if (!handle) return false;
    await handle.sync();

    const onchain = getArkOnchainHandle();
    if (onchain) {
        try {
            const syncedSats = await onchain.sync();
            if (__DEV__ && syncedSats > 0n) {
                console.log('[Ark sync] onchain.sync delta=' + String(syncedSats) + ' sats');
            }

            const onchainBal = await onchain.balance();
            // Cache this reliable post-sync read so fetchArkBalance can surface
            // the on-chain (boarding) bucket without its own racy balance() call.
            setLastOnchainBalanceSats(Number(onchainBal.confirmedSats), Number(onchainBal.pendingSats));
            const arkBal = await handle.balance();

            // Auto-board guard: only initiate if BDK sees confirmed funds
            // AND bark doesn't already have a pending board in flight. The
            // second clause prevents double-firing while a previous board
            // is mid-round and bark has not yet observed the input
            // consumption back from BDK's scanner.
            if (onchainBal.confirmedSats > 0n && arkBal.pendingBoardSats === 0n) {
                console.log(
                    '[Ark sync] auto-board: detected',
                    String(onchainBal.confirmedSats),
                    'sats unboarded onchain, initiating boardAll',
                );
                try {
                    await handle.boardAll(onchain);
                    console.log('[Ark sync] auto-board: boardAll initiated');
                } catch (boardErr) {
                    console.warn('[Ark sync] auto-board: boardAll failed:', boardErr);
                }
            }

            // Progress any pending boards through their phases. No-op when
            // nothing is in flight. Safe to call on every tick.
            await handle.syncPendingBoards();
        } catch (oncErr) {
            console.warn('[Ark sync] onchain sync / board pipeline failed:', oncErr);
            // If the pinned esplora is bot-blocking us (BarkError.Network /
            // ServerConnection / the "not a blockhash" 338-byte block page),
            // drop the handle and rotate providers so the next tick re-spawns
            // against the alternate endpoint instead of failing forever.
            const detail = `${(oncErr as any)?.tag ?? ''} ${(oncErr as any)?.message ?? ''} ${(oncErr as any)?.inner?.errorMessage ?? ''}`;
            if (/Network|ServerConnection|blockhash|hex string|timeout|timed out/i.test(detail)) {
                rotateArkOnchainEsplora();
            }
        }
    }

    return true;
}
