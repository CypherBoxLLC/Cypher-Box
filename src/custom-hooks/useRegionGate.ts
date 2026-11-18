import { useSyncExternalStore } from 'react';
import { subscribeRegionGate, getRegionGateVersion } from '@Cypher/services/featureFlags';

/**
 * Re-renders a component when the region gate inputs change.
 *
 * isStrikeAllowed() and isCoinosAllowed() read the App Store storefront,
 * which can be unavailable for a moment right after launch and is filled in
 * shortly after by refreshStorefrontCountry() (called once at startup). A
 * component that reads a gate at mount would otherwise be stuck on that
 * first, fail-closed answer and keep a rail hidden until some unrelated
 * re-render happened to run. Calling this hook subscribes the component to
 * the storefront result, so when it resolves the component re-renders and
 * the gate is re-evaluated with the real value.
 *
 * Usage: call it once near the top of a component that decides Strike or
 * CoinOS visibility, then read isStrikeAllowed()/isCoinosAllowed() as
 * before. The returned counter is usually ignored; it is here for callers
 * that want it in an effect dependency list. On Android, and once the value
 * settles on iOS, the counter is stable, so there are no extra renders.
 */
export default function useRegionGate(): number {
    return useSyncExternalStore(subscribeRegionGate, getRegionGateVersion, getRegionGateVersion);
}
