import { getArkOnchainHandle, getArkWalletHandle } from './walletHandle';
import type { ArkVtxoView } from './vtxos';

/**
 * Plain-number view of the Bark SDK's Balance struct.
 *
 * The SDK returns bigints for all sat amounts, which don't survive JSON
 * serialization (zustand persist) and don't arithmetic cleanly with the
 * rest of the app's `number` conventions. This shape is the boundary:
 * everything above this layer works in plain numbers, everything at the
 * SDK layer works in bigint.
 *
 * Sat values fit in a double until ~2^53 (~90M BTC) — way above the 21M
 * BTC cap — so the lossy conversion is safe for this domain.
 */
export type ArkBalanceSummary = {
    /**
     * Headline balance shown in the UI: sats the user can send right now.
     * Mirrors `spendableSats` exactly — pending in-flight buckets (exits,
     * LN sends/receives, on-chain board confirmations, in-progress rounds)
     * are NOT silently rolled in. Render those separately if relevant.
     */
    totalSats: number;
    /** Spendable off-chain (Ark) sats — immediately sendable. */
    spendableSats: number;
    /** Sats locked in an in-progress round (temporary). */
    pendingInRoundSats: number;
    /** Sats being unilaterally exited to on-chain. */
    pendingExitSats: number;
    /** Sats tied up in a pending Lightning outbound payment. */
    pendingLightningSendSats: number;
    /** Sats claimable from a Lightning inbound payment (NOT total pending). */
    claimableLightningReceiveSats: number;
    /** Sats awaiting on-chain board confirmations. */
    pendingBoardSats: number;
    /**
     * Sats trapped in expired VTXOs the SDK still flags Spendable. The Bark
     * SDK keeps expired VTXOs in its local DB until the ASP sweeps them
     * server-side and a sync prunes them; until that happens `wallet.balance()`
     * over-reports `spendableSats` by this amount. We subtract them at the
     * `applyExpiredVtxoFilter` boundary so the headline never shows phantom
     * dust the user can't actually spend.
     *
     * Always 0 when the filter wasn't applied (no vtxo list / no chain tip).
     */
    expiredUnrecoverableSats: number;
    /**
     * Confirmed sats sitting in bark's on-chain (BDK) wallet that haven't been
     * boarded into a VTXO yet. Below the server's minBoardAmountSats this is
     * stuck (can never board); at/above it, a board is in progress. Surfaced
     * separately so the UI can show a "Boarding (on-chain)" row + recovery.
     * See .claude/ARK_STUCK_UTXO_UX_SPEC.md.
     */
    onchainBoardingSats: number;
    /** Unconfirmed on-chain boarding sats (still gaining confirmations). */
    onchainConfirmingSats: number;
};

function toNum(b: bigint): number {
    return Number(b);
}

/**
 * Fetch the current Ark balance.
 *
 * Returns null if the wallet handle isn't initialized (i.e. user hasn't
 * created an Ark wallet yet). Callers should treat null as "show nothing"
 * rather than "zero" — the latter is a valid state for a funded-then-spent
 * wallet.
 *
 * Note: `wallet.balance()` reads from the local SQLite datadir; it does NOT
 * round-trip to the ASP. For a fresh on-chain deposit to appear, the daemon
 * sync loop (configured via daemonSlowSyncIntervalSecs) must have run.
 *
 * The returned summary's `totalSats` equals `spendableSats`. Callers that
 * also have the VTXO list and current chain tip should pipe the result
 * through `applyExpiredVtxoFilter` to subtract expired-but-still-Spendable
 * dust before rendering or running spend-availability checks.
 */
export async function fetchArkBalance(): Promise<ArkBalanceSummary | null> {
    const handle = getArkWalletHandle();
    if (!handle) return null;

    const raw = await handle.balance();
    const spendable = toNum(raw.spendableSats);
    const pendingRound = toNum(raw.pendingInRoundSats);
    const pendingExit = toNum(raw.pendingExitSats);
    const pendingLnSend = toNum(raw.pendingLightningSendSats);
    const claimableLnRecv = toNum(raw.claimableLightningReceiveSats);
    const pendingBoard = toNum(raw.pendingBoardSats);

    console.log(
        '[Ark balance] spendable=', spendable,
        'pendingRound=', pendingRound,
        'pendingExit=', pendingExit,
        'pendingLnSend=', pendingLnSend,
        'claimableLnRecv=', claimableLnRecv,
        'pendingBoard=', pendingBoard,
    );

    // Un-boarded on-chain (boarding) balance — funds in bark's onchain (BDK)
    // wallet not yet converted to a VTXO. Use the non-spawning getter so we
    // never force a biometric Keychain read just to render a balance; if the
    // onchain handle isn't up yet, treat as 0. Non-fatal on error.
    let onchainBoardingSats = 0;
    let onchainConfirmingSats = 0;
    try {
        const onchain = getArkOnchainHandle();
        if (onchain) {
            const ob = await onchain.balance();
            onchainBoardingSats = toNum(ob.confirmedSats);
            onchainConfirmingSats = toNum(ob.pendingSats);
        }
    } catch {
        // leave both 0
    }

    return {
        totalSats: spendable,
        spendableSats: spendable,
        pendingInRoundSats: pendingRound,
        pendingExitSats: pendingExit,
        pendingLightningSendSats: pendingLnSend,
        claimableLightningReceiveSats: claimableLnRecv,
        pendingBoardSats: pendingBoard,
        expiredUnrecoverableSats: 0,
        onchainBoardingSats,
        onchainConfirmingSats,
    };
}

/**
 * Subtract sats trapped in expired Spendable VTXOs from the headline.
 *
 * The Bark SDK doesn't auto-evict expired VTXOs from its local DB — until
 * the ASP sweeps them and a sync picks up the eviction, `wallet.balance()`
 * still reports them as part of `spendableSats`. For dust (value < exit
 * fee) this is unrecoverable: the user can't refresh it (uneconomic /
 * below round minimum) and can't unilateral-exit it (exit fee > value),
 * so counting it as spendable produces a phantom balance the user can
 * never actually move.
 *
 * Pass the `all` list from `fetchArkVtxos()` and the height from
 * `fetchChainTipHeight()`. When either is missing this function returns
 * the input summary unchanged (with `expiredUnrecoverableSats: 0`).
 */
export function applyExpiredVtxoFilter(
    summary: ArkBalanceSummary,
    vtxos: ArkVtxoView[] | null | undefined,
    chainTipHeight: number | null | undefined,
): ArkBalanceSummary {
    if (!vtxos || typeof chainTipHeight !== 'number' || chainTipHeight <= 0) {
        return { ...summary, expiredUnrecoverableSats: 0 };
    }
    let expired = 0;
    for (const v of vtxos) {
        if (
            v.expiryHeight > 0 &&
            v.expiryHeight <= chainTipHeight &&
            v.state.toLowerCase() === 'spendable'
        ) {
            expired += v.sats;
        }
    }
    if (expired === 0) {
        return { ...summary, expiredUnrecoverableSats: 0 };
    }
    const adjustedSpendable = Math.max(0, summary.spendableSats - expired);
    console.log(
        '[Ark balance] expired-VTXO filter subtracted',
        expired,
        'sats; spendable',
        summary.spendableSats,
        '→',
        adjustedSpendable,
    );
    return {
        ...summary,
        totalSats: adjustedSpendable,
        spendableSats: adjustedSpendable,
        expiredUnrecoverableSats: expired,
    };
}
