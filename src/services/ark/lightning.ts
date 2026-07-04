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

/**
 * Read-only enumeration of pending Lightning receives, without driving them
 * forward.
 *
 * Why this exists separately from `tryClaimArkLightningReceives`: that call
 * has a side-effect — it asks the ASP to reveal the preimage and commit the
 * receive into the next round. We need a pure read for the UI's "claiming
 * via round…" indicator: between the moment the counterparty pays the
 * invoice and the moment the resulting VTXO materialises in `allVtxos()`,
 * the SDK's `pendingLightningReceives()` is the one signal that says "the
 * money is here, the VTXO just hasn't arrived yet".
 *
 * Filtering: callers typically only care about entries with `hasHtlcVtxos
 * === true` — an unpaid invoice (both flags false) is just a generated
 * invoice the user is still waiting on, not an in-flight claim, and should
 * not render as a pending capsule. We return everything here and let
 * callers filter, so e.g. a debug screen can still see unpaid invoices.
 *
 * Returns [] on any error (handle missing, ASP flake) — the next sync tick
 * retries automatically and a transient failure shouldn't blank the UI's
 * pending indicator if it was already populated from a prior cycle.
 */
export async function fetchArkPendingLightningReceives(): Promise<ArkLightningReceiveView[]> {
    const handle = getArkWalletHandle();
    if (!handle) return [];

    try {
        const raw = await handle.pendingLightningReceives();
        return raw.map((r) => ({
            paymentHash: r.paymentHash,
            invoice: r.invoice,
            amountSats: Number(r.amountSats),
            hasHtlcVtxos: r.hasHtlcVtxos,
            preimageRevealed: r.preimageRevealed,
        }));
    } catch (err) {
        console.warn('[Ark claim] pendingLightningReceives failed:', err);
        return [];
    }
}

/**
 * Outcome of a cancel attempt on a specific pending Lightning receive.
 *
 * The `ok: false` shape carries a `reason` and a `kind` discriminator that the
 * UI can branch on — the two terminal error cases ("preimage revealed" and
 * "already finished") are user-actionable (the row should stay; the toast
 * explains why) and distinct from a transient ASP/network failure.
 */
export type CancelArkLightningReceiveResult =
    | { ok: true }
    | { ok: false; kind: 'preimage-revealed' | 'already-finished' | 'unknown'; reason: string };

/**
 * Ask bark to cancel a specific pending Lightning receive by its payment hash.
 *
 * SAFETY: this call is non-destructive by construction. Verified against bark
 * 0.1.3 source (bark/src/lightning/receive.rs#cancel_lightning_receive):
 *   - If the preimage has been revealed (sender's payment is in flight and
 *     bark has committed to claim), the call bails with
 *     "cannot cancel: preimage has already been revealed".
 *   - If the receive is already finished (claimed → VTXO), the call bails
 *     with "lightning receive is already finished".
 *   - The server additionally refuses if HTLC-recv VTXOs have already been
 *     granted, regardless of the client check.
 * So the worst case from the user mashing cancel on any row is a toast — no
 * fund loss is possible at the bark layer.
 *
 * Returns a discriminated result rather than throwing so the caller can render
 * an outcome toast without try/catch ceremony at the UI layer.
 */
export async function cancelArkLightningReceive(
    paymentHash: string,
): Promise<CancelArkLightningReceiveResult> {
    const handle = getArkWalletHandle();
    if (!handle) {
        return { ok: false, kind: 'unknown', reason: 'Ark wallet not open' };
    }

    try {
        await handle.cancelLightningReceive(paymentHash);
        return { ok: true };
    } catch (err: any) {
        // bark surfaces both guard errors as anyhow!-style strings on the
        // BarkError.Internal branch. Match on substrings rather than parsing
        // structured error codes — the SDK doesn't expose a discriminator
        // for these specific failures, and the strings are stable in the
        // bark source.
        const msg = err?.message ?? String(err);
        if (/preimage has already been revealed/i.test(msg)) {
            return {
                ok: false,
                kind: 'preimage-revealed',
                reason: 'Payment is already in flight — can\'t cancel.',
            };
        }
        if (/already finished/i.test(msg)) {
            return {
                ok: false,
                kind: 'already-finished',
                reason: 'Receive already settled — nothing to cancel.',
            };
        }
        console.warn('[Ark cancel-ln-recv] failed:', err);
        return {
            ok: false,
            kind: 'unknown',
            reason: msg || 'Cancel failed; try again or wait for the next sync.',
        };
    }
}

/**
 * Read-only fetch of a specific Lightning receive's current state.
 *
 * Returns null when the SDK has no record of the payment hash (e.g. the
 * receive was already cancelled / claimed and pruned). Use the bigint →
 * number boundary conversion convention every other helper here uses.
 *
 * Intended for the confirm-modal subtitle ("X sats, awaiting payment…") on
 * the pending-row tap. Not wired into the 30s sync loop — that's what
 * `fetchArkPendingLightningReceives` is for.
 */
export async function getArkLightningReceiveStatus(
    paymentHash: string,
): Promise<ArkLightningReceiveView | null> {
    const handle = getArkWalletHandle();
    if (!handle) return null;

    try {
        const raw = await handle.lightningReceiveStatus(paymentHash);
        if (!raw) return null;
        return {
            paymentHash: raw.paymentHash,
            invoice: raw.invoice,
            amountSats: Number(raw.amountSats),
            hasHtlcVtxos: raw.hasHtlcVtxos,
            preimageRevealed: raw.preimageRevealed,
        };
    } catch (err) {
        console.warn('[Ark cancel-ln-recv] lightningReceiveStatus failed:', err);
        return null;
    }
}
