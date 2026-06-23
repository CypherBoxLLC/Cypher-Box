import React, { useEffect, useState } from "react";
import { View, Image, ActivityIndicator, TouchableOpacity, Animated, Easing, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ScreenLayout, Text } from "@Cypher/component-library";
import LinearGradient from "react-native-linear-gradient";
import { CustomKeyboard, GradientInput } from "@Cypher/components";
import { GradientShock, Electricity } from "@Cypher/assets/images";
import { dispatchNavigate, dispatchReset } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import useAuthStore from "@Cypher/stores/authStore";
import SimpleToast from "react-native-simple-toast";
import { StyleSheet } from "react-native";
import {
    swap as runSwap,
    estimateSwapFee,
    getLightningSwapProvider,
    LightningSwapError,
    InvoiceCreationFailedError,
    PaymentFailedError,
    PaymentPendingError,
    type LightningSwapProvider,
    type LightningSwapProviderId,
} from "@Cypher/services/lightningSwap";
import { getFiatRate } from "../../../models/fiatUnit";

export default function SwapAmount() {
    const navigation = useNavigation();
    const route = useRoute();
    const { swapFrom, sendTo, fromAddress, toAddress, sourceBalance = 0 } = route.params as {
        swapFrom: LightningSwapProviderId;
        sendTo: LightningSwapProviderId;
        fromAddress?: string;
        toAddress?: string;
        sourceBalance?: number;
    };
    const { matchedRateStrike, strikeUser } = useAuthStore();
    // Currency and rate are rail-specific. Strike carries the user's
    // configured fiat currency (e.g. EUR) and a Strike-side rate in that
    // currency. Every other rail uses USD and BlueWallet's USD/BTC rate
    // (same source HomeScreen reads). Using Strike's rate as the default
    // for non-Strike rails was the prior bug — fiat preview stayed blank
    // whenever Strike wasn't linked.
    const currency = swapFrom === 'strike' ? (strikeUser?.[1]?.currency || 'USD') : 'USD';
    const [usdRate, setUsdRate] = useState(0);
    useEffect(() => {
        if (swapFrom === 'strike') return;
        let cancelled = false;
        (async () => {
            try {
                const r = (await getFiatRate('USD')) || 0;
                if (!cancelled) setUsdRate(r);
            } catch {}
        })();
        return () => { cancelled = true; };
    }, [swapFrom]);
    const matchedRate = swapFrom === 'strike' ? matchedRateStrike : usdRate;

    // Resolve provider metadata from the registry once. Fallbacks are
    // defensive — the navigation should never get here without valid
    // ids, but a stale deep-link param shouldn't crash the screen.
    let fromProvider: LightningSwapProvider | null = null;
    let toProvider: LightningSwapProvider | null = null;
    try { fromProvider = getLightningSwapProvider(swapFrom); } catch { fromProvider = null; }
    try { toProvider = getLightningSwapProvider(sendTo); } catch { toProvider = null; }

    const [sats, setSats] = useState('');
    const [usd, setUsd] = useState('');
    const [isSats, setIsSats] = useState(true);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [swappedSats, setSwappedSats] = useState('');
    const [swappedFiat, setSwappedFiat] = useState('');
    const [feeSats, setFeeSats] = useState<number | null>(null);
    const [feeNote, setFeeNote] = useState<string | null>(null);
    /**
     * Headroom reserved off the Max button so Ark (which charges a
     * routing fee on top of `amountSats`, not deducted from it) doesn't
     * fail with "BarkError.Internal" when the user taps Max. We seed
     * this once on mount with a trial estimate at the full sourceBalance
     * — providers that don't quote ahead of time return null and we
     * default to 0 (no reserve, same as before for Coinos/Strike).
     */
    const [maxFeeReserve, setMaxFeeReserve] = useState<number>(0);

    // One-shot Max-button reserve at mount. Two-stage lookup:
    //   1. Provider's `maxFeeReserve` — explicit headroom buffer (Coinos
    //      uses this; the buffer isn't accurate enough to display as a
    //      fee but is a safe Max ceiling).
    //   2. Provider's `estimateFee` — only if `maxFeeReserve` isn't
    //      implemented. Ark gets here and reuses its precise quote as
    //      both display value and Max reserve.
    // Falls back to 0 (full balance is allowed) when neither exists —
    // current behavior for Strike.
    useEffect(() => {
        if (!swapFrom || !sourceBalance) return;
        let cancelled = false;
        (async () => {
            try {
                const provider = fromProvider;
                let reserve = 0;
                if (provider?.maxFeeReserve) {
                    reserve = Number(await provider.maxFeeReserve(Number(sourceBalance))) || 0;
                } else {
                    const est = await estimateSwapFee(swapFrom, Number(sourceBalance));
                    reserve = est ? Math.max(0, Number(est.feeSats || 0)) : 0;
                }
                if (!cancelled) setMaxFeeReserve(Math.max(0, reserve));
            } catch {
                // Reserve is best-effort — fall back to 0 (full balance).
                if (!cancelled) setMaxFeeReserve(0);
            }
        })();
        return () => { cancelled = true; };
    }, [swapFrom, sourceBalance, fromProvider]);

    // Fee preview — only providers that quote ahead of time (Ark)
    // populate this. Custodial sources (Coinos, Strike) leave it null
    // and the success view falls back to "—". Debounce-by-cancellation
    // pattern: keep the latest amount's request, drop earlier ones.
    useEffect(() => {
        const amount = Number(sats);
        if (!swapFrom || !amount || amount <= 0) {
            setFeeSats(null);
            setFeeNote(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const est = await estimateSwapFee(swapFrom, amount);
                if (cancelled) return;
                if (est) {
                    setFeeSats(est.feeSats);
                    setFeeNote(est.note ?? null);
                } else {
                    setFeeSats(null);
                    setFeeNote(null);
                }
            } catch {
                if (!cancelled) {
                    setFeeSats(null);
                    setFeeNote(null);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [sats, swapFrom]);

    const handleSwap = async () => {
        const amount = Number(sats);
        if (!amount || amount <= 0) {
            SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
            return;
        }

        // Resolve sats vs fiat from the keyboard's input mode. Display
        // values for the success screen come from these.
        const satsAmount = isSats ? amount : Number(usd);
        const fiatAmount = isSats ? Number(usd) : amount;

        setLoading(true);
        try {
            const result = await runSwap(swapFrom, sendTo, satsAmount, {
                memo: `Swap ${swapFrom} → ${sendTo}`,
            });
            // Engine returns the source provider's fee if surfaced
            // (Ark does, others don't). Override our preview with the
            // realised fee so the success view is accurate even when
            // the pre-swap estimate was a placeholder.
            if (typeof result.feeSats === 'number') {
                setFeeSats(result.feeSats);
            }
            setSwappedSats(String(satsAmount));
            setSwappedFiat(String(fiatAmount));
            setSuccess(true);
        } catch (error) {
            console.error('Swap error:', error);

            // PENDING is NOT a failure and must NOT invite a retry — a
            // retry re-reserves the source balance for a payment that may
            // still settle. Surface it as a blocking modal (not a toast)
            // so the user actually reads "do not retry, check the source
            // wallet" before tapping anything. See the 2026-05-31 incident
            // where retrying a PENDING Strike swap reserved it three times.
            if (error instanceof PaymentPendingError) {
                Alert.alert(
                    'Payment submitted, not yet confirmed',
                    error.message,
                    [{ text: 'OK, I will check', style: 'default' }],
                    { cancelable: false },
                );
                setLoading(false);
                return;
            }

            // Tailored toast per failure stage so the user knows whether
            // the destination's invoice or the source's payment failed.
            const fallback = 'Swap failed. Please try again.';
            let message = fallback;
            if (error instanceof InvoiceCreationFailedError) {
                message = `${toProvider?.displayName ?? sendTo} couldn't create an invoice — ${(error.cause as Error)?.message ?? error.message}`;
            } else if (error instanceof PaymentFailedError) {
                // A VTXO the Ark server reports as "unregistered" is a stuck
                // capsule that blocks EVERY Ark send until it's cleared. The raw
                // error is the opaque tag "BarkError.Internal"; the real reason
                // lives in cause.inner.errorMessage. Detect it and show a clear,
                // blocking message instead of a useless 2s toast.
                // (Recovery action is TBD pending whether a batch-refresh can
                // evict such a VTXO; if it can't, this needs an SDK-level
                // vtxo-drop from Second.tech.)
                const cause: any = error.cause;
                const inner: string = cause?.inner?.errorMessage ?? cause?.message ?? '';
                if (/not spendable.*unregistered|state:\s*unregistered/i.test(inner)) {
                    Alert.alert(
                        'A capsule is stuck',
                        "One of your Bark capsules is in a state the Bark server won't spend, so payments from Bark keep failing. Try sending from a different wallet for now.",
                        [{ text: 'OK', style: 'default' }],
                        { cancelable: true },
                    );
                    setLoading(false);
                    return;
                }
                message = `${fromProvider?.displayName ?? swapFrom} payment failed, ${cause?.message ?? error.message}`;
            } else if (error instanceof LightningSwapError) {
                message = error.message;
            } else if (error instanceof Error) {
                message = error.message || fallback;
            }
            SimpleToast.show(message, SimpleToast.SHORT);
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

    /**
     * Render a wallet badge in the from→to direction strip. Uses the
     * provider's icon when available, falls back to the displayName as
     * text — matches SwapSheet's tile fallback so Ark (no logo) doesn't
     * render a broken Image.
     */
    const renderProviderBadge = (
        provider: LightningSwapProvider | null,
        fallbackId: LightningSwapProviderId,
        styleVariant: 'inline' | 'success',
    ) => {
        const boxStyle = styleVariant === 'success' ? styles.successServiceBox : styles.serviceBox;
        const logoStyle = styleVariant === 'success' ? styles.successLogo : styles.logo;
        const labelStyle = styleVariant === 'success' ? styles.successTextBadge : styles.textBadge;
        return (
            <View style={boxStyle}>
                {provider?.icon ? (
                    <Image source={provider.icon} style={logoStyle} />
                ) : (
                    <Text bold style={labelStyle}>{provider?.displayName ?? fallbackId}</Text>
                )}
            </View>
        );
    };

    if (success) {
        return (
            <ScreenLayout showToolbar isBackButton={false}>
                <Animated.View style={[styles.successContainer, { transform: [{ translateY: slideAnim }], opacity: fadeAnim }]}>
                    <Text semibold style={styles.successTitle}>Swap Sent ⚡</Text>
                    <Text semibold style={styles.successValue}>{swappedSats} sats</Text>
                    <Text semibold style={styles.successFiat}>{currency === 'EUR' ? '€' : '$'}{swappedFiat}</Text>
                    {feeSats !== null && feeSats > 0 && (
                        // Surface the realised network fee under the fiat
                        // line. Only providers that report it (Ark) reach
                        // this branch — custodial swaps just hide the row.
                        <Text style={styles.successFee}>
                            Network fee: {feeSats} sats{feeNote ? ` · ${feeNote}` : ''}
                        </Text>
                    )}
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
                        {renderProviderBadge(fromProvider, swapFrom, 'success')}
                        <Text style={styles.successArrow}>→</Text>
                        {renderProviderBadge(toProvider, sendTo, 'success')}
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
                <GradientInput isSats={isSats} walletInfo={{ matchedRate, currency }} sats={sats} setSats={setSats} usd={usd} />
                <View style={styles.directionRow}>
                    {renderProviderBadge(fromProvider, swapFrom, 'inline')}
                    <Text style={styles.arrow}>→</Text>
                    {renderProviderBadge(toProvider, sendTo, 'inline')}
                </View>
                {feeSats !== null && feeSats > 0 && (
                    // Pre-swap fee preview. Shown when the source rail's
                    // estimateFee() returned a value (Ark via the Bark SDK).
                    // Custodial sources skip this row entirely so the
                    // layout doesn't reserve empty space.
                    <Text style={styles.feePreview}>
                        Estimated network fee: {feeSats} sats{feeNote ? ` · ${feeNote}` : ''}
                    </Text>
                )}
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
                    matchedRate={matchedRate}
                    currency={currency}
                    colors_={[colors.pink.extralight, colors.pink.default]}
                    // Effective max = balance minus reserved fee headroom.
                    // Coinos/Strike keep the full balance (their estimate
                    // returns null → reserve=0). Ark deducts the routing
                    // fee so the keyboard's Max button stays within the
                    // SDK's "amount + fee ≤ spendable" constraint.
                    maxBalance={Math.max(0, Number(sourceBalance) - maxFeeReserve)}
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
    textBadge: {
        // Same vertical region as the logo so icon and text providers
        // sit at identical heights in the directionRow.
        height: 24,
        lineHeight: 24,
        fontSize: 16,
        color: '#FFFFFF',
        textAlign: 'center',
        minWidth: 60,
    },
    feePreview: {
        marginTop: 18,
        textAlign: 'center',
        color: '#AAAAAA',
        fontSize: 13,
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
    successTextBadge: {
        height: 30,
        lineHeight: 30,
        fontSize: 18,
        color: '#FFFFFF',
        textAlign: 'center',
        minWidth: 80,
    },
    successFee: {
        marginTop: 6,
        fontSize: 14,
        color: '#AAAAAA',
        textAlign: 'center',
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
