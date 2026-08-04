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

import { extractTxFromPsbt } from '@secondts/bark-react-native';
import type { ExitClaimTransaction, ExitVtxo } from '@secondts/bark-react-native';

import useAuthStore from '@Cypher/stores/authStore';

import { ensureArkOnchainHandle, getArkOnchainHandle, getArkWalletHandle } from './walletHandle';

/**
 * Hard gate for every OUTGOING spend path (send, offboard, convert, swap
 * source): while a unilateral exit is active, the wallet must refuse to
 * spend. bark keeps reporting exiting VTXOs as Spendable until the exit's
 * leaf tx confirms, so without this the user could double-commit the same
 * coin: a cooperative spend racing their own in-flight exit inside the
 * fraud window (one of the two loses, and it can be the user).
 *
 * Two sync signals, no SDK call (safe to run at estimate frequency):
 *   - `arkExitInProgress` — authoritative flag; kept honest by useArkSync's
 *     bark-DB self-heal (re-arms it whenever active exit records exist).
 *   - any store VTXO marked `exiting` — belt-and-suspenders for the window
 *     before the self-heal tick lands.
 *
 * Throws with user-facing copy: callers surface `err.message` in the
 * estimate/send error toast, so the block explains itself.
 */
export function assertNoActiveArkExit(): void {
    const s = useAuthStore.getState();
    const exitingVtxo = (s.arkVtxos ?? []).some((v) => (v as { exiting?: boolean }).exiting);
    if (s.arkExitInProgress || exitingVtxo) {
        throw new Error(
            'Emergency Exit is in progress. Sending from the Bark vault is disabled until the exit completes on-chain.',
        );
    }
}

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
 * Extract a broadcastable tx hex from a claim PSBT produced by drainExits.
 *
 * Exit-claim inputs are taproot script-path (CSV) spends; WalletLike exposes a
 * dedicated signer, signExitClaimInputs(). If drainExits already returned a
 * finalized PSBT, that call may reject, so we fall back to extracting the PSBT
 * as-is. Which path is canonical is being confirmed with Second.tech; each path
 * logs so a device run locks it in and we can drop the fallback.
 */
async function finalizeExitClaimPsbtToHex(psbtBase64: string): Promise<string> {
    const handle = requireWallet();
    try {
        const signed = await handle.signExitClaimInputs(psbtBase64);
        const hex = extractTxFromPsbt(signed);
        console.log('[Ark exit] finalize path=signExitClaimInputs');
        return hex;
    } catch (e: any) {
        console.log(
            '[Ark exit] signExitClaimInputs failed, trying raw extract:',
            e?.message ?? e,
        );
    }
    const hex = extractTxFromPsbt(psbtBase64);
    console.log('[Ark exit] finalize path=raw-extract');
    return hex;
}

/**
 * Result of a claim sweep. A non-empty `txid` is the ONLY proof the funds
 * actually left the exit output; callers must gate exit-completion on it.
 */
export interface ArkExitClaimResult {
    txid: string;
    feeSats: number;
    psbtBase64: string;
}

/**
 * Sweep all currently-claimable exits to the user's chosen Bitcoin address.
 *
 * CORRECTED 2026-08-02: `handle.drainExits()` does NOT broadcast. It only
 * builds and signs a claim PSBT ({ psbtBase64, feeSats }); the caller must
 * finalize and relay it. The old code (and its "broadcast by the SDK itself"
 * comment) stopped after drainExits, so every unilateral exit stalled at the
 * final sweep: the claim VTXO stayed listClaimableExits()-visible forever, the
 * vault stayed send-locked, and nothing hit the chain (observed live: a matured
 * leaf output sat unspent 2+ days past its 144-block CSV while drainExits
 * "succeeded" every 2 min). Pipeline is now:
 *   drainExits -> finalize (sign) -> extractTxFromPsbt -> broadcastTx
 *
 * Returns the broadcast txid plus the fee paid. Surface `feeSats` in the UI so
 * the user knows what came off the top.
 */
export async function claimArkExitsToAddress(
    address: string,
    feeRateSatPerVb?: bigint,
): Promise<ArkExitClaimResult> {
    const handle = requireWallet();
    const dest = address?.trim();
    if (!dest) {
        throw new Error('Destination address is required');
    }

    // 1. Build + sign the claim PSBT. Does NOT broadcast.
    const claim: ExitClaimTransaction = await handle.drainExits(
        [],
        dest,
        feeRateSatPerVb,
    );
    const feeSats = Number(claim.feeSats);
    console.log(`[Ark exit] drainExits built claim PSBT, fee=${feeSats} sats`);

    // 2 + 3. Finalize to a broadcastable tx hex.
    const txHex = await finalizeExitClaimPsbtToHex(claim.psbtBase64);

    // 4. Broadcast. This is the step that was missing entirely.
    const txid = await handle.broadcastTx(txHex);
    console.log(`[Ark exit] claim broadcast txid=${txid}`);

    return { txid, feeSats, psbtBase64: claim.psbtBase64 };
}
