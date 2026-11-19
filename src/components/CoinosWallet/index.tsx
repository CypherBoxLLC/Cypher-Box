import { Text } from "@Cypher/component-library";
import { Card, GradientCardWithShadow } from "@Cypher/components";
import { calculateBalancePercentage, dispatchNavigate, openInAppBrowser } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { isCoinosAllowed } from "@Cypher/services/featureFlags";
import { rtl } from "@Cypher/style-guide";
import useRegionGate from "@Cypher/custom-hooks/useRegionGate";
import HomeNotices from "@Cypher/components/HomeNotices";
import type { HomeNotice } from "@Cypher/services/homeNotices";
import React from "react";
import { Image, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import loc from "../../../loc";

interface Props {
    balance: any;
    wallet: any;
    isLoading: boolean;
    matchedRate: any;
    currency: any;
    convertedRate: any;
    refRBSheet: any;
    refSendRBSheet: any;
    setReceiveType: any;
    /** The tip HomeScreen picks (getHomeNotice), drawn as a notice icon. */
    homeNotice?: HomeNotice | null;
    hideActionButtons?: boolean;
}

export default function CoinosWallet({
    balance,
    wallet,
    isLoading,
    matchedRate,
    currency,
    convertedRate,
    refRBSheet,
    refSendRBSheet,
    setReceiveType,
    homeNotice = null,
    hideActionButtons = false,
}: Props) {
    const { isAuth, withdrawThreshold, reserveAmount, clearAuth } = useAuthStore();

    /**
     * EEA storefronts: CoinOS has no MiCA authorisation, so every way of
     * moving funds through it is withdrawn. See services/featureFlags.
     *
     * A user who connected before this build keeps `isAuth === true`, so
     * the card still renders and still shows their balance. It just goes
     * read-only: no send, no receive, and tapping it no longer opens the
     * account screen (which carries its own send/receive surface).
     * Removing the card outright would read as "Cypher Box lost my
     * money" for a balance that is, and always was, held by CoinOS.
     */
    // Re-render when the App Store storefront resolves after launch.
    useRegionGate();
    const coinosAllowed = isCoinosAllowed();

    const receiveClickHandler = (type: boolean) => {
        if(type){
            setReceiveType(type);
            refRBSheet.current.open();
        }else {
            dispatchNavigate('CheckingAccountNew', { wallet: wallet, matchedRate });
        }
    };

    const sendClickHandler = (walletType: boolean) => {
        refSendRBSheet.current.open();
        // dispatchNavigate('SendScreen', { currency, matchedRate, receiveType: walletType });
    };

    const hasFilledTheBar = calculateBalancePercentage(Number(balance), Number(withdrawThreshold), Number(reserveAmount)) === 100

    const checkingAccountClickHandler = (walletType: boolean) => {
        // dispatchNavigate('CheckingAccount', { matchedRate, receiveType: walletType });
        dispatchNavigate('CheckingAccountNew', { wallet: wallet, matchedRate, receiveType: true, balance, converted: convertedRate, currency, reserveAmount, withdrawThreshold });
    }

    const loginClickHandler = () => {
        // dispatchNavigate('LoginCoinOSScreen');
        dispatchNavigate('CheckingAccountIntro');
    };

    const createChekingAccountClickHandler = () => {
        openInAppBrowser('https://coinos.io/register')
        // dispatchNavigate("CheckAccount");
    };

    // CoinOS is not offered in this region (services/featureFlags): a green
    // note, which stays ignored for as long as that is true.
    const regionNotice: HomeNotice | null = coinosAllowed ? null : {
        id: 'coinos-region',
        severity: 'green',
        icon: 'globe-outline',
        situation: 'unavailable',
        text: loc.cypherbox.components.coinos_wallet.region_unavailable,
    };

    return (
        <>
            {isAuth &&
                <>
                    <Card
                        hideWithBalances
                        balance={balance}
                        convertedRate={convertedRate}
                        reserveAmount={reserveAmount}
                        withdrawThreshold={withdrawThreshold}
                        onPress={coinosAllowed ? checkingAccountClickHandler : () => {}}
                        isShowButtons
                        hideActionButtons={hideActionButtons || !coinosAllowed}
                        matchedRate={matchedRate}
                        currency={currency}
                        receiveClickHandler={receiveClickHandler}
                        sendClickHandler={sendClickHandler}
                    />
                    {/* With the shared Receive/Send row the card has no notice
                        row of its own, so the region note sits under the card. */}
                    {hideActionButtons && regionNotice && (
                        <HomeNotices style={{ paddingTop: 10 }} notices={[regionNotice]} />
                    )}
                    {/* When shared buttons are active (`hideActionButtons`),
                        skip this minHeight-40 reserve so the shared row can
                        sit flush below the card. Otherwise it left a 40px
                        gap that Bam called "way below". */}
                    {!hideActionButtons && (
                        <View style={{ minHeight: 40, justifyContent: 'center' }}>
                            <HomeNotices notices={[regionNotice, isLoading ? null : homeNotice]} />
                        </View>
                    )}
                </>
            }

            {!isAuth && coinosAllowed &&
                // <View style={{ height: '42%' }}>
                <View>
                    <GradientCardWithShadow
                        style={styles.createView}
                        onPress={loginClickHandler}
                    >
                        <View style={styles.middle}>
                            <Image
                                style={[styles.arrow, rtl.mirror]}
                                resizeMode="contain"
                                source={require("../../../img/arrow-right.png")}
                            />
                            <Text h2 style={styles.shadow} center>
                                {loc.cypherbox.components.coinos_wallet.login_to_lightning_account}
                            </Text>
                        </View>
                    </GradientCardWithShadow>
                    <View style={styles.createAccount}>
                        <Text bold style={styles.text}>
                            {loc.cypherbox.components.coinos_wallet.no_account}
                        </Text>
                        <TouchableOpacity onPress={createChekingAccountClickHandler}>
                            <Text bold style={styles.login}>
                                {loc.cypherbox.components.coinos_wallet.create_on_coinos}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            }
        </>
    )
}
