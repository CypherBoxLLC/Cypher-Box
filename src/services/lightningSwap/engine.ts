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
        bolt11 = await to.createInvoice(amountSats, opts?.memo);
    } catch (err) {
        if (__DEV__) console.log('[lightningSwap] createInvoice failed on', toId, err);
        throw new InvoiceCreationFailedError(toId, err);
    }
    if (!bolt11) {
        throw new InvoiceCreationFailedError(toId, new Error('empty invoice returned'));
    }

    // Step 2: source pays.
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
            if (__DEV__) console.log('[lightningSwap] payInvoice PENDING on', fromId, '— propagating, not a failure');
            throw err;
        }
        if (__DEV__) console.log('[lightningSwap] payInvoice failed on', fromId, err);
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
