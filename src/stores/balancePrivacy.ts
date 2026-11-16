import { useEffect, useState } from 'react';
import useAuthStore from './authStore';

/** True once the auth store has read its saved state. */
function useAuthStoreLoaded(): boolean {
    const [loaded, setLoaded] = useState(() => useAuthStore.persist.hasHydrated());
    useEffect(() => {
        if (loaded) return undefined;
        const stop = useAuthStore.persist.onFinishHydration(() => setLoaded(true));
        // It may have loaded between the first render and this effect.
        if (useAuthStore.persist.hasHydrated()) setLoaded(true);
        return stop;
    }, [loaded]);
    return loaded;
}

/**
 * Whether Home shows its balances behind ***: the total on the balance card, the Hot and Cold Vault cards' amounts
 * and capsules, and the Bark, Strike and CoinOS cards' amounts, along with the threshold fills that would give the
 * balance away. The Bark capsule colours stay: they show expiry, not amounts. They show by default. The logo button on the total balance card hides them, and they stay hidden
 * until it is tapped again: the choice is the auth store's `balancesHidden`, which is saved with the rest of that
 * store, so it survives closing and relaunching the app. Going to the background changes nothing.
 *
 * Until the saved store has loaded this says hidden, so a saved "hidden" never lets the balances show for a moment
 * at launch.
 */
export function useBalancesHidden(): boolean {
    const hidden = useAuthStore((s) => s.balancesHidden);
    const loaded = useAuthStoreLoaded();
    return hidden || !loaded;
}
