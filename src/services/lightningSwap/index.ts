/**
 * lightningSwap — public API for cross-rail Lightning swaps.
 *
 * Importing this module triggers side-effect registration of every
 * built-in provider (Coinos, Strike, Ark). Consumers can call
 * `swap()` / `getAvailableProviders()` immediately afterwards without
 * any further setup.
 *
 * --- Adding a new rail ---
 * 1. Drop a new file at `./providers/<name>.ts` that exports a
 *    LightningSwapProvider object and calls `register()` from
 *    `./registry`.
 * 2. Add it to the side-effect import block below so the registration
 *    happens on first import.
 * 3. (Optional) add an `icon` asset and reference it from the provider.
 *
 * The SwapSheet picks the new rail up automatically — no UI edits.
 *
 * --- What NOT to do ---
 * Don't import providers from outside this folder. They're an
 * implementation detail; the registry is the only thing consumers
 * should touch.
 */

// Side-effect imports — each provider registers itself on import.
// Order is preserved by the registry's Map → drives SwapSheet tile
// order. Strike first (the historical default in the existing UI),
// Coinos second, Ark last.
import './providers/strike';
import './providers/coinos';
import './providers/ark';

// Public API surface.
export { swap, estimateSwapFee, type SwapOptions } from './engine';
export {
    list as listLightningSwapProviders,
    getAvailable as getAvailableLightningSwapProviders,
    get as getLightningSwapProvider,
} from './registry';
export type {
    LightningSwapProvider,
    LightningSwapProviderId,
    LightningSwapResult,
    LightningSwapFeeEstimate,
} from './types';
export {
    LightningSwapError,
    ProviderUnavailableError,
    InvoiceCreationFailedError,
    PaymentFailedError,
    PaymentPendingError,
} from './types';
