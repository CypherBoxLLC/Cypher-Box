import React, { useState } from "react";
import { View, Image, ActivityIndicator, TouchableOpacity, Animated, Easing } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ScreenLayout, Text } from "@Cypher/component-library";
import LinearGradient from "react-native-linear-gradient";
import { CustomKeyboard, GradientInput } from "@Cypher/components";
import { StrikeFull, CoinOS, GradientShock, Electricity } from "@Cypher/assets/images";
import { dispatchNavigate, dispatchReset } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { sendLightningPayment } from "@Cypher/api/coinOSApis";
import { createInvoice as createStrikeInvoice, getPaymentQoute, getPaymentQouteByLightening } from "@Cypher/api/strikeAPIs";
import useAuthStore from "@Cypher/stores/authStore";
import SimpleToast from "react-native-simple-toast";
import { StyleSheet } from "react-native";

export default function SwapAmount() {
    const navigation = useNavigation();
    const route = useRoute();
    const { swapFrom, sendTo, fromAddress, toAddress, sourceBalance = 0 } = route.params as any;
    const { matchedRateStrike, strikeUser } = useAuthStore();
    const currency = swapFrom === 'strike' ? (strikeUser?.[1]?.currency || 'USD') : 'USD';

    const [sats, setSats] = useState('');
    const [usd, setUsd] = useState('');
    const [isSats, setIsSats] = useState(true);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [swappedSats, setSwappedSats] = useState('');
    const [swappedFiat, setSwappedFiat] = useState('');

    const fromLogo = swapFrom === 'strike' ? StrikeFull : CoinOS;
    const toLogo = sendTo === 'strike' ? StrikeFull : CoinOS;

    const handleSwap = async () => {
        const amount = Number(sats);
        if (!amount || amount <= 0) {
            SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
            return;
        }

        // Get the correct sats and fiat values regardless of input mode
        const satsAmount = isSats ? amount : Number(usd);
        const fiatAmount = isSats ? Number(usd) : amount;

        setLoading(true);
        try {
            if (swapFrom === 'coinos') {
                // 1. Create invoice on Strike for the amount
                const strikeCurrency = strikeUser?.[1]?.currency || 'USD';
                console.log('Creating Strike invoice for:', fiatAmount, strikeCurrency, 'sats:', satsAmount);
                const invoiceResponse = await createStrikeInvoice({
                    bolt11: {
                        amount: {
                            amount: fiatAmount,
                            currency: strikeCurrency,
                        },
                        expiryInSeconds: 60,
                    },
                    targetCurrency: strikeCurrency,
                });
                console.log('Strike invoice response:', invoiceResponse);
                const bolt11Invoice = invoiceResponse?.bolt11?.invoice;
                if (!bolt11Invoice) {
                    SimpleToast.show(invoiceResponse?.data?.message || 'Failed to create Strike invoice', SimpleToast.SHORT);
                    setLoading(false);
                    return;
                }
                // 2. Pay the invoice from CoinOS
                const payResponseText = await sendLightningPayment(bolt11Invoice, 'Swap to Strike', satsAmount);
                console.log('CoinOS pay response:', payResponseText);
                let payResponse: any;
                try {
                    payResponse = JSON.parse(payResponseText);
                } catch {
                    payResponse = payResponseText;
                }
                if (payResponse?.confirmed || payResponse?.id) {
                    setSwappedSats(String(satsAmount));
                    setSwappedFiat(String(fiatAmount));
                    setSuccess(true);
                } else {
                    SimpleToast.show(typeof payResponse === 'string' ? payResponse : (payResponse?.message || 'Swap failed'), SimpleToast.SHORT);
                }
            } else if (swapFrom === 'strike') {
                const strikeCurrency = strikeUser?.[1]?.currency || 'USD';
                const payload = {
                    lnAddressOrUrl: toAddress,
                    sourceCurrency: 'BTC',
                    amount: {
                        amount: String(fiatAmount),
                        currency: strikeCurrency,
                    },
                };
                const quoteResponse = await getPaymentQoute('lightning/lnurl', payload);
                console.log('Strike quote response:', quoteResponse);

                if (quoteResponse?.paymentQuoteId) {
                    const executeResponse = await getPaymentQouteByLightening(
                        payload,
                        quoteResponse.paymentQuoteId
                    );
                    console.log('Strike execute response:', executeResponse);
                    if (executeResponse?.state === 'COMPLETED' || executeResponse?.completed) {
                        setSwappedSats(String(satsAmount));
                        setSwappedFiat(String(fiatAmount));
                        setSuccess(true);
                    } else {
                        SimpleToast.show(executeResponse?.data?.message || 'Swap failed', SimpleToast.SHORT);
                    }
                } else {
                    SimpleToast.show(quoteResponse?.data?.message || 'Failed to create quote', SimpleToast.SHORT);
                }
            }
        } catch (error) {
            console.error('Swap error:', error);
            SimpleToast.show('Swap failed. Please try again.', SimpleToast.SHORT);
        } finally {
            setLoading(false);
        }
    };

    // Expanding ring animations
    const slideAnim = React.useRef(new Animated.Value(300)).current;
    const fadeAnim = React.useRef(new Animated.Value(0)).current;
    const ring1Scale = React.useRef(new Animated.Value(1)).current;
    const ring1Opacity = React.useRef(new Animated.Value(0.8)).current;
    const ring2Scale = React.useRef(new Animated.Value(1)).current;
    const ring2Opacity = React.useRef(new Animated.Value(0.8)).current;

    React.useEffect(() => {
        if (success) {
            // Slide up + fade in
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

            const createRingAnimation = (scale: Animated.Value, opacity: Animated.Value, delay: number) => {
                return Animated.loop(
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
                    ])
                );
            };
            createRingAnimation(ring1Scale, ring1Opacity, 0).start();
            createRingAnimation(ring2Scale, ring2Opacity, 700).start();
        }
    }, [success]);

    if (success) {
        return (
            <ScreenLayout showToolbar isBackButton={false}>
                <Animated.View style={[styles.successContainer, { transform: [{ translateY: slideAnim }], opacity: fadeAnim }]}>
                    <Text semibold style={styles.successTitle}>Swap Sent ⚡</Text>
                    <Text semibold style={styles.successValue}>{swappedSats} sats</Text>
                    <Text semibold style={styles.successFiat}>{currency === 'EUR' ? '€' : '$'}{swappedFiat}</Text>
                    <View style={styles.animationContainer}>
                        <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]}>
                            <Image source={GradientShock} style={styles.ringImage} />
                        </Animated.View>
                        <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]}>
                            <Image source={GradientShock} style={styles.ringImage} />
                        </Animated.View>
                        <Image source={Electricity} style={styles.boltImage} />
                    </View>
                    <View style={styles.successDirection}>
                        <View style={styles.successServiceBox}>
                            <Image source={fromLogo} style={styles.successLogo} />
                        </View>
                        <Text style={styles.successArrow}>→</Text>
                        <View style={styles.successServiceBox}>
                            <Image source={toLogo} style={styles.successLogo} />
                        </View>
                    </View>
                    <Text semibold style={styles.successNetwork}>Lightning Network</Text>
                    <TouchableOpacity onPress={() => navigation.popToTop()} style={styles.homeButton}>
                        <LinearGradient
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            colors={[colors.pink.extralight, colors.pink.default]}
                            style={styles.homeButtonGradient}
                        >
                            <Text bold style={styles.homeText}>Home</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </Animated.View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Lightning Swap">
            <View style={styles.main}>
                <GradientInput isSats={isSats} walletInfo={{ matchedRate: matchedRateStrike, currency }} sats={sats} setSats={setSats} usd={usd} />
                <View style={styles.directionRow}>
                    <View style={styles.serviceBox}>
                        <Image source={fromLogo} style={styles.logo} />
                    </View>
                    <Text style={styles.arrow}>→</Text>
                    <View style={styles.serviceBox}>
                        <Image source={toLogo} style={styles.logo} />
                    </View>
                </View>
            </View>
            {loading ? (
                <View style={styles.loadingView}>
                    <ActivityIndicator size="large" color={colors.pink.default} />
                    <Text style={styles.loadingText}>Processing swap...</Text>
                </View>
            ) : (
                <CustomKeyboard
                    title="Swap"
                    prevSats={sats}
                    onPress={handleSwap}
                    setSATS={setSats}
                    setUSD={setUsd}
                    setIsSATS={setIsSats}
                    disabled={!sats || Number(sats) <= 0 || loading}
                    matchedRate={matchedRateStrike}
                    currency={currency}
                    colors_={[colors.pink.extralight, colors.pink.default]}
                    maxBalance={sourceBalance}
                />
            )}
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    main: {
        flex: 1,
    },
    directionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 60,
    },
    serviceBox: {
        backgroundColor: '#2A2A2A',
        borderRadius: 12,
        paddingHorizontal: 20,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logo: {
        height: 24,
        width: 90,
        resizeMode: 'contain',
    },
    arrow: {
        fontSize: 24,
        marginHorizontal: 16,
        color: '#FFFFFF',
    },
    loadingView: {
        paddingVertical: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: '#FFFFFF',
    },
    successContainer: {
        flex: 1,
        alignItems: 'center',
        marginHorizontal: 20,
    },
    successTitle: {
        fontSize: 40,
        lineHeight: 50,
        marginBottom: 30,
    },
    successValue: {
        fontSize: 42,
        lineHeight: 52,
    },
    successFiat: {
        fontSize: 30,
        lineHeight: 40,
        color: '#AAAAAA',
    },
    animationContainer: {
        width: 200,
        height: 200,
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 20,
    },
    ring: {
        position: 'absolute',
        width: 150,
        height: 150,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ringImage: {
        width: 150,
        height: 150,
    },
    boltImage: {
        width: 80,
        height: 85,
        zIndex: 10,
    },
    successDirection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 20,
    },
    successServiceBox: {
        backgroundColor: '#2A2A2A',
        borderRadius: 12,
        paddingHorizontal: 24,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    successLogo: {
        height: 30,
        width: 110,
        resizeMode: 'contain',
    },
    successArrow: {
        fontSize: 28,
        marginHorizontal: 20,
        color: '#FFFFFF',
    },
    successNetwork: {
        fontSize: 22,
        lineHeight: 30,
        color: '#AAAAAA',
    },
    homeButton: {
        marginTop: 40,
        width: '80%',
    },
    homeButtonGradient: {
        borderRadius: 25,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    homeText: {
        fontSize: 18,
        color: '#FFFFFF',
    },
});
