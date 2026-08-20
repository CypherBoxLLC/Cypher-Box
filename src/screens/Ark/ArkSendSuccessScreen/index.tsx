import React, { useEffect, useState } from 'react';
import { Image, ImageBackground, Vibration, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

import { ScreenLayout, Text } from '@Cypher/component-library';
import { GradientButton, GradientCard } from '@Cypher/components';
import Ring from '@Cypher/components/RingEffect';
import { Bitcoin, BitcoinTower, Electrik } from '@Cypher/assets/images';
import { dispatchReset } from '@Cypher/helpers/navigation';
import { getStrikeCurrency } from '@Cypher/helpers/coinosHelper';
import { colors } from '@Cypher/style-guide';

// Reuse the Strike/CoinOS send-success layout so the sizing (rings, bolt
// circle, text scale) is identical — this is the Bark-vault-themed twin of
// that screen, not a fork of the layout.
import styles from '../../Transaction/styles';

/**
 * ArkSendSuccessScreen — success animation for a completed Bark Lightning
 * send. Replaces the old static SendReceiveSuccessScreen ("Zapped!" + a still
 * image) with the same animated treatment the Strike/CoinOS Lightning send
 * uses: pulsing rings around a central lightning bolt, a "Payment Sent" nudge
 * that fades in, and a Home button — but in the white Ark palette instead of
 * Strike's pink, and with none of Strike's BUY/SELL / logo / Invoice-routing
 * baggage.
 *
 * The payment has already completed before we navigate here (executeArkSend
 * resolved), so the brief pre-reveal delay is celebratory eye-candy, not a
 * real progress bar.
 *
 * Route params (from ArkSendReviewScreen):
 *   value:    net sats sent (string)
 *   valueUsd: fiat equivalent (string, already formatted to 2dp)
 *   currency: fiat currency code
 *
 * Everything below is optional and exists because this screen is no longer
 * only a Lightning send. The exit-fee top-up lands here too, and it is an
 * ON-CHAIN deposit that is not usable until it confirms. Shown unchanged, it
 * told that user "Payment Sent / 0 sats / Lightning Network": the wrong amount,
 * the wrong rail, and an air of finality the transaction had not earned.
 *
 *   title:        headline, default 'Payment Sent'
 *   networkLabel: rail under the animation, default 'Lightning Network'
 *   isOnchain:    swap the Lightning bolt for the Bitcoin visual the on-chain
 *                 broadcast screen already uses
 *   note:         a line under the amount for anything the user still has to
 *                 know, e.g. that an on-chain deposit has to confirm first
 */

interface Props {
    route?: {
        params?: {
            value?: string | number;
            valueUsd?: string;
            currency?: string;
            title?: string;
            networkLabel?: string;
            isOnchain?: boolean;
            note?: string;
        };
    };
}

export default function ArkSendSuccessScreen({ route }: Props) {
    const value = String(route?.params?.value ?? '0');
    const valueUsd = route?.params?.valueUsd ?? '0.00';
    const currency = route?.params?.currency ?? 'USD';
    const title = route?.params?.title ?? 'Payment Sent';
    const networkLabel = route?.params?.networkLabel ?? 'Lightning Network';
    const isOnchain = route?.params?.isOnchain === true;
    const note = route?.params?.note;

    const [response, setResponse] = useState(false);
    const fadeInOpacity = useSharedValue(0);

    useEffect(() => {
        // Short reveal delay + a light haptic, mirroring the Strike/CoinOS
        // success beat. The rings mount (and start animating) the moment
        // `response` flips true.
        const t = setTimeout(() => {
            setResponse(true);
            fadeInOpacity.value = withTiming(1, {
                duration: 1200,
                easing: Easing.linear,
            });
            Vibration.vibrate(50);
        }, 550);
        return () => clearTimeout(t);
    }, []);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: fadeInOpacity.value,
    }));

    const onHome = () => dispatchReset('HomeScreen');

    return (
        <ScreenLayout disableScroll showToolbar title="" isBackButton={false}>
            <View style={styles.main}>
                <View style={styles.container}>
                    {response && (
                        <Animated.View style={animatedStyle}>
                            <Text h1 semibold center>
                                {title}
                            </Text>
                            <Text semibold center style={styles.sats}>
                                {value} sats
                            </Text>
                            <Text subHeader bold center>
                                {getStrikeCurrency(currency)}
                                {valueUsd}
                            </Text>
                            {!!note && (
                                <Text
                                    center
                                    style={{
                                        fontSize: 13,
                                        color: '#BBB',
                                        lineHeight: 18,
                                        marginTop: 10,
                                        paddingHorizontal: 24,
                                    }}
                                >
                                    {note}
                                </Text>
                            )}
                        </Animated.View>
                    )}
                </View>

                {response && (
                    <View style={styles.ringEffect}>
                        {/* White pulsing rings — isWhite forces the Ark
                            palette (the Strike path only whitens them for
                            Lightning; here every send is Lightning-into-Ark). */}
                        <Ring delay={0} isWhite />
                        <Ring delay={1000} isWhite />
                        <Ring delay={2000} isWhite />
                        <Ring delay={3000} isWhite />
                        {/* Static bolt on concentric white gradient rings.
                            We deliberately do NOT use success0.gif — it stalls
                            on the first frame under RN 0.76 + Fabric (see the
                            Transaction screen note). White ark gradient stands
                            in for Strike's pink; the dark inner circles keep
                            the bolt readable. */}
                        {isOnchain ? (
                            // The same Bitcoin visual the on-chain broadcast
                            // screen uses. A Lightning bolt over an on-chain
                            // deposit is not a styling detail: it tells the
                            // user the wrong thing about what just happened
                            // and about how soon they can use it.
                            <ImageBackground
                                source={BitcoinTower}
                                style={styles.image}
                                resizeMode="contain"
                            >
                                <Image
                                    source={Bitcoin}
                                    // Matches TransactionBroadCast's `bitcoin`
                                    // style, which the shared Transaction
                                    // stylesheet does not carry.
                                    style={{
                                        width: 60,
                                        height: 60,
                                        marginTop: 60,
                                        justifyContent: 'center',
                                        alignSelf: 'center',
                                        position: 'absolute',
                                    }}
                                    resizeMode="contain"
                                />
                            </ImageBackground>
                        ) : (
                            <GradientCard
                                style={styles.gradient}
                                linearStyle={styles.gradient}
                                colors_={[colors.ark.gradient1, colors.ark.gradient2]}
                            >
                                <View style={styles.inner}>
                                    <GradientCard
                                        style={styles.gradientInner}
                                        linearStyle={styles.gradientInner}
                                        colors_={[colors.ark.gradient1, colors.ark.gradient2]}
                                    >
                                        <View style={styles.inside}>
                                            <Image
                                                source={Electrik}
                                                style={styles.image}
                                                resizeMode="contain"
                                            />
                                        </View>
                                    </GradientCard>
                                </View>
                            </GradientCard>
                        )}
                    </View>
                )}

                <View style={styles.extra} />

                {response && (
                    <>
                        <Text semibold center style={styles.text}>
                            {networkLabel}
                        </Text>
                        {/* White button → black label for contrast (the
                            white-on-white trap the rest of the Ark UI hit). */}
                        <GradientButton
                            style={styles.invoiceButton}
                            textStyle={{ fontFamily: 'Lato-Medium', color: colors.black.default }}
                            title="Home"
                            colors_={[colors.ark.gradient1, colors.ark.gradient2]}
                            onPress={onHome}
                        />
                    </>
                )}
            </View>
        </ScreenLayout>
    );
}
