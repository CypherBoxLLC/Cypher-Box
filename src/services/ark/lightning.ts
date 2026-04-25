import { getArkWalletHandle } from './walletHandle';

/**
 * Plain-JS view of a pending Lightning receive.
 *
 * Mirrors the SDK's `LightningReceive` struct but flattens bigint → number for
 * the UI. Returned by `tryClaimArkLightningReceives()` when a claim succeeds
 * so callers can toast / log which payments just materialized into VTXOs.
 */
export type ArkLightningReceiveView = {
    paymentHash: string;
    invoice: string;
    amountSats: number;
    hasHtlcVtxos: boolean;
    preimageRevealed: boolean;
};

/**
 * Drive forward any pending Lightning receives and materialize them into
 * HTLC-recv VTXOs in the local SQLite datadir.
 *
 * Why this exists: an Ark Lightning receive is a two-phase operation.
 *   1. User generates a BOLT11 invoice → ASP parks the incoming HTLC.
 *   2. ASP signals "claimable"; balance reflects `claimableLightningReceiveSats`.
 *   3. **Wallet must reveal the preimage + claim the HTLC into a VTXO.**
 *
 * Step 3 is what this call does. Without it, the payment is visible in the
 * balance summary but NOT in `allVtxos()` — which is why the capsules tab
 * stays empty after a successful receive. The SDK does NOT run this
 * automatically from a background daemon on mobile; the app has to drive it.
 *
 * Uses `wait: false` (fire-and-forget). The claim attempt kicks off on the
 * ASP side and finalizes in the background. The next sync cycle's
 * `fetchArkVtxos()` call will pick up the newly-materialized VTXO. Worst-case
 * user-visible latency is one poll interval (~30s) before the capsule
 * appears. Setting `wait: true` would block here for a full round duration
 * (tens of seconds on signet), which we don't want in the passive sync path.
 *
 * Errors are swallowed — a failed claim attempt is advisory, not fatal, and
 * shouldn't prevent the accompanying balance/vtxo fetches from completing.
 * The next sync cycle retries automatically.
 *
 * Returns the list of receives the SDK reports as claimed this call (may be
 * empty even on success if nothing was pending). Returns [] on any error.
 */
export async function tryClaimArkLightningReceives(): Promise<ArkLightningReceiveView[]> {
    const handle = getArkWalletHandle();
    if (!handle) return [];

    try {
        console.log('[Ark claim] calling tryClaimAllLightningReceives(wait=false)…');
        // wait=false: fire the claim attempt and return immediately. The
        // ASP finalizes the claim in the background and the next sync
        // cycle's fetchArkVtxos() picks up the materialized VTXO. We
        // deliberately do NOT block here — with wait=true the call can
        // hang indefinitely if the wallet is in a bad internal state
        // (e.g. stuck mid-round), which deadlocks the whole 30s sync via
        // its inFlight guard. Observed live: one stuck wait=true call
        // silenced every subsequent cycle until app restart.
        const raw = await handle.tryClaimAllLightningReceives(false);
        console.log(
            '[Ark claim] returned',
            raw.length,
            'receives:',
            raw.map(
                (r) =>
                    `${Number(r.amountSats)}sats hasHtlc=${r.hasHtlcVtxos} preimageRevealed=${r.preimageRevealed} hash=${r.paymentHash.slice(0, 12)}…`,
            ),
        );
        return raw.map((r) => ({
            paymentHash: r.paymentHash,
            invoice: r.invoice,
            amountSats: Number(r.amountSats),
            hasHtlcVtxos: r.hasHtlcVtxos,
            preimageRevealed: r.preimageRevealed,
        }));
    } catch (err) {
        // Intermittent ASP unavailability or network flake — not worth
        // surfacing to the user. The 30s sync will retry. Logged in detail
        // for now because diagnosing the missing-capsule bug needs to know
        // whether failures here are cause or symptom.
        console.warn('[Ark claim] tryClaimAllLightningReceives failed:', err);
        return [];
    }
}
