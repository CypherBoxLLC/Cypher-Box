/**
 * chainSwap: public API for cross-chain swaps.
 *
 * Importing this module registers every built-in venue, in the order below,
 * which is the order the UI lists them. Consumers use these exports and never
 * import a provider directly.
 *
 * Adding a venue: one file in ./providers that calls register(), and one
 * import line here.
 */

// Flashnet first: it is the venue we are integrating. SideShift stays
// registered as a fallback, and its backend routes answer 503 until the
// account settings are set, so it is inert unless we turn it on.
import './providers/flashnet';
import './providers/sideshift';

export {
    list as listChainSwapProviders,
    getAvailable as getAvailableChainSwapProviders,
    get as getChainSwapProvider,
    requireAvailable as requireChainSwapProvider,
} from './registry';
export type {
    ChainAsset,
    ChainSwapOrder,
    ChainSwapPair,
    ChainSwapPermission,
    ChainSwapPollResult,
    ChainSwapProvider,
    ChainSwapProviderId,
    ChainSwapQuote,
    ChainSwapStall,
    ChainSwapStallThresholds,
    ChainSwapStatus,
} from './types';
export {
    AmountOutOfRangeError,
    ChainSwapError,
    DEFAULT_STALL_THRESHOLDS,
    InvalidAddressError,
    JurisdictionBlockedError,
    ProviderUnavailableError,
    QuoteExpiredError,
    QuoteFailedError,
    ShiftCreationFailedError,
    VenueConfigError,
    VenueUnavailableError,
    asset,
    evaluateStall,
    isInFlight,
    isTerminal,
} from './types';
