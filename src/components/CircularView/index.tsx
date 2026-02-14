import React from "react";
import { Image, TouchableOpacity, View } from "react-native";
import GradientView from "../GradientView";
import { Text } from "@Cypher/component-library";
import { shadow } from "@Cypher/style-guide";
import styles from "./styles";
import { CoinOSSmall, Refresh, Strike2 } from "@Cypher/assets/images";
import CircleTimer from "../CircleTimer";
import { dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { SATS, getStrikeCurrency, btc } from "@Cypher/helpers/coinosHelper";

interface Props {
    wallet: any;
    matchedRate: any;
    refRBSheet: any;
    refSendRBSheet: any;
    refSwapRBSheet?: any;
    setReceiveType: any;
    currency: any;
    balance: any;
    convertedRate: any;
}
export default function CircularView({ matchedRate, wallet, refRBSheet, refSendRBSheet, refSwapRBSheet, setReceiveType, currency, balance, convertedRate }: Props) {
    const { strikeUser, withdrawThreshold, reserveAmount, withdrawStrikeThreshold, reserveStrikeAmount } = useAuthStore();

    const strikeCurrencySymbol = getStrikeCurrency(strikeUser?.[1]?.currency || 'USD');
    const safeMatchedRate = Number(matchedRate) || 0;
    const strikeBtcSats = Math.round(Number(strikeUser?.[0]?.available || 0) * SATS);
    const strikeBtcFiatEquivalent = Number(strikeUser?.[0]?.available || 0) * safeMatchedRate;
    const checkingAccount = {
        first: {
            value: `${strikeBtcSats} sats`,
            convertedValue: `~ ${strikeCurrencySymbol}${strikeBtcFiatEquivalent.toFixed(2)}`,
            image: Strike2,
        },
        second: {
            value: `${balance || 0} sats`,
            convertedValue: `~  $${Number(convertedRate || 0).toFixed(2)}`,
            image: CoinOSSmall,
        }
    };

    const receiveClickHandler = (type: boolean) => {
        setReceiveType(type);
        refRBSheet.current.open();
    };

    const sendClickHandler = (walletType: boolean) => {
        refSendRBSheet.current.open();
        // dispatchNavigate('SendScreen', { currency, matchedRate, receiveType: walletType });
    };


    const clickHandler = (value: boolean) => {
        if (value) {
            // CoinOS
            dispatchNavigate('CheckingAccountNew', { wallet, matchedRate, receiveType: value, currency, balance, converted: convertedRate, withdrawThreshold, reserveAmount });
        } else {
            // Strike
            const strikeBalanceSats = Math.round(Number(strikeUser?.[0]?.available || 0) * SATS);
            const strikeConverted = Number(strikeUser?.[0]?.available || 0) * safeMatchedRate;
            dispatchNavigate('CheckingAccountNew', { wallet, matchedRate, receiveType: value, currency: strikeUser?.[1]?.currency || 'USD', balance: strikeBalanceSats, converted: strikeConverted, withdrawThreshold: withdrawStrikeThreshold, reserveAmount: reserveStrikeAmount });
        }
    }

    return <View style={{
        // backgroundColor:'red',
        // backgroundColor: 'green',
        marginBottom: 20
    }}>
        <View style={styles.circularView}>
            <TouchableOpacity onPress={() => clickHandler(false)} style={styles.circleContainer}>
                <CircleTimer type={"STRIKE"} progress={90} size={135} strokeWidth={7} {...checkingAccount.first} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => refSwapRBSheet?.current?.open()} style={styles.swapIcon}>
                <Image source={Refresh} style={{ width: 18, height: 29 }} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => clickHandler(true)} style={styles.circleContainer}>
                <CircleTimer type={"COINOS"} progress={0} size={135} strokeWidth={7}{...checkingAccount.second} />
            </TouchableOpacity>
        </View>
        <View style={styles.btnView}>
            <GradientView
                onPress={() => receiveClickHandler(true)}
                topShadowStyle={styles.outerShadowStyle}
                bottomShadowStyle={styles.innerShadowStyle}
                style={styles.linearGradientStyle}
                linearGradientStyle={styles.mainShadowStyle}
            >
                <Text h3 style={{ ...shadow.text25 }}>Receive</Text>
            </GradientView>
            {/* <GradientView
                topShadowStyle={styles.shadowTop2}
                bottomShadowStyle={styles.shadowBottom2}
                style={styles.refresh}
                linearGradientStyleMain={styles.refresh}
                isShadow
            >
                <Image source={Refresh} />
            </GradientView> */}
            <GradientView
                onPress={() => sendClickHandler(false)}
                topShadowStyle={styles.outerShadowStyle}
                bottomShadowStyle={styles.innerShadowStyle}
                style={styles.linearGradientStyle}
                linearGradientStyle={styles.mainShadowStyle}
            >
                <Text h3 style={{ ...shadow.text25 }}>Send</Text>
            </GradientView>
        </View>
    </View>
}
