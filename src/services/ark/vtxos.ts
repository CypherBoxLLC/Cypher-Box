import { getArkWalletHandle } from './walletHandle';
import { barkStateTag, isActiveExit } from './barkState';
import useAuthStore from '@Cypher/stores/authStore';
import { fetchArkBalance } from './balance';
import {
    isPermanentlyGone,
    parseNotSpendableError,
    type NotSpendableVtxo,
} from './vtxoSpendState';

/**
 * Plain-JS view of one VTXO, suitable for the UI.
 *
 * The SDK's Vtxo struct uses bigint for amount; everything else is already
 * plain. We flatten to numbers so components can do arithmetic and render
 * without worrying about bigint semantics.
 */
export type ArkVtxoView = {
    id: string;
    sats: number;
    /** Block height the VTXO expires at (0 if unknown — e.g. arkoor VTXOs). */
    expiryHeight: number;
    /** "board" | "round" | "arkoor" — informational, drives future per-kind UI. */
    kind: string;
    /**
     * Genesis chain length, the field the exit-runway rules turn on. Carried
     * here so the refresh floor can be depth-aware without re-reading the SDK:
     * a deeper tree needs more blocks to confirm before its CSV delta starts,
     * so it must be left alone earlier. Optional for persist-compat with rows
     * written before this field, and absent for anything the SDK reports
     * without one; callers fall back to the flat floor when it is missing.
     */
    exitDepth?: number;
    /** "spendable" | "spent" | "locked" — we filter to spendable for the capsule UI. */
    state: string;
    /**
     * True when this VTXO has an ACTIVE unilateral-exit record in bark's exit
     * subsystem (state Processing… or claimable). bark keeps reporting such a
     * VTXO as `Spendable` in allVtxos()/balance() until the exit's leaf tx
     * confirms on-chain, but spending it cooperatively mid-exit races the
     * user's own exit (fraud-window dispute), so the app must treat it as
     * locked: excluded from spendable balance (applyExpiredVtxoFilter),
     * unselectable and unrefreshable in the capsule UI.
     * Optional for persist-compat with rows written before this field.
     */
    exiting?: boolean;
};

export type ArkVtxoList = {
    spendable: ArkVtxoView[];
    /** All VTXOs incl. spent/locked — kept for future history/debugging views. */
    all: ArkVtxoView[];
};

/**
 * Is this VTXO committed to an in-flight round (refresh, send, board, offboard,
 * lightning receive)?
 *
 * READ THIS BEFORE COMPARING `state` TO 'locked' ANYWHERE.
 *
 * `Locked` alone stopped being the answer at bark 0.6.0: a DELEGATED refresh
 * leaves the VTXO `Spendable` for the whole round, so every surface that tested
 * `state === 'locked'` to mean "refreshing" silently reported nothing in flight.
 * That regression has now been fixed three separate times in three separate
 * places (the refresh UI in 778e41d, then the home banners, then this sweep),
 * which is why the predicate lives here instead of being re-derived per screen.
 *
 * `Locked` is still real: bark sets it for the pre-action subsystems (round,
 * offboard, board, lightning receive). So this is a UNION, not a replacement.
 * The client-tracked ids come from `arkRefreshingVtxoIds` in authStore, which
 * the refresh paths maintain across the delegated round.
 */
export function isVtxoMidRound(
    v: Pick<ArkVtxoView, 'id' | 'state'>,
    refreshingIds: readonly string[] | ReadonlySet<string>,
): boolean {
    if (v.state.toLowerCase() === 'locked') return true;
    return refreshingIds instanceof Set
        ? refreshingIds.has(v.id)
        : (refreshingIds as readonly string[]).includes(v.id);
}

/**
 * Count and sats of everything mid-round. The headline balance excludes these,
 * so a surface that under-reports here shows the user a balance drop with no
 * explanation.
 */
export function sumMidRoundVtxos(
    vtxos: readonly ArkVtxoView[] | null | undefined,
    refreshingIds: readonly string[] | ReadonlySet<string>,
): { count: number; sats: number } {
    let count = 0;
    let sats = 0;
    for (const v of vtxos ?? []) {
        if (!isVtxoMidRound(v, refreshingIds)) continue;
        count++;
        sats += v.sats;
    }
    return { count, sats };
}

/**
 * Fetch VTXO list from the local SQLite datadir.
 *
 * Returns null if the wallet handle isn't initialized. For a freshly-created
 * wallet with no funds, returns { spendable: [], all: [] } — not null.
 */
/**
 * States the capsules tab should render.
 *
 * IMPORTANT — casing: the SDK's docstring lies. It says
 * "spendable" | "spent" | "locked" (lowercase), but observed wire values
 * are PascalCase ("Spendable", "Spent", "Locked", "ServerHtlcRecv", …).
 * An earlier iteration of this filter matched lowercase and silently
 * passed everything, which made one receive appear as two capsules
 * (the current Pubkey VTXO plus its already-Spent HTLC-recv ancestor).
 *
 * We compare case-insensitively to be resilient to either casing, and
 * show both Spendable and Locked so mid-round / pending-finalization
 * VTXOs don't vanish from the UI for ~10–30s while a round completes.
 * Spent and Exited are hidden (both terminal): Spent was consumed by a
 * round or send; Exited means a completed unilateral exit whose value is
 * now an on-chain output, tracked by the exit subsystem, not a spendable
 * capsule. Without hiding Exited, a fully-exited VTXO lingers forever as
 * a stale "Refreshing" capsule (bark keeps returning it from allVtxos()
 * as state=Exited, never Spent). Any unknown state is shown by default
 * rather than hidden, so future SDK additions don't silently disappear.
 */
const HIDDEN_STATES = new Set(['spent', 'exited']);

export async function fetchArkVtxos(): Promise<ArkVtxoList | null> {
    const handle = getArkWalletHandle();
    if (!handle) {
        console.log('[Ark vtxos] handle not initialized — returning null');
        return null;
    }

    const raw = await handle.allVtxos();

    // Cross-reference the exit subsystem: bark reports actively-exiting
    // VTXOs as Spendable until the exit leaf confirms, so without this the
    // UI/balance offers coins that are mid-exit (see `exiting` docs above).
    // Best-effort: an empty set on failure just means no lock this tick.
    let activeExitIds = new Set<string>();
    try {
        const exits = await handle.getExitVtxos();
        activeExitIds = new Set(
            (exits ?? [])
                // bark 0.6.1: exit `state` is a tagged-enum object now; use the
                // shared not-terminal liveness check (Start/Processing/
                // AwaitingDelta/Claimable/ClaimInProgress = active).
                .filter((e: any) => isActiveExit(e))
                .map((e: any) => String(e.vtxoId)),
        );
    } catch { /* handle busy or exit subsystem unavailable — no lock */ }

    const all: ArkVtxoView[] = raw.map((v) => ({
        id: v.id,
        sats: Number(v.amountSats),
        expiryHeight: v.expiryHeight,
        kind: v.kind,
        exitDepth: Number(v.exitDepth ?? 0) || undefined,
        // bark 0.6.1: `state` is a tagged-enum object; flatten to its variant
        // string so ArkVtxoView.state stays a plain string and every
        // downstream `.toLowerCase()` comparison keeps working.
        state: barkStateTag(v.state),
        exiting: activeExitIds.has(v.id),
    }));

    // Diagnostic: surface every VTXO state + kind we see from the SDK, so
    // if spendable is still empty we can see what state Lightning-received
    // VTXOs are actually landing in. Cheap log, keep on until the capsule
    // flow is solid.
    //
    // Drop anything the SERVER has already told us is spent.
    //
    // bark decides spendability from its local DB and `sync()` never
    // revalidates that against the server, so a VTXO spent by another holder
    // of the same seed (or resurrected by restoring a stale `.cbark`) stays
    // `Spendable` here forever. The SDK offers no way to drop it: only
    // `importVtxo`, which adds. This denylist is the only place that
    // correction can stick, and it is applied at the single chokepoint every
    // consumer reads through, so balance, capsules, the sweep and the swap
    // preflight all agree.
    //
    // Populated only from a failed spend reporting state `spent`. See
    // ./vtxoSpendState.ts for why the other not-spendable states are excluded.
    const serverSpent = new Set(
        (useAuthStore.getState().arkServerSpentVtxoIds ?? []).map((id) => id.toLowerCase()),
    );
    const spendable = all.filter(
        (v) => !HIDDEN_STATES.has(v.state.toLowerCase()) && !serverSpent.has(v.id.toLowerCase()),
    );
    if (__DEV__) {
        // Dev-only, and only for ACTIVE (non-spent) VTXOs. Dumping every VTXO
        // (178+ on a busy wallet, almost all spent history) on every fetch
        // floods the JS/debugger bridge (2500+ messages discarded) and, with
        // the inspector attached, adds enough latency to starve user-initiated
        // SDK calls on the same JS thread — that's what left "Estimating fee…"
        // hung for ~2 minutes. This block ran in production too (it was
        // ungated), so gating it also trims real prod overhead.
        console.log(
            '[Ark vtxos] allVtxos() returned', all.length, 'total;',
            spendable.length, 'visible (non-spent/locked)',
        );
        for (const v of all) {
            if (v.state.toLowerCase() === 'spent') continue;
            console.log(`[Ark vtxos] active kind=${v.kind} state=${v.state} sats=${v.sats} exp=${v.expiryHeight} id=${v.id}`);
        }
    }

    return {
        all,
        spendable,
    };
}

/**
 * Record a server-confirmed-spent VTXO and correct the wallet's view of itself.
 *
 * Call this from EVERY path that can spend or refresh a VTXO. The server is the
 * only authority on spentness and it only tells us when we try to use one, so a
 * failed spend is the single moment this correction is available. Dropping it
 * on the floor is how a phantom balance survives for days.
 *
 * Returns the parsed classification so the caller can show the right message,
 * or null when the error was something else entirely.
 *
 * Only state `spent` is recorded. The transient states must not be, or a live
 * capsule would be deleted from the balance. See ./vtxoSpendState.ts.
 */
export async function recordServerSpentFromError(
    err: unknown,
): Promise<NotSpendableVtxo | null> {
    const parsed = parseNotSpendableError(err);
    if (!parsed) return null;

    if (!isPermanentlyGone(parsed) || !parsed.vtxoId) return parsed;

    console.warn(
        '[Ark vtxos] server reports vtxo spent, pruning from spendable set:',
        parsed.vtxoId,
    );
    useAuthStore.getState().addArkServerSpentVtxoIds([parsed.vtxoId]);

    // Re-derive the list and balance now, so the phantom leaves the UI with the
    // failure that revealed it rather than lingering until the next tick.
    // Best-effort: the denylist is already persisted, so a failure here only
    // delays the correction to the next fetch, it does not lose it.
    try {
        const list = await fetchArkVtxos();
        if (list) useAuthStore.getState().setArkVtxos(list.spendable);
        await fetchArkBalance();
    } catch (e: any) {
        console.warn('[Ark vtxos] post-prune refresh failed:', e?.message ?? e);
    }

    return parsed;
}
