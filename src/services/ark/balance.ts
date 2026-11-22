import { getArkWalletHandle, getLastOnchainBalanceSats } from './walletHandle';
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
     */
    onchainBoardingSats: number;
    /** Unconfirmed on-chain boarding sats (still gaining confirmations). */
    onchainConfirmingSats: number;
    /**
     * bark's own `needsRefreshSats` (bark 0.8.0), as it reported it: Spendable
     * capsules it will not send out-of-round, because they are expired or have
     * reached the server's exit-depth limit. bark already leaves these OUT of
     * `spendableSats`; `applyExpiredVtxoFilter` reads this so it does not take
     * them out a second time. Not for display: it includes expired capsules,
     * which have their own field.
     *
     * Optional for persist-compat with summaries stored before bark 0.8.0, and
     * 0 from an older binding, which counted all of these as spendable.
     */
    barkNeedsRefreshSats?: number;
    /**
     * Sats in live (unexpired) capsules that have reached the server's
     * exit-depth limit: still the user's, still refreshable, offboardable and
     * exitable, but not sendable until a refresh. Excluded from the headline.
     * Expired capsules are counted in `expiredUnrecoverableSats` instead.
     *
     * Optional for persist-compat; read it as 0 when missing.
     */
    needsRefreshSats?: number;
    /**
     * Sats locked in an outgoing Ark payment or an offboard that has not
     * finished (bark 0.8.0 `pendingArkoorSendSats` + `pendingOffboardSats`).
     * Earlier bark reported these in no field at all. Informational.
     */
    pendingSendSats?: number;
};

function toNum(b: bigint): number {
    return Number(b);
}

/** bigint → number for a balance field an older binding may not have. */
function optNum(b: bigint | undefined | null): number {
    return typeof b === 'bigint' ? Number(b) : 0;
}

/**
 * Has this capsule reached the server's exit-depth limit?
 *
 * Mirrors the depth half of bark 0.8.1 `WalletVtxo::needs_refresh`
 * (`exit_depth >= max_vtxo_exit_depth`). An unknown limit or depth is "no",
 * the same as bark with no limit.
 */
function atExitDepthLimit(exitDepth: number | undefined, maxExitDepth: number | null | undefined): boolean {
    if (typeof maxExitDepth !== 'number' || !(maxExitDepth > 0)) return false;
    if (typeof exitDepth !== 'number' || !Number.isFinite(exitDepth)) return false;
    return exitDepth >= maxExitDepth;
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
    // bark 0.8.0 buckets. Read defensively: a test double or an older binding
    // without them gives 0, which is how those versions behaved (they counted
    // needs-refresh capsules as spendable and pending sends nowhere).
    const barkNeedsRefresh = optNum((raw as { needsRefreshSats?: bigint }).needsRefreshSats);
    const pendingSend =
        optNum((raw as { pendingArkoorSendSats?: bigint }).pendingArkoorSendSats) +
        optNum((raw as { pendingOffboardSats?: bigint }).pendingOffboardSats);

    console.log(
        '[Ark balance] spendable=', spendable,
        'needsRefresh=', barkNeedsRefresh,
        'pendingRound=', pendingRound,
        'pendingExit=', pendingExit,
        'pendingLnSend=', pendingLnSend,
        'pendingSend=', pendingSend,
        'claimableLnRecv=', claimableLnRecv,
        'pendingBoard=', pendingBoard,
    );

    // Un-boarded on-chain (boarding) balance — funds in bark's onchain (BDK)
    // wallet not yet converted to a VTXO. Read the value syncArkWallet cached
    // right after its onchain.sync() (setLastOnchainBalanceSats): a direct
    // onchain.balance() call here races syncArkWallet's concurrent sync/board
    // ops on the same UniFFI handle and intermittently returns 0, which hid
    // the boarding bucket from the UI. 0 until the first sync populates it.
    const { confirmedSats: onchainBoardingSats, pendingSats: onchainConfirmingSats } =
        getLastOnchainBalanceSats();

    if (onchainBoardingSats > 0 || onchainConfirmingSats > 0) {
        console.log('[Ark balance] onchainBoarding(confirmed)=', onchainBoardingSats, 'onchainConfirming=', onchainConfirmingSats);
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
        barkNeedsRefreshSats: barkNeedsRefresh,
        // Until the filter below classifies capsules, bark's figure is the
        // best available (it also counts expired capsules).
        needsRefreshSats: barkNeedsRefresh,
        pendingSendSats: pendingSend,
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
 *
 * ALSO subtracts actively-EXITING VTXOs (see `ArkVtxoView.exiting`): bark
 * reports a VTXO as Spendable all the way until its unilateral-exit leaf tx
 * confirms on-chain, so without this the balance (and swap "Max") offers
 * coins that are mid-exit — spending them cooperatively would race the
 * user's own exit inside the fraud window. Exiting sats move from
 * `spendableSats` into `pendingExitSats` (the SDK's own pendingExitSats
 * reads 0 during broadcast — same quirk as pendingExitsTotalSats()). The
 * exiting subtraction only needs the vtxo list, not the chain tip.
 *
 * AND subtracts VTXOs the Ark server has said are already spent (see
 * `ArkVtxoView.serverSpent`). bark keeps counting them as Spendable because
 * it never asks the server, so without this the headline, swap "Max" and the
 * swap balance check all offer sats that no longer exist. They are dropped,
 * not moved to another bucket: nothing on this wallet will pay them out.
 *
 * BARK 0.8.0 MOVED PART OF THIS INTO THE SDK
 *
 * Since bark 0.8.0, `spendableSats` already leaves out every Spendable capsule
 * that `WalletVtxo::needs_refresh` flags: `expiry_height <= tip` or
 * `exit_depth >= max_vtxo_exit_depth`. Those sats sit in `needsRefreshSats`
 * (carried here as `barkNeedsRefreshSats`). Subtracting expired capsules again
 * would take them off twice and drive the headline toward 0, and so would
 * subtracting a server-spent or exiting capsule that bark had already left
 * out for being expired or too deep.
 *
 * So each capsule is classified the way bark does it (same `<=` on the tip,
 * same `>=` on the depth limit, which comes in as `maxExitDepth`):
 *   - needs-refresh capsules are NOT subtracted, since bark left them out,
 *     except for any amount bark has not yet left out (`skew` below);
 *   - server-spent and exiting capsules are subtracted only when bark still
 *     counts them, i.e. when they do not need a refresh.
 *
 * `skew` covers bark judging expiry against a tip one block behind ours: a
 * capsule we see as expired that bark still counts. It is
 * max(0, what we classify as needs-refresh minus what bark reported). An older
 * binding reports no `needsRefreshSats`, so the skew is then every
 * needs-refresh capsule, which reproduces the pre-0.8 subtraction exactly.
 * The other direction (bark one block ahead) can under-report for a block;
 * that is the safe direction, since it never offers sats that are not there.
 *
 * `maxExitDepth` is `ArkInfo.maxVtxoExitDepth` (store: `arkMaxVtxoExitDepth`).
 * Unknown means "no depth limit", which can only under-report.
 */
export function applyExpiredVtxoFilter(
    summary: ArkBalanceSummary,
    vtxos: ArkVtxoView[] | null | undefined,
    chainTipHeight: number | null | undefined,
    maxExitDepth?: number | null,
): ArkBalanceSummary {
    if (!vtxos) {
        return { ...summary, expiredUnrecoverableSats: 0 };
    }
    const tipKnown = typeof chainTipHeight === 'number' && chainTipHeight > 0;
    const barkNeedsRefresh = Math.max(0, summary.barkNeedsRefreshSats ?? 0);

    // What bark left out of spendableSats, as we classify it.
    let needsRefreshAll = 0;
    // Live capsules at the depth limit (not expired, not server-spent): the
    // "needs a refresh before it can be sent" figure the UI shows.
    let depthLimitedLive = 0;
    // Expired capsules the user still holds (the UI's "expired" figure).
    let expired = 0;
    // Subtracted below, only when bark still counts them.
    let serverSpentCounted = 0;
    let exitingCounted = 0;
    // Every live exiting capsule, for pendingExitSats.
    let exitingAll = 0;

    for (const v of vtxos) {
        if (v.state.toLowerCase() !== 'spendable') {
            // A forced-exit capsule the app locked in bark (forcedExitLock.ts)
            // reads Locked, so bark already leaves it out of spendableSats and
            // nothing is subtracted; it still belongs in the pending-exit
            // figure, or its sats would simply vanish from every total.
            if (v.exiting && v.state.toLowerCase() === 'locked') exitingAll += v.sats;
            continue;
        }
        const isExpired =
            tipKnown &&
            v.expiryHeight > 0 &&
            v.expiryHeight <= (chainTipHeight as number);
        const atDepthLimit = atExitDepthLimit(v.exitDepth, maxExitDepth);
        const needsRefresh = isExpired || atDepthLimit;

        if (needsRefresh) needsRefreshAll += v.sats;
        if (isExpired && !v.serverSpent) expired += v.sats;
        if (atDepthLimit && !isExpired && !v.serverSpent) depthLimitedLive += v.sats;

        if (v.serverSpent) {
            // A capsule the server says is gone is neither expired dust the
            // user still holds nor an exit that will pay out.
            if (!needsRefresh) serverSpentCounted += v.sats;
        } else if (v.exiting && !isExpired) {
            // Not double-counted: expired-and-exiting counts as expired.
            exitingAll += v.sats;
            if (!needsRefresh) exitingCounted += v.sats;
        }
    }

    const skew = Math.max(0, needsRefreshAll - barkNeedsRefresh);
    // With the vtxos in hand, the classification replaces bark's raw figure
    // for display. Without a depth limit we cannot tell depth-limited capsules
    // apart, so fall back to whatever bark reported beyond the expired ones.
    const needsRefreshSats =
        typeof maxExitDepth === 'number' && maxExitDepth > 0
            ? depthLimitedLive
            : Math.max(0, barkNeedsRefresh - needsRefreshAll);
    const subtract = serverSpentCounted + exitingCounted + skew;

    if (subtract === 0 && expired === 0 && exitingAll === 0) {
        return { ...summary, expiredUnrecoverableSats: 0, needsRefreshSats };
    }
    const adjustedSpendable = Math.max(0, summary.spendableSats - subtract);
    console.log(
        '[Ark balance] filter: expired', expired,
        '(bark needs-refresh', barkNeedsRefresh, ', skew', skew, ')',
        '- exiting', exitingCounted, '- server-spent', serverSpentCounted,
        '; spendable', summary.spendableSats, '→', adjustedSpendable,
    );
    return {
        ...summary,
        totalSats: adjustedSpendable,
        spendableSats: adjustedSpendable,
        expiredUnrecoverableSats: expired,
        pendingExitSats: summary.pendingExitSats + exitingAll,
        needsRefreshSats,
    };
}
