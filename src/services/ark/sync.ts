import useAuthStore from '@Cypher/stores/authStore';

import { decideAutoBoard } from './autoBoardDecision';

import { ensureArkOnchainHandle, getArkWalletHandle, rotateArkOnchainEsplora, setLastOnchainBalanceSats } from './walletHandle';

// Flat board-fee headroom (sats) subtracted from the boardable surplus when an
// exit-fee reserve is armed, so boardAmount's own fee can't erode the reserve
// regardless of whether it deducts fee from the boarded amount or the leftover.
const BOARD_FEE_HEADROOM_SATS = 1500;
// Server board minimum (ark.second.tech). A surplus below this can never board,
// so we hold it on-chain rather than retry-storming boardAmount against it.
const MIN_BOARD_SATS = 50_000;

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

    // MUST be `ensure`, not `get`. `rotateArkOnchainEsplora()` nulls the handle
    // so the next spawn picks a different esplora, but a bare
    // `getArkOnchainHandle()` returns that null and the whole on-chain block
    // below is skipped, silently and permanently: no sync, no balance, no
    // error. One rotation killed the on-chain wallet for the rest of the
    // process, `setLastOnchainBalanceSats` was never reached, and the exit-fee
    // wallet read 0 sats so Emergency Exit stayed gated behind "Fund exit fees
    // first" while the funds sat confirmed on-chain. Observed on device
    // 2026-08-16; the rotate docstring already assumed this call site used
    // `ensure`.
    const onchain = await ensureArkOnchainHandle().catch((err) => {
        console.warn('[Ark sync] onchain handle spawn failed:', err?.message ?? String(err));
        return null;
    });
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
            //
            // Reserve/exit awareness (fund-safety): the unilateral-exit CPFP
            // fees are paid from THIS on-chain wallet. Two rules keep that fee
            // money from being auto-boarded away:
            //   1. While an exit is in progress, board NOTHING, since every VTXO is
            //      already in exit state and the on-chain balance is fee money.
            //      The guard lives HERE (not only in useArkSync's exit branch)
            //      because ArkCapsules calls syncArkWallet() directly on a
            //      stuck-round cancel, unguarded by the exit-in-progress flag.
            //   2. When the user has armed an exit-fee reserve, keep that many
            //      sats on-chain: board only the EXCESS above it (boardAmount),
            //      never boardAll. reserveSats === 0 (every user who hasn't
            //      touched the exit-funding flow) keeps the exact old boardAll
            //      behavior.
            const authState = useAuthStore.getState();
            const boardDecision = decideAutoBoard({
                confirmedSats: Number(onchainBal.confirmedSats),
                pendingBoardSats: Number(arkBal.pendingBoardSats),
                exitInProgress: authState.arkExitInProgress,
                armedReserveSats: authState.arkExitFeeReserveSats,
                recommendedReserveSats: authState.arkExitRecommendedReserveSats,
                minBoardSats: MIN_BOARD_SATS,
                boardFeeHeadroomSats: BOARD_FEE_HEADROOM_SATS,
            });
            if (boardDecision.action === 'board-amount') {
                console.log(
                    '[Ark sync] auto-board: boarding surplus', boardDecision.sats,
                    'sats; keeping', boardDecision.holdSats, 'on-chain for exit fees',
                );
                try {
                    await handle.boardAmount(BigInt(boardDecision.sats));
                    console.log('[Ark sync] auto-board: boardAmount initiated');
                } catch (boardErr) {
                    console.warn('[Ark sync] auto-board: boardAmount failed:', boardErr);
                }
            } else if (boardDecision.action === 'board-all') {
                console.log(
                    '[Ark sync] auto-board: detected',
                    String(onchainBal.confirmedSats),
                    'sats unboarded onchain and nothing to hold, initiating boardAll',
                );
                try {
                    await handle.boardAll();
                    console.log('[Ark sync] auto-board: boardAll initiated');
                } catch (boardErr) {
                    console.warn('[Ark sync] auto-board: boardAll failed:', boardErr);
                }
            } else if (boardDecision.action === 'hold' && __DEV__) {
                console.log(
                    '[Ark sync] auto-board held: surplus', boardDecision.surplusSats,
                    'below board minimum; keeping', boardDecision.holdSats,
                    'on-chain for exit fees',
                );
            } else if (boardDecision.action === 'skip' && __DEV__) {
                console.log('[Ark sync] auto-board skipped:', boardDecision.reason);
            }

            // Progress any pending boards through their phases. No-op when
            // nothing is in flight. Safe to call on every tick.
            await handle.syncPendingBoards();
        } catch (oncErr) {
            // Stringify own properties. A BarkError carries its detail in
            // `inner.errorMessage`, and passing the object straight to
            // console.warn collapses it to a bare "Error", which is what made
            // this failure undiagnosable on device (2026-08-16).
            const detail = `${(oncErr as any)?.tag ?? ''} ${(oncErr as any)?.message ?? ''} ${(oncErr as any)?.inner?.errorMessage ?? ''}`;
            console.warn(
                '[Ark sync] onchain sync / board pipeline failed:',
                detail.trim() || JSON.stringify(oncErr, Object.getOwnPropertyNames(oncErr ?? {})),
            );
            // Rotate on ANY failure, not only errors whose text matches a known
            // network signature. The regex that used to gate this skipped
            // errors that did not stringify the expected way, and the on-chain
            // handle then retried the same dead provider every tick forever:
            // `onchain.sync()` never succeeded, `setLastOnchainBalanceSats` was
            // never reached, so the exit-fee wallet read 0 sats for the entire
            // process lifetime and Emergency Exit stayed gated behind "Fund
            // exit fees first" while the funds sat confirmed on-chain.
            //
            // Rotating on a non-network error is harmless: it just re-spawns
            // the on-chain handle against the other esplora on the next tick.
            rotateArkOnchainEsplora();
        }
    }

    return true;
}
