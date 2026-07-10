/**
 * lightningSwap/engine — orchestrates a swap between two Lightning rails.
 *
 * The whole engine is intentionally tiny: it's the registry + a single
 * "destination creates invoice → source pays it" call. All rail-specific
 * logic lives in ./providers; the engine knows nothing about Strike,
 * Coinos, or Ark.
 */

import * as registry from './registry';
import {
    InvoiceCreationFailedError,
    PaymentFailedError,
    PaymentPendingError,
    type LightningSwapProviderId,
    type LightningSwapResult,
    type LightningSwapFeeEstimate,
} from './types';

export type SwapOptions = {
    /** Optional memo passed to both sides — best-effort, see types.ts. */
    memo?: string;
};

/**
 * Execute a swap from `fromId` to `toId` for `amountSats`.
 *
 * Steps:
 *   1. Look up both providers; throw ProviderUnavailableError if either
 *      isn't connected.
 *   2. Destination creates a BOLT11 invoice for `amountSats`.
 *   3. Source pays that invoice.
 *
 * Errors are wrapped as {InvoiceCreationFailed,PaymentFailed}Error so
 * the UI can decide whether the failure was on the receive or send side
 * (different messages, different retry strategies).
 *
 * NOTE: This function does *not* handle same-rail swaps (fromId ===
 * toId). That's a UI-level invariant — SwapSheet's `canProceed` check
 * already disallows it. We don't add a server-side guard here because
 * a "swap" between the same wallet is conceptually nonsense and the
 * extra validation would obscure the engine's tiny shape.
 */
export async function swap(
    fromId: LightningSwapProviderId,
    toId: LightningSwapProviderId,
    amountSats: number,
    opts?: SwapOptions,
): Promise<LightningSwapResult> {
    if (__DEV__) console.log('[lightningSwap] swap start', fromId, '→', toId, 'amount=', amountSats);
    const from = registry.require(fromId);
    const to = registry.require(toId);

    // Step 1: destination creates the invoice.
    let bolt11: string;
    try {
        bolt11 = await to.createInvoice(amountSats, opts?.memo, fromId);
    } catch (err) {
        if (__DEV__) console.log('[lightningSwap] createInvoice failed on', toId, err);
        throw new InvoiceCreationFailedError(toId, err);
    }
    if (!bolt11) {
        throw new InvoiceCreationFailedError(toId, new Error('empty invoice returned'));
    }

    // Step 2: source pays. Stamp the start so destination-confirmation only
    // counts receipts that arrive after this point (not a stale same-amount
    // receive from before the swap).
    const paidAt = Date.now();
    try {
        const result = await from.payInvoice(bolt11, amountSats, opts?.memo);
        if (__DEV__) console.log('[lightningSwap] swap done', fromId, '→', toId, 'id=', result.id);
        return result;
    } catch (err) {
        // A PENDING/unconfirmed payment is NOT a failure — propagate it
        // verbatim so the UI can show a "submitted, do not retry" message
        // instead of a retryable-failure toast. Wrapping it as
        // PaymentFailedError here is what previously made the swap screen
        // invite a retry that re-reserved the source balance.
        if (err instanceof PaymentPendingError) {
            // The SOURCE couldn't self-confirm (e.g. Strike's mobile token
            // 403s on the payment-status endpoint). Before surfacing the
            // scary "submitted, do not retry" modal, ask the DESTINATION
            // whether the money actually arrived — a pure, side-effect-free
            // check. If it confirms, this was a SUCCESS, not a pending
            // limbo. Poll a short window because the HTLC takes a few
            // seconds to land after the source reports PENDING.
            if (to.confirmReceived) {
                // LN routes through a slow rail (Strike) can take well over a
                // minute to land at the destination (observed ~50s live), so
                // the window is generous. `paidAt - 5000` gives a small grace
                // window before the pay call in case a receive registered a
                // beat early.
                const CONFIRM_WINDOW_MS = 120_000;
                const CONFIRM_INTERVAL_MS = 3_000;
                const since = paidAt - 5_000;
                const deadline = Date.now() + CONFIRM_WINDOW_MS;
                while (Date.now() < deadline) {
                    let arrived = false;
                    try {
                        arrived = await to.confirmReceived(bolt11, since);
                    } catch {
                        arrived = false;
                    }
                    if (arrived) {
                        if (__DEV__) console.log('[lightningSwap] source PENDING but destination', toId, 'confirmed receipt — success');
                        // Surface the source's payment id when it carried one
                        // (Strike attaches it to the PaymentPendingError).
                        const pendingId = (err as any)?.paymentId;
                        return { id: typeof pendingId === 'string' && pendingId ? pendingId : '(swap confirmed at destination)' };
                    }
                    await new Promise((r) => setTimeout(r, CONFIRM_INTERVAL_MS));
                }
                if (__DEV__) console.log('[lightningSwap] destination', toId, 'did not confirm within window — surfacing PENDING');
            }
            if (__DEV__) console.log('[lightningSwap] payInvoice PENDING on', fromId, '— propagating, not a failure');
            throw err;
        }
        if (__DEV__) {
            // BarkError variants carry the real bark-side reason in
            // `err.inner.errorMessage`; `err.message` is only the variant tag
            // (e.g. "BarkError.Internal"). Surface the inner detail so swap
            // failures are diagnosable (same pattern as ark/refresh.ts).
            const e = err as any;
            console.log(
                '[lightningSwap] payInvoice failed on', fromId,
                'tag=', e?.tag ?? null,
                'inner=', e?.inner?.errorMessage ?? e?.inner?.message ?? null,
                'message=', e?.message ?? String(err),
            );
        }
        throw new PaymentFailedError(fromId, err);
    }
}

/**
 * Pre-swap fee estimate, asked of the *source* provider (since that's
 * the side paying network fees). Returns null when the source can't
 * quote ahead of time — UI should treat null as "unknown" and render
 * a neutral placeholder until the swap completes.
 */
export async function estimateSwapFee(
    fromId: LightningSwapProviderId,
    amountSats: number,
): Promise<LightningSwapFeeEstimate> {
    const from = registry.require(fromId);
    if (!from.estimateFee) return null;
    try {
        return await from.estimateFee(amountSats);
    } catch (err) {
        // Estimation is best-effort. If it fails we don't want to block
        // the user from swapping — they'll just lose the pre-swap fee
        // preview. Log in dev so the failure is visible during testing.
        if (__DEV__) console.warn('[lightningSwap] estimateFee failed:', err);
        return null;
    }
}
