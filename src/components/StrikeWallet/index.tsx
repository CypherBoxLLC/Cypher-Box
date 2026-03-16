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
import { Shadow } from "react-native-neomorph-shadows";
import styles from "./styles";


interface Props {
    isLoading: boolean;
    matchedRate: any;
    currency: any;
    convertedRate: any;
    wallet: any;
    refRBSheet: any;
    refSendRBSheet: any;
    setReceiveType: any;
    strikeBalance: any;
    homeMessage?: string | null;
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
    matchedRate,
    currency,
    wallet,
    refRBSheet,
    convertedRate,
    refSendRBSheet,
    setReceiveType,
    strikeBalance,
    homeMessage,
}: Props) {
    const { isStrikeAuth, withdrawStrikeThreshold, reserveStrikeAmount, strikeUser, coldStorageWalletID, walletID, setStrikeToken, setStrikeAuth, allBTCWallets } = useAuthStore();

    const receiveClickHandler = (type: boolean) => {
        // dispatchNavigate('CheckingAccountNew', { wallet: wallet, matchedRate });
        // if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
        //     dispatchNavigate('CreateInvoice', {
        //         matchedRate,
        //         currency,
        //         receiveType: false
        //     });
        // } else {
            setReceiveType(type);
            refRBSheet.current.open();
        // }
    };

    const sendClickHandler = (walletType: boolean) => {
        const safeCurrency = (currency && /^[A-Z]{3}$/.test(currency)) ? currency : 'USD';
        if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
            dispatchNavigate('SendScreen', { currency: safeCurrency, matchedRate, receiveType: false });
        } else {
            setReceiveType(walletType);
            refSendRBSheet.current.open();
        }
    };

    const hasFilledTheBar = calculateBalancePercentage(Number(strikeBalance), Number(withdrawStrikeThreshold), Number(reserveStrikeAmount)) === 100

    const checkingAccountClickHandler = (walletType: boolean) => {
        const safeCurrency = (currency && /^[A-Z]{3}$/.test(currency)) ? currency : 'USD';
        dispatchNavigate('CheckingAccountNew', { wallet: wallet, matchedRate, receiveType: false, balance: Math.round(Number(strikeUser?.[0]?.available || 0) * SATS), converted: (Number(strikeUser?.[0]?.available || 0) * (matchedRate || 0)).toFixed(2), currency: safeCurrency, reserveAmount: Number(reserveStrikeAmount), withdrawThreshold: Number(withdrawStrikeThreshold) });
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
        // dispatchNavigate("CheckAccount");
    };

    return (
        <>
            {isStrikeAuth &&
                // <View style={{ height: '42%' }}>
                <View>
                    <TouchableOpacity style={styles.shadowView} onPress={() => checkingAccountClickHandler(false)}>
                        <Shadow
                            style={StyleSheet.flatten([styles.shadowTop, { shadowColor: colors.pink.shadowTop, padding: 0 }])}
                            inner
                            useArt
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
                                    {`${Math.round(Number(strikeUser?.[0]?.available || 0) * SATS)} sats ~ ${getStrikeCurrency(currency || strikeUser?.[1]?.currency || 'USD')}${(Number(strikeUser?.[0]?.available || 0) * (Number(matchedRate) || 0)).toFixed(2)}`}
                                    {/* {strikeUser && strikeUser[0]?.available || 0} sats ~ {"$" + convertedRate.toFixed(2)} */}
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
                                    {/* <View style={[styles.box, {marginLeft: `${Math.min((withdrawThreshold / (Number(withdrawThreshold + reserveAmount) || 0)) * 100, 100)}%`}]} /> */}
                                    {/* <Shadow
                            inner // <- enable inner shadow
                            useArt // <- set this prop to use non-native shadow on ios
                            style={styles.top2} >
                        </Shadow> */}
                                </LinearGradient>

                                {/* <View style={styles.showLine} /> */}
                                {/* <View style={[styles.box, {marginLeft: `${Math.min((balance / (Number(withdrawThreshold) || 0)) * 100, 100)}%`}]} />
                      </View> */}
                            </View>
                            <Shadow
                                inner
                                useArt
                                style={StyleSheet.flatten([styles.shadowBottom, { shadowColor: colors.pink.shadowBottom }])}
                            />
                        </Shadow>
                    </TouchableOpacity>
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
                    <View style={{ minHeight: 40, justifyContent: 'center' }}>
                        {!isLoading && homeMessage &&
                            <Text h4 style={styles.alert}>
                                {homeMessage}
                            </Text>
                        }
                    </View>
                </View>
            }

            {!isStrikeAuth &&
                // <View style={{ height: '42%' }}>
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
                            Don’t have an account?
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
