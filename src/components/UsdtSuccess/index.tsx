import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, TouchableOpacity, View, type ImageSourcePropType } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import { Text } from '@Cypher/component-library';
import { GradientShock } from '@Cypher/assets/images';
import { colors } from '@Cypher/style-guide';

import styles from './styles';

/**
 * Success view for a finished USDT send or swap.
 *
 * The same treatment as LightningSendSuccess, which is the one Bam picked, and
 * built from it deliberately so the two read as the same app. One thing is
 * different, and it is the reason this exists rather than a third caller of
 * that component: `note`.
 *
 * LightningSendSuccess is Lightning only, on purpose, and its own comment says
 * why: it is built to read as finished, and there is no room in it for the
 * "waiting to confirm" caveat an on-chain payment needs. That rules it out for
 * half of what this feature finishes. A swap into a vault is bitcoin on chain
 * and is not final when this appears; a swap over Lightning and a USDT
 * transfer in a block are. So the celebration is the same and the copy is not:
 * `note` carries the caveat where there is one, and is absent where there is
 * not.
 *
 * Nothing here decides whether an outcome is final. The caller knows, and
 * passes the words.
 */
interface Props {
    /** "Sent", "Swap complete". */
    title: string;
    /** The big line: "250 USDT", "224,512 sats". */
    amount: string;
    /** The quieter line under it, when there is a second figure worth showing. */
    secondary?: string;
    /** The glyph in the middle of the rings: a bolt, a bitcoin mark, a tick. */
    glyph: ImageSourcePropType;
    /** Tints the rings and the glyph to the asset that arrived. */
    accent?: string;
    /** The Home button's gradient. */
    accentGradient?: string[];
    /** Where it went, and from where. */
    detail?: React.ReactNode;
    /** "Tron network, TRC-20", "Lightning Network", "Bitcoin network". */
    networkLabel?: string;
    /**
     * The caveat, when the money is on its way rather than arrived.
     *
     * This is the line LightningSendSuccess has nowhere to put. An on-chain
     * payout is not settled when this screen appears, and saying so here is
     * what makes the celebration honest rather than premature.
     */
    note?: string;
    onHome(): void;
    homeLabel?: string;
}

export default function UsdtSuccess({
    title,
    amount,
    secondary,
    glyph,
    accent = colors.usdt.light,
    accentGradient,
    detail,
    networkLabel,
    note,
    onHome,
    homeLabel = 'Done',
}: Props) {
    const slideAnim = useRef(new Animated.Value(300)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const ring1Scale = useRef(new Animated.Value(1)).current;
    const ring1Opacity = useRef(new Animated.Value(0.8)).current;
    const ring2Scale = useRef(new Animated.Value(1)).current;
    const ring2Opacity = useRef(new Animated.Value(0.8)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();

        // Each ring expands and fades, then snaps back to full size and opacity
        // in a zero-duration step before repeating. The second is offset by
        // 700ms so the two read as a pulse rather than one thick edge.
        const createRingAnimation = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
            Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.parallel([
                        Animated.timing(scale, {
                            toValue: 1.8,
                            duration: 2000,
                            easing: Easing.out(Easing.ease),
                            useNativeDriver: true,
                        }),
                        Animated.timing(opacity, {
                            toValue: 0,
                            duration: 2000,
                            easing: Easing.out(Easing.ease),
                            useNativeDriver: true,
                        }),
                    ]),
                    Animated.parallel([
                        Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
                        Animated.timing(opacity, { toValue: 0.8, duration: 0, useNativeDriver: true }),
                    ]),
                ]),
            );

        const a = createRingAnimation(ring1Scale, ring1Opacity, 0);
        const b = createRingAnimation(ring2Scale, ring2Opacity, 700);
        a.start();
        b.start();
        // Stopped on unmount. Looping forever against a screen about to be
        // reset away kept a native driver animation running behind Home, which
        // is the bug the Lightning view already had to fix.
        return () => {
            a.stop();
            b.stop();
        };
    }, [slideAnim, fadeAnim, ring1Scale, ring1Opacity, ring2Scale, ring2Opacity]);

    const gradient = accentGradient ?? [colors.usdt.gradient1, colors.usdt.gradient2];

    return (
        <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }], opacity: fadeAnim }]}>
            <Text semibold style={[styles.title, { color: accent }]}>{title}</Text>
            <Text semibold style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{amount}</Text>
            {!!secondary && <Text semibold style={styles.secondary}>{secondary}</Text>}

            <View style={styles.animationContainer}>
                <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]}>
                    <Image source={GradientShock} style={[styles.ringImage, { tintColor: accent }]} />
                </Animated.View>
                <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]}>
                    <Image source={GradientShock} style={[styles.ringImage, { tintColor: accent }]} />
                </Animated.View>
                <Image source={glyph} style={styles.glyph} resizeMode="contain" />
            </View>

            {!!detail && <View style={styles.detail}>{detail}</View>}
            {!!networkLabel && <Text semibold style={styles.network}>{networkLabel}</Text>}
            {!!note && <Text style={styles.note}>{note}</Text>}

            <TouchableOpacity onPress={onHome} style={styles.homeButton} accessibilityRole="button">
                <LinearGradient
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    colors={gradient}
                    style={styles.homeButtonGradient}
                >
                    <Text bold style={styles.homeText}>{homeLabel}</Text>
                </LinearGradient>
            </TouchableOpacity>
        </Animated.View>
    );
}
