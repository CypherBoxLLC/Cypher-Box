import { Text } from "@Cypher/component-library";
import { GradientButtonWithShadow, GradientCardWithShadow, StrikeSignupSheet, type StrikeSignupSheetRef } from "@Cypher/components";
import { calculateBalancePercentage, calculatePercentage, dispatchNavigate } from "@Cypher/helpers";
import { formatNumber, formatSats, getStrikeCurrency, SATS } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import React, { useContext, useRef } from "react";
import { Image, StyleSheet, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "./styles";
import { CarouselPageVisibilityContext, useEasedProgress } from "@Cypher/custom-hooks";
import { useIsFocused } from "@react-navigation/native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";


interface Props {
    isLoading: boolean;
    matchedRateStrike: any;
    strikeConvertedBalance?: any;
    currency: any;
    convertedRate?: any;
    wallet?: any;
    refRBSheet: any;
    refSendRBSheet: any;
    setReceiveType: any;
    strikeBalance: any;
    homeMessage?: string | null;
    hideActionButtons?: boolean;
}

// The Strike OAuth config that used to live here has been removed along with
// the in-app token exchange it fed. Strike's `cypherbox` client is
// confidential: the OAuth relay authenticates with a real client_secret, so an
// exchange performed in the app with an empty secret could never succeed. This
// screen's login now routes to CheckingAccountLogin, which owns the single
// working flow (skipCodeExchange, code exchanged by the relay).

export default function StrikeWallet({
    isLoading,
    matchedRateStrike,
    strikeConvertedBalance,
    currency,
    wallet,
    refRBSheet,
    convertedRate,
    refSendRBSheet,
    setReceiveType,
    strikeBalance,
    homeMessage,
    hideActionButtons = false,
}: Props) {
    const { isStrikeAuth, isArkAuth, isAuth, withdrawStrikeThreshold, reserveStrikeAmount, strikeUser, coldStorageWalletID, walletID, allBTCWallets } = useAuthStore();
    const strikeSignupSheetRef = useRef<StrikeSignupSheetRef>(null);

    // Strike + Ark (no CoinOS): the Strike Lightning card sits a bit
    // too high in the carousel slot for this combination. Bump it down
    // 10pt to realign — 18pt was overshoot ("too much down" per Bam).
    // Other combos (Strike-only, Strike+CoinOS, Strike+CoinOS+Ark) keep
    // their original position.
    const strikeAndArkOnly = isStrikeAuth && isArkAuth && !isAuth;

    const receiveClickHandler = (type: boolean) => {
        setReceiveType(type);
        refRBSheet.current.open();
    };

    const sendClickHandler = (walletType: boolean) => {
        const safeCurrency = (currency && /^[A-Z]{3}$/.test(currency)) ? currency : 'USD';
        if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
            dispatchNavigate('SendScreen', { currency: safeCurrency, matchedRateStrike, receiveType: false });
        } else {
            setReceiveType(walletType);
            refSendRBSheet.current.open();
        }
    };

    const hasFilledTheBar = calculateBalancePercentage(Number(strikeBalance), Number(withdrawStrikeThreshold), Number(reserveStrikeAmount)) === 100

    // Eased fill for the threshold bar (mirrors Card): plays only while
    // visible, holds while unseen so the sweep replays on arrival.
    const cardPageVisible = useContext(CarouselPageVisibilityContext);
    const cardFocused = useIsFocused();
    const fillPct = calculateBalancePercentage(Number(strikeBalance), Number(withdrawStrikeThreshold), Number(reserveStrikeAmount));
    const fillAnim = useEasedProgress(fillPct, cardPageVisible && cardFocused);
    const fillStyle = useAnimatedStyle(() => ({
        width: `${Math.min(Math.max(fillAnim.value, 0), 100)}%`,
    }));

    const checkingAccountClickHandler = (walletType: boolean) => {
        const safeCurrency = (currency && /^[A-Z]{3}$/.test(currency)) ? currency : 'USD';
        dispatchNavigate('CheckingAccountNew', { wallet: wallet, matchedRate: matchedRateStrike, receiveType: false, balance: Math.round(Number(strikeUser?.[0]?.available || 0) * SATS), converted: (Number(strikeUser?.[0]?.available || 0) * (matchedRateStrike || 0)).toFixed(2), currency: safeCurrency, reserveAmount: Number(reserveStrikeAmount), withdrawThreshold: Number(withdrawStrikeThreshold) });
    }

    // Send the user to the one working Strike login. This used to run its own
    // authorize() and exchange the code in-app, which always failed against a
    // confidential client and reported nothing to the user beyond a console
    // line, so the button appeared to do nothing at all.
    const handleStrikeLogin = () => {
        dispatchNavigate('CheckingAccountLogin');
    };

    const createStrikeAccountClickHandler = () => {
        strikeSignupSheetRef.current?.open()
    };

    return (
        <>
            {isStrikeAuth &&
                <View style={strikeAndArkOnly ? { transform: [{ translateY: 10 }] } : undefined}>
                    <TouchableOpacity style={styles.shadowView} onPress={() => checkingAccountClickHandler(false)}>
                        {/* Pink-gradient ring (1.5px) wraps the Strike card —
                            same treatment applied to CoinOS in Card/index.tsx
                            so both custodial Lightning rails share visual
                            identity. The inner View paints the card surface
                            (colors.primary) inside the ring. */}
                        <LinearGradient
                            colors={[colors.pink.gradient1, colors.pink.gradient2]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.shadowTopGradientOutline}
                        >
                            <View style={styles.shadowTopInner}>
                                {/* Translucent lightning watermark — same
                                    treatment as the Card component (CoinOS,
                                    Ark) and the home Unlock Lightning Wallet
                                    CTA, so all Lightning surfaces share one
                                    visual motif. */}
                                <Image
                                    source={require("@Cypher/assets/images/electricity.png")}
                                    style={{
                                        position: 'absolute',
                                        alignSelf: 'center',
                                        top: '50%',
                                        marginTop: -42,
                                        width: 60,
                                        height: 84,
                                        tintColor: '#FFFFFF',
                                        opacity: 0.10,
                                    }}
                                    resizeMode="contain"
                                    pointerEvents="none"
                                />
                                <View style={styles.view}>
                                    <Text h2 bold style={[styles.check, { fontSize: 16 }]}>
                                        Lightning Account
                                    </Text>
                                    <Image
                                        source={require("@Cypher/assets/images/strike.png")}
                                        style={[styles.blink, { width: 100, height: 28, marginTop: 0, marginBottom: 10 }]}
                                        resizeMode="contain"
                                    />
                                </View>
                                <View style={styles.view}>
                                    <Text h2 bold style={styles.sats}>
                                        {`${formatSats(Math.round(Number(strikeUser?.[0]?.available || 0) * SATS))} sats ~ ${getStrikeCurrency(currency || strikeUser?.[1]?.currency || 'USD')}${(Number(strikeConvertedBalance) || (Number(strikeUser?.[0]?.available || 0) * (Number(matchedRateStrike) || 0))).toFixed(2)}`}
                                    </Text>
                                    <Text bold style={styles.totalsats}>
                                        {formatNumber(Number(withdrawStrikeThreshold) + Number(reserveStrikeAmount))} sats
                                    </Text>
                                </View>
                                {/* Reserve a 25pt slot for the threshold-bar
                                    trio. All three children are absolutely
                                    positioned (see styles.showLine /
                                    linearGradient2 / box), so without an
                                    explicit height this parent collapses to
                                    0 and the bars float over the balance
                                    row above. */}
                                <View style={{ height: 25 }}>
                                    <View style={styles.showLine} />
                                    <View style={[styles.box, { left: `${calculatePercentage(Number(withdrawStrikeThreshold), (Number(reserveStrikeAmount)))}%` }]} />
                                    {/* LinearGradient wrapped in an absolute
                                        View. Under RN 0.77 Fabric the paper-
                                        only react-native-linear-gradient@2.8.3
                                        view doesn't honor position:absolute
                                        through the legacy interop layer — pink
                                        rendered but was offset / clipped /
                                        invisible. Wrapping in a Fabric-native
                                        View handles positioning; LinearGradient
                                        just fills its parent as a flex child.
                                        Inner copy of the CheckingAccountNew
                                        screen renders the same bar fine because
                                        its parent layout doesn't depend on
                                        absolute positioning. */}
                                    {/* Solid pink fill, no LinearGradient. The
                                        original white→pink gradient stopped
                                        rendering under RN 0.77 Fabric/Paper
                                        interop when wrapped in a percent-width
                                        absolute parent (LinearGradient with
                                        absoluteFill inside the wrapper drew
                                        nothing). Solid color renders reliably
                                        and the visual result is cleaner. The
                                        `minWidth: 6` guarantees a visible
                                        sliver of pink for any non-zero balance,
                                        so users see "yes, balance is loading
                                        toward the threshold" even at <1%. */}
                                    <Reanimated.View style={[styles.linearGradient2, { backgroundColor: colors.pink.dark, minWidth: fillPct > 0 ? 6 : 0 } as any, fillStyle]} />
                                </View>
                            </View>
                        </LinearGradient>
                    </TouchableOpacity>
                    {!hideActionButtons && (
                        <View style={styles.btnView}>
                            <GradientButtonWithShadow
                                title="Receive"
                                onPress={() => receiveClickHandler(true)}
                                isShadow
                                isTextShadow
                            />
                            <GradientButtonWithShadow
                                title="Send"
                                onPress={() => sendClickHandler(false)}
                                isShadow
                                isTextShadow
                            />
                        </View>
                    )}
                    {/* When shared buttons are active (`hideActionButtons`),
                        skip this minHeight-40 reserve so the shared row can
                        sit flush below the card. Otherwise it left a 40px
                        gap that Bam called "way below". */}
                    {!hideActionButtons && (
                        <View style={{ minHeight: 40, justifyContent: 'center' }}>
                            {!isLoading && homeMessage &&
                                <Text h4 style={styles.alert}>
                                    {homeMessage}
                                </Text>
                            }
                        </View>
                    )}
                </View>
            }

            {!isStrikeAuth &&
                <View>
                    <GradientCardWithShadow
                        style={styles.createView}
                        onPress={handleStrikeLogin}
                    >
                        <View style={styles.middle}>
                            <Image
                                style={styles.arrow}
                                resizeMode="contain"
                                source={require("../../../img/arrow-right.png")}
                            />
                            <Text h2 style={styles.shadow} center>
                                Login to Your Strike Account
                            </Text>
                        </View>
                    </GradientCardWithShadow>
                    <View style={styles.createAccount}>
                        <Text bold style={styles.text}>
                            Don't have an account?
                        </Text>
                        <TouchableOpacity onPress={createStrikeAccountClickHandler}>
                            <Text bold style={styles.login}>
                                Create on Strike
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            }
            <StrikeSignupSheet ref={strikeSignupSheetRef} />
        </>
    )
}
