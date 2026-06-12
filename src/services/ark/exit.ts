/**
 * Unilateral Ark exit (a.k.a. emergency exit).
 *
 * Use case: the ASP is unreachable / malicious / blocking the user's pubkey.
 * Cooperative paths (withdraw via round, swap via Lightning) all need ASP
 * participation; this path doesn't. The user broadcasts pre-signed exit txs
 * directly to Bitcoin, waits a CSV timelock (`vtxoExitDelta` in `ArkInfo`,
 * typically ~144 blocks ≈ 24h on mainnet), then drains the resulting on-chain
 * outputs to a Bitcoin address of their choosing.
 *
 * Phase contract (matches the Bark SDK shape):
 *
 *   1. `startArkEmergencyExit()` → `wallet.startExitForEntireWallet()`
 *      Marks every VTXO for exit. No on-chain txs broadcast yet.
 *
 *   2. `progressArkExits()` → `wallet.progressExits(onchain, feeRate?)`
 *      Builds + broadcasts the actual on-chain exit txs as inputs become
 *      spendable, advances per-VTXO state machines. Must be called
 *      repeatedly — once per sync tick is enough.
 *
 *   3. `claimArkExitsToAddress(addr, feeRate?)` → `wallet.drainExits(...)`
 *      Once `wallet.listClaimableExits()` returns non-empty, the user can
 *      sweep the claimable VTXOs to a chosen Bitcoin address. Typically
 *      called automatically from `useArkSync` once the timelock ripens.
 *
 * Read-only helpers (`fetchArkExitStatus`, `fetchClaimableExitVtxos`,
 * `fetchPendingExitsTotalSats`) are surface for the Settings UI's status
 * panel during the wait.
 *
 * IMPORTANT: progressExits and drainExits are SYNCHRONOUSLY-blocking
 * UniFFI calls — they freeze the JS thread for seconds. Caller should not
 * await them on a UI tap; instead surface progress as toasts and let the
 * sync loop drive them.
 */

import type { ExitClaimTransaction, ExitVtxo } from '@secondts/bark-react-native';

import { ensureArkOnchainHandle, getArkOnchainHandle, getArkWalletHandle } from './walletHandle';

function requireWallet() {
    const handle = getArkWalletHandle();
    if (!handle) throw new Error('Ark wallet not open — cannot run exit flow');
    return handle;
}

/**
 * Kick off unilateral exit for ALL VTXOs in this wallet. No destination is
 * needed yet — the destination is supplied at `claimArkExitsToAddress` time
 * (we save it in zustand at start so the auto-claim loop has it).
 */
export async function startArkEmergencyExit(): Promise<void> {
    const handle = requireWallet();
    // Spawn the onchain wallet eagerly — progressExits() needs it on the very
    // next tick. Catching here surfaces a clean error to the UI rather than
    // letting the first sync-cycle progress call fail with "not initialized".
    await ensureArkOnchainHandle();
    await handle.startExitForEntireWallet();
}

/**
 * Drive forward every pending exit. Idempotent — safe to call on every sync
 * tick. Returns the per-VTXO progress snapshot for observability; the UI
 * doesn't have to consume it (status panel reads `fetchArkExitStatus`).
 *
 * Failure mode: any individual exit can throw mid-progress (network flake,
 * fee-rate too low, etc.). We surface the array; the sync loop swallows
 * errors and retries on the next tick.
 */
export async function progressArkExits(
    feeRateSatPerVb?: bigint,
): Promise<unknown[]> {
    const handle = requireWallet();
    const onchain = getArkOnchainHandle();
    if (!onchain) {
        // Lazily spawn — first call after process restart hits this branch.
        await ensureArkOnchainHandle();
    }
    const onchainReady = getArkOnchainHandle();
    if (!onchainReady) {
        throw new Error('Ark onchain wallet not available');
    }
    const result = await handle.progressExits(onchainReady, feeRateSatPerVb);
    return result;
}

/**
 * Periodic chain-state sync for exit txs. Reconciles the wallet's view of
 * exits with what's actually confirmed on-chain. Call alongside
 * `progressArkExits` from the sync loop.
 *
 * Like `progressExits`, the SDK needs the on-chain wallet to verify
 * confirmations against the BDK-tracked UTXO set.
 */
export async function syncArkExits(): Promise<void> {
    const handle = requireWallet();
    if (!getArkOnchainHandle()) {
        await ensureArkOnchainHandle();
    }
    const onchain = getArkOnchainHandle();
    if (!onchain) {
        throw new Error('Ark onchain wallet not available');
    }
    await handle.syncExits(onchain);
}

/**
 * Total sats currently in pending-exit state (broadcast but not yet
 * claimable). Drives the "Exiting — X sats pending" status line.
 */
export async function fetchPendingExitsTotalSats(): Promise<number> {
    const handle = requireWallet();
    const total = await handle.pendingExitsTotalSats();
    return Number(total);
}

/**
 * True if the wallet has any exits in flight (pending OR claimable). Useful
 * as a cheap check on cold-launch to decide whether to engage the exit
 * sync loop.
 */
export async function fetchHasPendingExits(): Promise<boolean> {
    const handle = requireWallet();
    return await handle.hasPendingExits();
}

/**
 * Per-VTXO snapshot of every exit the wallet is tracking. Used to feed a
 * "X of Y exits ready" UI hint during the wait.
 */
export async function fetchArkExitVtxos(): Promise<ExitVtxo[]> {
    const handle = requireWallet();
    return await handle.getExitVtxos();
}

/**
 * Subset of `getExitVtxos` filtered to only those whose CSV timelock has
 * matured AND whose on-chain confirmations are sufficient for `drainExits`
 * to succeed. Empty until the first exit ripens (~24h post-start on
 * mainnet).
 */
export async function fetchClaimableExitVtxos(): Promise<ExitVtxo[]> {
    const handle = requireWallet();
    return await handle.listClaimableExits();
}

/**
 * Sweep any currently-claimable exits to the user's chosen Bitcoin address.
 * Pass an empty `vtxoIds` array to drain ALL claimable exits in one shot
 * (the Bark default). The returned PSBT is signed and broadcast by the SDK
 * itself — caller doesn't need to relay it manually.
 *
 * Returned `feeSats` reflects the fee paid. Surface that in the UI so the
 * user knows what came off the top.
 */
export async function claimArkExitsToAddress(
    address: string,
    feeRateSatPerVb?: bigint,
): Promise<ExitClaimTransaction> {
    const handle = requireWallet();
    if (!address || !address.trim()) {
        throw new Error('Destination address is required');
    }
    return await handle.drainExits([], address.trim(), feeRateSatPerVb);
}
