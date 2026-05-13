import { getArkWalletHandle } from './walletHandle';

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
 * Spent is hidden (historical only — already consumed by a round or
 * send). Any unknown state is shown by default rather than hidden,
 * so future SDK additions don't silently disappear capsules.
 */
const HIDDEN_STATES = new Set(['spent']);

export async function fetchArkVtxos(): Promise<ArkVtxoList | null> {
    const handle = getArkWalletHandle();
    if (!handle) {
        console.log('[Ark vtxos] handle not initialized — returning null');
        return null;
    }

    const raw = await handle.allVtxos();
    const all: ArkVtxoView[] = raw.map((v) => ({
        id: v.id,
        sats: Number(v.amountSats),
        expiryHeight: v.expiryHeight,
        kind: v.kind,
        state: v.state,
    }));

    // Diagnostic: surface every VTXO state + kind we see from the SDK, so
    // if spendable is still empty we can see what state Lightning-received
    // VTXOs are actually landing in. Cheap log, keep on until the capsule
    // flow is solid.
    //
    // Emit one log line per VTXO — packing the array into a single
    // console.log makes oslog truncate after the first element, which
    // hides most of the state we care about.
    console.log('[Ark vtxos] allVtxos() returned', all.length, 'total');
    all.forEach((v, i) => {
        console.log(`[Ark vtxos] #${i} kind=${v.kind} state=${v.state} sats=${v.sats} exp=${v.expiryHeight} id=${v.id}`);
    });

    const spendable = all.filter((v) => !HIDDEN_STATES.has(v.state.toLowerCase()));
    console.log('[Ark vtxos] visible (non-spent/locked):', spendable.length);

    return {
        all,
        spendable,
    };
}
