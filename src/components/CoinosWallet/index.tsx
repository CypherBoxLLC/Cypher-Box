import { Text } from "@Cypher/component-library";
import { Card, GradientCardWithShadow } from "@Cypher/components";
import { calculateBalancePercentage, dispatchNavigate } from "@Cypher/helpers";
import useAuthStore from "@Cypher/stores/authStore";
import { SATS } from "@Cypher/helpers/coinosHelper";
import React from "react";
import { Image, Linking, TouchableOpacity, View } from "react-native";
import styles from "./styles";

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
}: Props) {
    const { isAuth, withdrawThreshold, reserveAmount, clearAuth, walletID, coldStorageWalletID, isStrikeAuth, strikeUser, withdrawStrikeThreshold, reserveStrikeAmount } = useAuthStore();

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
        Linking.openURL('https://coinos.io/register')
        // dispatchNavigate("CheckAccount");
    };

    return (
        <>
            {isAuth &&
                <>
                    <Card
                        balance={balance}
                        convertedRate={convertedRate}
                        receiveType={true}
                        reserveAmount={reserveAmount}
                        withdrawThreshold={withdrawThreshold}
                        onPress={checkingAccountClickHandler}
                        isShowButtons
                        matchedRate={matchedRate}
                        currency={currency}
                        receiveClickHandler={receiveClickHandler}
                        sendClickHandler={sendClickHandler}
                    />
                    <View style={{ minHeight: 90, justifyContent: 'center' }}>
                        {!isLoading && hasFilledTheBar && (walletID || coldStorageWalletID) &&
                            <Text h4 style={styles.alert}>
                                Your balance is large enough to withdraw to self-custody!
                            </Text>
                        }
                    </View>
                </>
            }

            {!isAuth &&
                // <View style={{ height: '42%' }}>
                <View>
                    <GradientCardWithShadow
                        style={styles.createView}
                        onPress={loginClickHandler}
                    >
                        <View style={styles.middle}>
                            <Image
                                style={styles.arrow}
                                resizeMode="contain"
                                source={require("../../../img/arrow-right.png")}
                            />
                            <Text h2 style={styles.shadow} center>
                                Login to Your Lightning Account
                            </Text>
                        </View>
                    </GradientCardWithShadow>
                    <View style={styles.createAccount}>
                        <Text bold style={styles.text}>
                            Don’t have an account?
                        </Text>
                        <TouchableOpacity onPress={createChekingAccountClickHandler}>
                            <Text bold style={styles.login}>
                                Create on Coinos.io
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            }
        </>
    )
}
