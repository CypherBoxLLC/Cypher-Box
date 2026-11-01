import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, TouchableOpacity, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import { Text } from '@Cypher/component-library';
import { Electricity, GradientShock } from '@Cypher/assets/images';
import { colors } from '@Cypher/style-guide';

import styles from './styles';
import loc from '../../../loc';

/**
 * Success view for a completed LIGHTNING send.
 *
 * Extracted from SwapAmount, which is where this treatment was built and the
 * only place it lived. Bam's call (2026-09-09): it is the one to keep, so the
 * Lightning send surfaces adopt it rather than each carrying their own.
 *
 * LIGHTNING ONLY, deliberately. On-chain sends keep the screens they already
 * have. An on-chain payment is not final when the screen appears, and this
 * view is built to read as finished: a bolt, "Lightning Network", and no room
 * for the "waiting to confirm" caveat that path needs. ArkSendSuccessScreen
 * still owns the on-chain and exit-fee-top-up cases for exactly that reason.
 *
 * Two shapes of caption, because two things reach here:
 *
 *   a send   `paidTo` + `fromLabel` -> "Paid to satoshi@blink.me"
 *                                      "from Bark Vault"
 *   a swap   `detail` -> the caller's own node, e.g. the from/to provider
 *            badges, since a swap's destination is another of the user's own
 *            wallets and an address would be meaningless.
 */
interface Props {
    /** Net sats actually sent. */
    sats: string | number;
    /** Fiat equivalent, already formatted to 2dp. */
    fiat: string;
    /** Currency symbol to prefix the fiat line with, e.g. "$". */
    fiatSymbol?: string;
    title?: string;
    /** Realised network fee. Only rails that report one pass this. */
    feeSats?: number | null;
    /** Trailing note on the fee line, e.g. a provider caveat. */
    feeNote?: string | null;
    /** Payment destination, shown as "Paid to <x>". */
    paidTo?: string;
    /** Source wallet, shown as "from <x>". */
    fromLabel?: string;
    /** Caller-supplied caption, used instead of paidTo/fromLabel. */
    detail?: React.ReactNode;
    networkLabel?: string;
    onHome(): void;
    homeLabel?: string;
}

export default function LightningSendSuccess({
    sats,
    fiat,
    fiatSymbol = '$',
    title = loc.cypherbox.components.lightning_send_success.payment_sent,
    feeSats = null,
    feeNote = null,
    paidTo,
    fromLabel,
    detail,
    networkLabel = loc.cypherbox.components.lightning_send_success.lightning_network,
    onHome,
    homeLabel = loc.cypherbox.components.lightning_send_success.home,
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

        // Each ring expands and fades, then snaps back to full size and
        // opacity in a zero-duration step before repeating. The second ring is
        // offset by 700ms so the two read as a pulse rather than one thick edge.
        const createRingAnimation = (
            scale: Animated.Value,
            opacity: Animated.Value,
            delay: number,
        ) =>
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
        // Stop on unmount. The originals looped forever against a screen that
        // was about to be reset away, which kept a native driver animation
        // running behind Home.
        return () => {
            a.stop();
            b.stop();
        };
    }, [slideAnim, fadeAnim, ring1Scale, ring1Opacity, ring2Scale, ring2Opacity]);

    const satsNum = Number(sats) || 0;
    const feeRow = (() => {
        if (feeSats === null || feeSats === undefined || feeSats <= 0) return null;
        // Percentage of the total debited, matching the pre-send preview and
        // the ArkSendScreen fee row so the same number reads the same way
        // across every surface.
        const gross = satsNum + feeSats;
        const pct = gross > 0 ? Math.min(999, (feeSats / gross) * 100) : null;
        const pctStr =
            pct === null ? '' : pct < 0.01 ? ' (< 0.01%)' : ` (${pct.toFixed(pct < 1 ? 2 : 1)}%)`;
        return (
            <Text style={styles.fee}>
                {loc.formatString(loc.cypherbox.components.lightning_send_success.network_fee, { fee: feeSats })}{pctStr}{feeNote ? ` · ${feeNote}` : ''}
            </Text>
        );
    })();

    return (
        <Animated.View
            style={[styles.container, { transform: [{ translateY: slideAnim }], opacity: fadeAnim }]}
        >
            <Text semibold style={styles.title}>{title}</Text>
            <Text semibold style={styles.value}>{satsNum.toLocaleString()} sats</Text>
            <Text semibold style={styles.fiat}>{fiatSymbol}{fiat}</Text>
            {feeRow}
            <View style={styles.animationContainer}>
                <Animated.View
                    style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]}
                >
                    <Image source={GradientShock} style={styles.ringImage} />
                </Animated.View>
                <Animated.View
                    style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]}
                >
                    <Image source={GradientShock} style={styles.ringImage} />
                </Animated.View>
                <Image source={Electricity} style={styles.boltImage} />
            </View>
            {detail ?? (
                <View style={styles.detail}>
                    {!!paidTo && (
                        <Text style={styles.paidTo}>{loc.formatString(loc.cypherbox.components.lightning_send_success.paid_to, { destination: paidTo })}</Text>
                    )}
                    {!!fromLabel && (
                        <Text style={styles.fromWallet}>{loc.formatString(loc.cypherbox.components.lightning_send_success.from_wallet, { wallet: fromLabel })}</Text>
                    )}
                </View>
            )}
            <Text semibold style={styles.network}>{networkLabel}</Text>
            <TouchableOpacity onPress={onHome} style={styles.homeButton}>
                <LinearGradient
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    colors={[colors.pink.extralight, colors.pink.default]}
                    style={styles.homeButtonGradient}
                >
                    <Text bold style={styles.homeText}>{homeLabel}</Text>
                </LinearGradient>
            </TouchableOpacity>
        </Animated.View>
    );
}
