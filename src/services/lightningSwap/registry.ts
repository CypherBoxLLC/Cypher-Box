/**
 * lightningSwap/registry — module-singleton store of LightningSwapProvider
 * instances. Each provider self-registers at module-import time (see
 * ./providers/*.ts) so consumers only need to import this registry and
 * call getAvailable() — no manual wiring of which providers exist.
 *
 * The "no manual wiring" rule is the whole point: when a future dev
 * session adds a 4th rail (Blink, Wallet of Satoshi, etc.) they should
 * touch exactly one new file in ./providers and one new line in
 * ./index.ts. SwapSheet/SwapAmount/auth-store wiring stay untouched.
 */

import type {
    LightningSwapProvider,
    LightningSwapProviderId,
} from './types';
import { ProviderUnavailableError } from './types';

// Registry lives at module scope rather than inside a class because the
// provider list is conceptually a singleton — there is exactly one
// "current set of registered Lightning rails" per app process. A
// Map preserves insertion order, which gives the UI a deterministic
// tile order without needing a separate `priority` field on the
// interface.
const providers = new Map<LightningSwapProviderId, LightningSwapProvider>();

/**
 * Register a provider. Idempotent — re-registering the same id replaces
 * the previous instance. That's intentional for hot-reload safety in
 * dev: if Metro reloads ./providers/coinos.ts, the new module's call
 * supersedes the old one without crashing.
 */
export function register(provider: LightningSwapProvider): void {
    providers.set(provider.id, provider);
}

/** Look up a provider by id. Throws if missing — callers should know. */
export function get(id: LightningSwapProviderId): LightningSwapProvider {
    const p = providers.get(id);
    if (!p) {
        throw new Error(
            `Lightning swap provider "${id}" is not registered. ` +
            `Did you forget to import it from src/services/lightningSwap/index.ts?`,
        );
    }
    return p;
}

/**
 * Like `get`, but additionally checks `isAvailable()`. Throws a typed
 * error so the engine can surface a clean "rail not connected" toast.
 */
export function require(id: LightningSwapProviderId): LightningSwapProvider {
    const p = get(id);
    if (!p.isAvailable()) {
        throw new ProviderUnavailableError(id);
    }
    return p;
}

/**
 * All registered providers, in registration order. Use this for UI that
 * wants to render every rail (with disabled state for non-authed) so
 * users can see what they could connect.
 */
export function list(): readonly LightningSwapProvider[] {
    return Array.from(providers.values());
}

/**
 * Only providers whose `isAvailable()` is currently true. Use when the
 * caller doesn't want to render disabled rails at all (e.g. quick
 * source/destination dropdowns elsewhere in the app).
 */
export function getAvailable(): readonly LightningSwapProvider[] {
    return list().filter(p => p.isAvailable());
}
