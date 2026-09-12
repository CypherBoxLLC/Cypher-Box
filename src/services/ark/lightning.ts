import bolt11 from 'bolt11';

import { getArkWalletHandle } from './walletHandle';
import { looksLikeConnectionLoss } from './networkFault';

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
    /**
     * Raw SDK progress string:
     * "awaiting-payment" | "htlcs-ready" | "preimage-revealed" | "delivering" | "settled"
     */
    state: string;
    /** Derived: money is parked at the ASP (state "htlcs-ready" or later). */
    hasHtlcVtxos: boolean;
    /** Derived: preimage revealed (state "preimage-revealed" or later). */
    preimageRevealed: boolean;
};

/**
 * Receive progress in order.
 *
 * bark core 0.6.1 (SDK 0.16.1) REPLACED the boolean pair `hasHtlcVtxos` /
 * `preimageRevealed` on `LightningReceive` with this single `state` string.
 * Reading the old fields off the new record yields `undefined`, which is
 * falsy, so every consumer silently decided nothing was ever in flight:
 * in-flight receives vanished from the UI and the swap settlement check
 * never fired. We keep the two booleans on our own view type and DERIVE
 * them here, so call sites stay unchanged and there is exactly one place
 * that knows the SDK's encoding.
 */
const RECEIVE_STATE_ORDER = [
    'awaiting-payment',
    'htlcs-ready',
    'preimage-revealed',
    'delivering',
    'settled',
] as const;

type RawLightningReceive = {
    paymentHash: string;
    invoice: string;
    amountSats: bigint;
    state: string;
};

/**
 * Map an SDK `LightningReceive` onto our view.
 *
 * Unknown state: we rank it as "awaiting-payment", i.e. NOT in flight, and
 * warn. That direction is deliberate. Inventing "the money is here" from a
 * string we do not recognise is the worse failure for a wallet, and the warn
 * makes a future SDK rename loud instead of silent, which is precisely what
 * went wrong the last time this struct changed.
 */
function toReceiveView(r: RawLightningReceive): ArkLightningReceiveView {
    const rank = (RECEIVE_STATE_ORDER as readonly string[]).indexOf(r.state);
    if (rank < 0) {
        console.warn(
            '[Ark LN recv] unrecognised receive state:', r.state,
            '- treating as awaiting-payment. The SDK struct may have changed again.',
        );
    }
    return {
        paymentHash: r.paymentHash,
        invoice: r.invoice,
        amountSats: Number(r.amountSats),
        state: r.state,
        hasHtlcVtxos: rank >= 1,
        preimageRevealed: rank >= 2,
    };
}


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
        // DEV only. The claim reports "All N lightning receive claim(s) failed"
        // with no cause attached (BarkError carries only message/tag/stack, the
        // per-receive reason is discarded at the FFI boundary), and the receive
        // is gone by the time anything can be probed after the fact.
        //
        // `state` is the field that settles what actually happened, and it cost
        // most of a night's debugging to learn that: "awaiting-payment" means
        // nothing ever arrived and the claim failure is noise, while
        // "htlcs-ready" or later means the money is there and the claim is
        // genuinely broken. Those two look identical in the error.
        //
        // Costs an extra SDK call per sync tick, hence __DEV__ only.
        if (__DEV__) try {
            const pendingBefore = await handle.pendingLightningReceives();
            console.log(
                '[Ark claim] PRE-CLAIM pending receives:',
                pendingBefore.length,
                JSON.stringify(pendingBefore.map((r: { paymentHash: string; amountSats: bigint; state: string }) => ({
                    hash: r.paymentHash.slice(0, 12),
                    sats: Number(r.amountSats),
                    state: r.state,
                }))),
            );
        } catch (probeErr: any) {
            console.warn('[Ark claim] PRE-CLAIM probe failed:', probeErr?.message ?? probeErr);
        }

        const raw = await handle.tryClaimAllLightningReceives(false);
        console.log(
            '[Ark claim] returned',
            raw.length,
            'receives:',
            raw.map(
                (r) =>
                    `${Number(r.amountSats)}sats state=${r.state} hash=${r.paymentHash.slice(0, 12)}…`,
            ),
        );
        return raw.map((r) => toReceiveView(r));
    } catch (err) {
        // Intermittent ASP unavailability or network flake — not worth
        // surfacing to the user. The 30s sync will retry. Logged in detail
        // for now because diagnosing the missing-capsule bug needs to know
        // whether failures here are cause or symptom.
        const e = err as { tag?: string; message?: string; inner?: { errorMessage?: string; message?: string } };
        console.warn(
            '[Ark claim] tryClaimAllLightningReceives failed:',
            'tag=', e?.tag ?? 'n/a',
            '| message=', e?.message ?? String(err),
            '| inner=', e?.inner?.errorMessage ?? e?.inner?.message ?? 'n/a',
        );
        // DEV only. The line above reports `inner= n/a` for claim failures,
        // because BarkError puts nothing where that destructure reaches. Own
        // properties are exactly ["message","tag","stack"] and the message is
        // only the aggregate sentence, so the per-receive reason never crosses
        // the binding at all. Keep the dump so the next person can confirm that
        // for themselves rather than re-deriving it, and so it surfaces
        // immediately if a future SDK starts attaching a cause.
        if (__DEV__) try {
            const own = Object.getOwnPropertyNames(err as object);
            console.warn(
                '[Ark claim] RAW ERROR keys=', JSON.stringify(own),
                '| full=', JSON.stringify(err, own),
                '| proto=', Object.prototype.toString.call(err),
            );
        } catch (dumpErr) {
            console.warn('[Ark claim] RAW ERROR could not be serialised:', String(dumpErr));
        }
        return [];
    }
}

/**
 * Drive any pending OUTGOING Lightning sends to a terminal state.
 *
 * bark 0.11.3's crash-safe send model expects the client to keep polling
 * `checkLightningPayment` after dispatching with wait=false; our send flow
 * only polls while its screen is up (~2 min). Any send abandoned past that
 * window (slow route, user went Home, app killed) sits in `pendingLnSend`
 * and locks its sats until the HTLC's block-height expiry, HOURS later.
 * Observed live: 1240 sats locked across an evening of slow-swap attempts,
 * spendable down to 27. Polling from the sync cycle drives each stuck send
 * to settle or revoke (refund) as soon as the server allows, instead of
 * waiting out the clock.
 *
 * wait=false: enumerate-and-poke, never block the sync cycle on a route.
 */
export async function driveArkPendingLightningSends(): Promise<void> {
    const handle = getArkWalletHandle();
    if (!handle) return;
    let pending;
    try {
        pending = await handle.pendingLightningSends();
    } catch (err) {
        console.warn('[Ark sends] pendingLightningSends failed:', (err as Error)?.message ?? err);
        return;
    }
    if (!pending?.length) return;
    console.log('[Ark sends]', pending.length, 'pending lightning send(s); driving via checkLightningPayment');
    for (const p of pending) {
        try {
            const hashTag = bolt11.decode(p.invoice).tags.find((t) => t.tagName === 'payment_hash');
            const paymentHash = typeof hashTag?.data === 'string' ? hashTag.data : null;
            if (!paymentHash) {
                console.warn('[Ark sends] no payment_hash decodable for a pending send, skipping');
                continue;
            }
            const status = await handle.checkLightningPayment(paymentHash, false);
            console.log(
                '[Ark sends]', Number(p.amountSats), 'sats hash=', paymentHash.slice(0, 12),
                'status=', (status as { tag?: string })?.tag ?? 'unknown',
                'failedRevocation=', p.hasFailedRevocation,
            );
        } catch (err) {
            console.warn('[Ark sends] checkLightningPayment failed (continuing):', (err as Error)?.message ?? err);
        }
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
        return raw.map((r) => toReceiveView(r));
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
                reason: 'Payment is already in flight, so it can\'t be cancelled.',
            };
        }
        if (/already finished/i.test(msg)) {
            return {
                ok: false,
                kind: 'already-finished',
                reason: 'Receive already settled, so there is nothing to cancel.',
            };
        }
        // A dropped connection is not a refusal. Without this branch anything
        // the two guards above do not match fell through to `kind: 'unknown'`
        // with the raw text as its reason, which reads to the user as a
        // definite "it did not happen" for an outcome we cannot know: the ASP
        // may have accepted the cancellation before the line died.
        //
        // Bounded, unlike the send paths: the UI leaves the row in place on
        // failure, so the next 30s sync corrects the display either way. The
        // fix is about not asserting something we cannot know.
        if (looksLikeConnectionLoss(err)) {
            return {
                ok: false,
                kind: 'unknown',
                reason: 'The connection dropped, so this may or may not have been cancelled. Check again in a moment.',
            };
        }
        console.warn('[Ark cancel-ln-recv] failed:', err);
        return {
            ok: false,
            kind: 'unknown',
            // Prefer the written sentence over bark's internal text. `msg ||`
            // had it backwards: it showed the SDK's own vocabulary, unbounded
            // in length and written for developers, and the human fallback only
            // appeared when the SDK gave us nothing at all.
            reason: 'Cancel failed; try again or wait for the next sync.',
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
        // Renamed in SDK 0.16.1: lightningReceiveStatus -> lightningReceiveState.
        // The old name no longer exists on the handle, so this threw a
        // "not a function" TypeError on every call and the status probe
        // always returned null through the catch below.
        const raw = await handle.lightningReceiveState(paymentHash);
        if (!raw) return null;
        return toReceiveView(raw);
    } catch (err) {
        console.warn('[Ark cancel-ln-recv] lightningReceiveState failed:', err);
        return null;
    }
}
