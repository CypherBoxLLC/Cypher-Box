import { useEffect } from 'react';
import {
    Easing,
    useSharedValue,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';

/**
 * Reanimated shared value that eases toward `target` — but only while
 * `active` is true. While inactive it FREEZES at the last value the user
 * saw, so the transition replays when the surface actually comes into
 * view instead of playing unseen behind another screen or carousel page.
 *
 * Drives the balance/threshold progress fills (the straight bar on the
 * single-wallet cards and the circular gauge arcs). Consumers compute
 * `active` from useIsFocused() plus CarouselPageVisibilityContext.
 *
 * Reanimated (UI-thread) rather than core Animated: the first cut used
 * the JS driver (layout props force useNativeDriver: false) and visibly
 * stuttered on low-end Android (Galaxy A14). withTiming runs the frames
 * on the UI thread regardless of JS-thread load.
 */
export default function useEasedProgress(
    target: number,
    active: boolean = true,
    durationMs = 700,
): SharedValue<number> {
    const sv = useSharedValue(target);
    useEffect(() => {
        if (!active) return;
        sv.value = withTiming(target, {
            duration: durationMs,
            easing: Easing.inOut(Easing.cubic),
        });
    }, [sv, target, active, durationMs]);
    return sv;
}
