import { getArkWalletHandle } from './walletHandle';
import { barkStateTag, isActiveExit } from './barkState';

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
    const spendable = all.filter((v) => !HIDDEN_STATES.has(v.state.toLowerCase()));
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
