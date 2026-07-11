import { useEffect, useRef } from 'react';
import { Animated, Keyboard, KeyboardEvent, Platform } from 'react-native';

/**
 * Animated translateY that lifts content out of the keyboard's way.
 *
 * Built for the 12-word seed grids (Hot Vault + Bark recovery): the keyboard
 * covers words 11/12, so the grid shifts up by `liftPt` while the user types
 * and settles back when the keyboard hides. Sliding up under the screen
 * header is deliberate — keeping every word visible beats keeping the title.
 *
 * iOS rides `keyboardWillShow/Hide` with the event's own duration so the
 * grid moves in sync with the keyboard slide; Android only emits the
 * `Did` events, so it animates with a short fixed duration instead.
 *
 * Usage:
 *   const keyboardLift = useKeyboardLift(40);
 *   <Animated.View style={{ transform: [{ translateY: keyboardLift }] }}>
 */
export default function useKeyboardLift(liftPt: number): Animated.Value {
    const lift = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const animateTo = (toValue: number) => (e: KeyboardEvent) => {
            Animated.timing(lift, {
                toValue,
                duration: e?.duration && e.duration > 0 ? e.duration : 220,
                useNativeDriver: true,
            }).start();
        };
        const show = Keyboard.addListener(showEvt, animateTo(-liftPt));
        const hide = Keyboard.addListener(hideEvt, animateTo(0));
        return () => {
            show.remove();
            hide.remove();
        };
    }, [lift, liftPt]);

    return lift;
}
