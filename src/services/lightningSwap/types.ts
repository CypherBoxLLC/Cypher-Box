/**
 * lightningSwap/types — provider interface for cross-rail Lightning swaps.
 *
 * A swap is "destination creates an invoice → source pays it". Every
 * Lightning rail in the app — custodial (Coinos, Strike) or non-custodial
 * (Ark) — implements this same two-method shape, and the engine in
 * ./engine.ts orchestrates the round-trip without caring which rail is
 * which.
 *
 * Adding a new rail = one file in ./providers, one register() call. The
 * UI (SwapSheet, SwapAmount) pulls available providers from the registry
 * and never needs to be edited.
 */

import type { ImageSourcePropType } from 'react-native';

/**
 * Stable, lower-case identifier. Used as the registry key, in route
 * params, and in analytics. Add a new id here when registering a new
 * provider so consumers can switch on it exhaustively.
 */
export type LightningSwapProviderId = 'coinos' | 'strike' | 'ark';

/**
 * Optional pre-swap fee estimate. Returned by providers that can quote
 * routing/network costs ahead of time (currently Ark via the Bark SDK).
 * Custodial providers that only learn the actual fee after the payment
 * settles return `null` from `estimateFee()` — the UI then renders an
 * "≈ network fee" placeholder until the swap completes.
 *
 * `feeSats` is denominated in satoshis on the *source* side: it's what
 * the user's source balance pays on top of `amountSats`. Pure intra-bank
 * transfers (Coinos→Coinos hypothetically) report 0 here.
 */
export type LightningSwapFeeEstimate = {
    feeSats: number;
    /** Optional human-readable note (e.g. "Ark routing fee"). */
    note?: string;
} | null;

/**
 * Outcome of a successful swap. The engine returns this to callers so
 * the success screen can render an audit-style receipt without having
 * to re-query the provider.
 *
 * `id` is whichever opaque string the source provider returned to
 * identify the payment — Strike's payment-quote id, Coinos's payment id,
 * or Ark's payment hash. We don't try to normalise its format because
 * it's only used for display + customer-support copy/paste.
 */
export type LightningSwapResult = {
    id: string;
    /** Actual fee paid in sats, if the provider surfaced one. */
    feeSats?: number;
};

/**
 * Provider contract. Each rail implements this and self-registers via
 * registry.register() at module import time (see ./providers/*.ts and
 * the side-effect imports in ./index.ts).
 */
export interface LightningSwapProvider {
    /** Lower-case stable id — registry key. */
    readonly id: LightningSwapProviderId;
    /** User-facing name shown on the SwapSheet tile. */
    readonly displayName: string;
    /**
     * Optional logo asset rendered on the SwapSheet tile. Providers
     * without a dedicated logo (e.g. Ark, which uses a typographic
     * brand) can omit this — the SwapSheet falls back to rendering
     * `displayName` as text inside the tile.
     */
    readonly icon?: ImageSourcePropType;

    /**
     * Whether this rail is currently usable. Usually a check against the
     * relevant auth flag in zustand. The SwapSheet renders all providers
     * but disables the tiles that report `false` here so the user can see
     * which rails they could swap with after connecting.
     */
    isAvailable(): boolean;

    /**
     * Generate a BOLT11 invoice on this rail for `amountSats`. Memo is
     * best-effort — Strike accepts it, Coinos uses it as the description,
     * Ark currently ignores it for invoice receive (the SDK doesn't
     * thread comments through `bolt11Invoice` yet).
     *
     * `sourceId` is the rail that will PAY this invoice. Providers that set
     * an invoice TTL widen it for slow sources: an Ark send takes minutes
     * (HTLC + ASP round-trip), so a short TTL expires before it settles.
     */
    createInvoice(amountSats: number, memo?: string, sourceId?: LightningSwapProviderId): Promise<string>;

    /**
     * Pay a BOLT11 invoice from this rail. The optional `amountSats` is
     * a hint for amount-less invoices (e.g. zero-amount BOLT11) — for
     * normal amount-encoded invoices providers should ignore it and pay
     * what the invoice says.
     */
    payInvoice(
        bolt11: string,
        amountSats: number,
        memo?: string,
    ): Promise<LightningSwapResult>;

    /**
     * Optional pre-swap fee estimate. Implementations that can't quote
     * ahead of time return null; the engine treats null as "unknown" and
     * the UI shows a placeholder. Estimated fee is on the *source* side
     * (this provider, since this is the one paying).
     *
     * This is the value shown in the UI under the amount input — it
     * should be a *real* expected cost, not a defensive buffer. Coinos
     * has no quote endpoint and returns null here; its only obligation
     * is the separate `maxFeeReserve` below.
     */
    estimateFee?(amountSats: number): Promise<LightningSwapFeeEstimate>;

    /**
     * Optional Max-button headroom. The number of sats to *reserve* off
     * the user's spendable balance when they tap "Max" so the resulting
     * swap doesn't fail with "Insufficient funds" once the rail's
     * routing fee is applied.
     *
     * Distinct from `estimateFee()`:
     *   - `estimateFee()` is shown to the user as the expected cost.
     *     It must be a precise quote, or null.
     *   - `maxFeeReserve()` is a defensive buffer applied to the Max
     *     button only. It can be a slightly-pessimistic guess (e.g.
     *     "0.6% of the amount") and is never shown to the user — they
     *     just see a Max value that lands a few sats below the raw
     *     balance and the swap succeeds.
     *
     * Providers that quote precisely (Ark) typically don't need this —
     * the SwapAmount screen falls back to `estimateFee()`'s value as
     * the reserve when this method is absent.
     */
    maxFeeReserve?(amountSats: number): Promise<number>;

    /**
     * Optional DESTINATION-side confirmation: given a BOLT11 this provider
     * generated (via createInvoice), report whether the payment for it has
     * actually arrived on this rail.
     *
     * The engine uses this to rescue swaps whose SOURCE can't self-confirm.
     * Strike's mobile token gets `403 Insufficient permissions` on the
     * payment-status endpoint, so a successful Strike send surfaces as
     * PaymentPendingError ("submitted, can't confirm") even though the money
     * lands. When the destination can independently confirm receipt (Ark
     * reads its own pending Lightning receives by payment hash — a pure,
     * side-effect-free check), the engine turns that PENDING into a real
     * success instead of scaring the user with a do-not-retry modal.
     *
     * Must be a PURE READ — the engine may poll it several times. Return
     * false (never throw) when unknown/not-yet-arrived. `sinceMs` scopes the
     * check to receipts observed at or after the swap started, so a stale
     * same-amount receive from before this swap can't produce a false
     * positive.
     */
    confirmReceived?(bolt11: string, sinceMs?: number): Promise<boolean>;
}

/**
 * Typed errors thrown by the engine. Catch these in UI code so toasts
 * can be specific ("Strike rejected the invoice" vs a generic failure).
 *
 * These wrap, but don't replace, the underlying error — `cause` carries
 * the original so deep debugging in __DEV__ logs is still possible.
 */
export class LightningSwapError extends Error {
    cause?: unknown;
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'LightningSwapError';
        this.cause = cause;
    }
}

export class ProviderUnavailableError extends LightningSwapError {
    constructor(id: LightningSwapProviderId) {
        super(`Lightning provider "${id}" is not available`);
        this.name = 'ProviderUnavailableError';
    }
}

export class InvoiceCreationFailedError extends LightningSwapError {
    constructor(id: LightningSwapProviderId, cause?: unknown) {
        super(`"${id}" failed to create an invoice`, cause);
        this.name = 'InvoiceCreationFailedError';
    }
}

export class PaymentFailedError extends LightningSwapError {
    constructor(id: LightningSwapProviderId, cause?: unknown) {
        super(`"${id}" failed to pay the invoice`, cause);
        this.name = 'PaymentFailedError';
    }
}

/**
 * The source provider accepted the payment but it has NOT reached a
 * terminal state — it's still in-flight on Lightning, or we cannot
 * confirm its outcome (e.g. Strike returns `state: PENDING` and the
 * client token lacks the scope to poll `GET /payments/{id}`).
 *
 * This is deliberately NOT a subclass-of-nothing-special: it is a
 * THIRD outcome distinct from success and failure. Critically, the UI
 * must NOT frame it as a retryable failure — retrying re-reserves the
 * source balance for a payment that may still settle, which is exactly
 * how a single user-intended swap turned into three reserved Strike
 * payments during the 2026-05-31 debug session.
 *
 * Handling contract:
 *   - The engine RE-THROWS this as-is (does not wrap it as
 *     PaymentFailedError) so callers can distinguish it.
 *   - The UI shows a clear "submitted, do not retry, check the source
 *     wallet" message. Pending Lightning payments either complete or
 *     auto-refund when their HTLC times out; the user should wait, not
 *     retry.
 */
export class PaymentPendingError extends LightningSwapError {
    /** Provider-side payment id so the UI can tell the user what to look up. */
    paymentId?: string;
    constructor(id: LightningSwapProviderId, message: string, paymentId?: string) {
        super(message);
        this.name = 'PaymentPendingError';
        this.paymentId = paymentId;
    }
}
