/**
 * chainSwap/registry: module-singleton store of ChainSwapProvider instances.
 *
 * Same shape and same reasoning as lightningSwap/registry: providers
 * self-register at import time so consumers never hand-wire the list, and a
 * Map preserves insertion order to give the UI deterministic tile ordering
 * without a `priority` field on the interface.
 *
 * This matters more here than it does for Lightning. Which venue is the
 * default is expected to change, and may differ by platform. Registering
 * venues rather than importing one directly is what keeps that a config
 * change instead of a rewrite.
 */

import type { ChainSwapProvider, ChainSwapProviderId } from './types';
import { ProviderUnavailableError } from './types';

const providers = new Map<ChainSwapProviderId, ChainSwapProvider>();

/**
 * Register a venue. Idempotent: re-registering the same id replaces the
 * previous instance, which keeps Metro hot-reload from crashing in dev.
 */
export function register(provider: ChainSwapProvider): void {
    providers.set(provider.id, provider);
}

/** Look up a venue by id. Throws if missing, so callers should know. */
export function get(id: ChainSwapProviderId): ChainSwapProvider {
    const p = providers.get(id);
    if (!p) {
        throw new Error(
            `Chain swap provider "${id}" is not registered. ` +
            `Did you forget to import it from src/services/chainSwap/index.ts?`,
        );
    }
    return p;
}

/**
 * Like `get`, but additionally checks `isAvailable()`, so the caller can
 * surface a clean "not configured" message rather than a raw failure deeper
 * in the request.
 */
export function requireAvailable(id: ChainSwapProviderId): ChainSwapProvider {
    const p = get(id);
    if (!p.isAvailable()) {
        throw new ProviderUnavailableError(id);
    }
    return p;
}

/** All registered venues, in registration order. */
export function list(): readonly ChainSwapProvider[] {
    return Array.from(providers.values());
}

/** Only venues currently usable. */
export function getAvailable(): readonly ChainSwapProvider[] {
    return list().filter(p => p.isAvailable());
}
