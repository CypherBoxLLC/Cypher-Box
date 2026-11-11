import { useSyncExternalStore } from 'react';
import { subscribeRegionGate, getRegionGateVersion } from '@Cypher/services/featureFlags';

/**
 * Re-renders a component when the region gate inputs change.
 *
 * isStrikeAllowed() and isCoinosAllowed() read the App Store storefront on
 * iOS, which can be unavailable for a moment right after launch and is
 * filled in shortly after by refreshRegionSignals() (called once at
 * startup). On Android they read the phone's language, SIM and network
 * country, which refreshRegionSignals() re-reads at startup and whenever the
 * app returns to the foreground: the network country can arrive late and
 * changes when the phone crosses a border. A component that reads a gate at
 * mount would otherwise be stuck on that first answer until some unrelated
 * re-render happened to run. Calling this hook subscribes the component to
 * those reads, so when one changes the component re-renders and the gate is
 * re-evaluated with the new value.
 *
 * Usage: call it once near the top of a component that decides Strike or
 * CoinOS visibility, then read isStrikeAllowed()/isCoinosAllowed() as
 * before. The returned counter is usually ignored; it is here for callers
 * that want it in an effect dependency list. It moves only when a read
 * changes what the gates see, so there are no extra renders otherwise.
 */
export default function useRegionGate(): number {
    return useSyncExternalStore(subscribeRegionGate, getRegionGateVersion, getRegionGateVersion);
}
