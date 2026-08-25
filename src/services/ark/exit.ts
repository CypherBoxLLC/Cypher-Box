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
 *   1. `startArkEmergencyExit(ids)` → `wallet.startExitForVtxos(ids)`
 *      Marks the triaged VTXO set for exit. No on-chain txs broadcast yet.
 *      The set comes from `computeArkExitPlan` in ./exitFunding, which drops
 *      capsules that cannot be exited, cannot clear their timelock before
 *      expiry, or would cost more reserve than they can ever return.
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

import { isActiveExit } from './barkState';
import { ensureArkOnchainHandle, getArkWalletHandle } from './walletHandle';
import { runBroadcastCall } from './indeterminate';

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
    if (!handle) throw new Error(
        'The vault is not open yet. It needs a connection to open, so check yours and reopen the vault, then try again.',
    );
    return handle;
}

/**
 * Kick off a unilateral exit for a CHOSEN set of VTXOs. No destination is
 * needed yet: it is supplied at `claimArkExitsToAddress` time (we save it in
 * zustand at start so the auto-claim loop has it).
 *
 * Takes ids rather than exiting the whole wallet. `startExitForEntireWallet()`
 * marks every VTXO, dust included, and the on-chain reserve is then sized over
 * all of it. Measured on the QA wallet 2026-08-20 at 1 sat/vB: two 400-sat
 * capsules on deep exit trees were 10,656 of the 16,060 vB the exit would cost,
 * 66% of the reserve for 16% of the value, and neither could ever return more
 * than it consumed. The reserve that dust eats is the reserve the healthy
 * capsules need, so it does not merely waste money, it decides which capsules
 * get stranded when the reserve runs dry.
 *
 * Callers pass `computeArkExitPlan().selectedIds` (see ./exitFunding), and must
 * have shown the user every excluded capsule by name and amount first. Refuses
 * an empty set rather than falling back to the whole wallet: a silent fallback
 * would reintroduce exactly the behaviour this replaces.
 */
export async function startArkEmergencyExit(vtxoIds: readonly string[]): Promise<void> {
    const handle = requireWallet();
    const ids = (vtxoIds ?? []).filter((id) => !!id);
    if (ids.length === 0) {
        throw new Error('No capsules can be exited right now.');
    }
    // Spawn the onchain wallet eagerly — progressExits() needs it on the very
    // next tick. Catching here surfaces a clean error to the UI rather than
    // letting the first sync-cycle progress call fail with "not initialized".
    await ensureArkOnchainHandle();
    await handle.startExitForVtxos([...ids]);
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
    // bark 0.15.0: the onchain wallet is pinned at Wallet.open
    // (WalletOpenArgs.onchain) rather than passed per-call, so progressExits no
    // longer takes it. openArkWallet/createArkWallet always supply it and the
    // boot-restore path re-opens, so a live Ark handle always has its onchain.
    const result = await handle.progressExits(feeRateSatPerVb);
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
    // bark 0.15.0: onchain pinned at open; syncExits no longer takes it.
    await handle.syncExits();
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
 * Does bark's own DB hold any NON-TERMINAL exit record?
 *
 * The authoritative "is an exit live" signal, and deliberately independent of
 * zustand: the background-refresh wake runs headless and can execute before the
 * store has rehydrated, at which point `arkExitInProgress` reads its default
 * `false` and the sync guard silently passes. This one asks bark.
 *
 * Non-terminal means Processing (broadcasting), any Awaiting* phase (including
 * the ~24h AwaitingDelta CSV wait), or claimable. Matching only Processing
 * would report "no exit" for most of the exit's life.
 *
 * Liveness MUST go through isActiveExit. This function used to regex
 * `String(v.state)` for /^(Processing|Awaiting)/, which bark 0.6.1 broke when
 * it turned `state` into a tagged-enum object: `String({tag:'AwaitingDelta'})`
 * is "[object Object]", the regex never matched, and the whole check collapsed
 * to `v.isClaimable`. Verified live on 2026-08-18 against an exit with 2794
 * sats in flight (three AwaitingDelta, one ClaimInProgress, all
 * isClaimable=false): this returned FALSE, so the guard it feeds was open for
 * essentially the entire exit.
 *
 * Returns false when the handle is unavailable or the read throws: callers use
 * this to BLOCK an action, and a failed read is not evidence of an exit. The
 * sync-flag check in `assertNoActiveArkExit` remains the first line of defence.
 */
export async function hasActiveArkExitRecords(): Promise<boolean> {
    try {
        const handle = getArkWalletHandle();
        if (!handle) return false;
        const exits = await handle.getExitVtxos();
        return (exits ?? []).some((v) => isActiveExit(v));
    } catch {
        return false;
    }
}

/**
 * Async companion to `assertNoActiveArkExit` for paths that can run before the
 * store is hydrated (background wake) or that are about to hand VTXOs to the
 * ASP for a cooperative round.
 *
 * Checks the cheap sync signals first, then bark's DB.
 */
export async function assertNoActiveArkExitAsync(action = 'This action'): Promise<void> {
    const s = useAuthStore.getState();
    const exitingVtxo = (s.arkVtxos ?? []).some((v) => (v as { exiting?: boolean }).exiting);
    if (s.arkExitInProgress || exitingVtxo || (await hasActiveArkExitRecords())) {
        throw new Error(
            `${action} is unavailable while an Emergency Exit is in progress.`,
        );
    }
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
    // If this dies mid-call the claim may already be in a mempool. Reporting a
    // clean failure would invite a second claim attempt against outputs that
    // are already being spent.
    const txid = await runBroadcastCall(() => handle.broadcastTx(txHex), 'claim');
    console.log(`[Ark exit] claim broadcast txid=${txid}`);

    return { txid, feeSats, psbtBase64: claim.psbtBase64 };
}
