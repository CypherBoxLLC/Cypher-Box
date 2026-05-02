import { Text } from "@Cypher/component-library";
import { GradientButtonWithShadow, GradientCardWithShadow } from "@Cypher/components";
import { calculateBalancePercentage, calculatePercentage, dispatchNavigate } from "@Cypher/helpers";
import { formatNumber, getStrikeCurrency, SATS } from "@Cypher/helpers/coinosHelper";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import React from "react";
import { Image, Linking, StyleSheet, TouchableOpacity, View } from "react-native";
import { authorize } from "react-native-app-auth";
import LinearGradient from "react-native-linear-gradient";
import styles from "./styles";


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

const config = {
    id: 'strike',
    name: 'Strike',
    type: 'oauth',
    issuer: "https://auth.strike.me", // Strike Identity Server URL
    clientId: "cypherbox",
    clientSecret: "", // DO NOT hardcode secrets in client-side code
    redirectUrl: "cypherbox://oauth/callback", // Must match the redirect URI in your Strike app settings
    scopes: ["offline_access", "partner.balances.read", "partner.currency-exchange-quote.read", "partner.account.profile.read", "profile", "openid", "partner.invoice.read", "partner.invoice.create", "partner.invoice.quote.generate", "partner.invoice.quote.read", "partner.rates.ticker"], // Specify necessary scopes
    //clientAuthMethod: "post",
    //wellKnown: `https://auth.strike.me/.well-known/openid-configuration`,
    // authorization: {
    //     params: {
    //         scope: 'partner.invoice.read offline_access',
    //         response_type: 'code',
    //     }
    // },
    idToken: false,
    checks: ['pkce', 'state'],
    // serviceConfiguration: {
    //   authorizationEndpoint: "https://auth.strike.me/oauth/authorize",
    //   tokenEndpoint: "https://auth.strike.me/oauth/token",
    //   revocationEndpoint: "https://auth.strike.me/oauth/revoke",
    // },
};

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
    const { isStrikeAuth, withdrawStrikeThreshold, reserveStrikeAmount, strikeUser, coldStorageWalletID, walletID, setStrikeToken, setStrikeAuth, allBTCWallets } = useAuthStore();

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

    const checkingAccountClickHandler = (walletType: boolean) => {
        const safeCurrency = (currency && /^[A-Z]{3}$/.test(currency)) ? currency : 'USD';
        dispatchNavigate('CheckingAccountNew', { wallet: wallet, matchedRate: matchedRateStrike, receiveType: false, balance: Math.round(Number(strikeUser?.[0]?.available || 0) * SATS), converted: (Number(strikeUser?.[0]?.available || 0) * (matchedRateStrike || 0)).toFixed(2), currency: safeCurrency, reserveAmount: Number(reserveStrikeAmount), withdrawThreshold: Number(withdrawStrikeThreshold) });
    }

    const handleStrikeLogin = async () => {
        try {
            const result = await authorize(config);
            setStrikeToken(result.accessToken);
            setStrikeAuth(true);
        } catch (error) {
            console.error("OAuth error", error);
        } finally {
            //   setIsLoading(false)
        }
    };

    const createStrikeAccountClickHandler = () => {
        Linking.openURL('https://dashboard.strike.me/signup')
    };

    return (
        <>
            {isStrikeAuth &&
                <View>
                    <TouchableOpacity style={styles.shadowView} onPress={() => checkingAccountClickHandler(false)}>
                        <View
                            style={StyleSheet.flatten([styles.shadowTop, { shadowColor: colors.pink.shadowTop, padding: 0 }])}
                        >
                            <View style={styles.view}>
                                <Text h2 bold style={styles.check}>
                                    Lightning Account
                                </Text>
                                <Image
                                    source={require("../../../img/Strike.png")}
                                    style={styles.blink}
                                    resizeMode="contain"
                                />
                            </View>
                            <View style={styles.view}>
                                <Text h2 bold style={styles.sats}>
                                    {`${Math.round(Number(strikeUser?.[0]?.available || 0) * SATS)} sats ~ ${getStrikeCurrency(currency || strikeUser?.[1]?.currency || 'USD')}${(Number(strikeConvertedBalance) || (Number(strikeUser?.[0]?.available || 0) * (Number(matchedRateStrike) || 0))).toFixed(2)}`}
                                </Text>
                                <Text bold style={styles.totalsats}>
                                    {formatNumber(Number(withdrawStrikeThreshold) + Number(reserveStrikeAmount))} sats
                                </Text>
                            </View>
                            <View>
                                <View style={styles.showLine} />
                                <View style={[styles.box, { left: `${calculatePercentage(Number(withdrawStrikeThreshold), (Number(reserveStrikeAmount)))}%` }]} />
                                <LinearGradient
                                    start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                                    colors={[colors.white, colors.pink.dark]}
                                    style={[styles.linearGradient2, { width: `${calculateBalancePercentage(Number(strikeBalance), Number(withdrawStrikeThreshold), Number(reserveStrikeAmount))}%` }]}>
                                </LinearGradient>
                            </View>
                        </View>
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
        </>
    )
}
