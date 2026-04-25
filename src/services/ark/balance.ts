import { getArkWalletHandle } from './walletHandle';

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
    /** Total sats (spendable + all pending buckets). This is what the UI shows. */
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

    // IMPORTANT: `pendingInRoundSats` is NOT added to the headline total.
    //
    // Quirk on Second.tech's private mainnet: the SDK sums BOTH sides of a
    // pending round (e.g. 10,000 sats input VTXO + 9,911 expected output
    // = 19,911 in this field) — so naively adding it to `spendable` would
    // render ~2× the user's real balance during a refresh.
    //
    // We also don't try to derive an "in-round amount" from this field
    // alone (e.g. halving it) because the Locked output VTXO is already
    // materialised in the SDK's allVtxos() list with its exact post-fee
    // amount. The accurate fix for the "balance drops to 0 mid-refresh"
    // bug lives in `useArkSync`, which composes this bucket with the VTXO
    // list — see comments there. This function stays pure and just
    // reports what the SDK says.
    return {
        totalSats:
            spendable +
            pendingExit +
            pendingLnSend +
            claimableLnRecv +
            pendingBoard,
        spendableSats: spendable,
        pendingInRoundSats: pendingRound,
        pendingExitSats: pendingExit,
        pendingLightningSendSats: pendingLnSend,
        claimableLightningReceiveSats: claimableLnRecv,
        pendingBoardSats: pendingBoard,
    };
}
