import { CoinOSSmall, Strike2 } from "@Cypher/assets/images";
import { Text } from "@Cypher/component-library";
import { calculateBalancePercentage, calculatePercentage, dispatchNavigate } from "@Cypher/helpers";
import { formatNumber } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";
import React from "react";
import { Image, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { Shadow } from "react-native-neomorph-shadows";
import GradientButtonWithShadow from "../GradientButtonWithShadow";
import styles from "./styles";
import useAuthStore from "@Cypher/stores/authStore";

interface Props {
    onPress?: (value: boolean) => void;
    title?: string;
    wallet?:string;
    balance: any;
    convertedRate: any;
    matchedRate: any;
    currency: any;
    withdrawThreshold: any;
    reserveAmount: any;
    isShowButtons?: boolean;
    receiveType?: boolean;
    receiveClickHandler?(value: boolean): void;
    sendClickHandler?(value: boolean): void;
}

export default function Card({ onPress,
    wallet,
    title = 'Lightning Account',
    balance,
    convertedRate,
    withdrawThreshold,
    reserveAmount,
    matchedRate,
    currency,
    receiveType,
    isShowButtons = false,
    receiveClickHandler,
    sendClickHandler,
}: Props) {
    const {coldStorageWalletID, walletID, allBTCWallets} = useAuthStore();

    const onCardClickHandler = () => {
        onPress?.(true);
    }

    const getBalance = () => {
        return `${balance} sats ~ $${convertedRate.toFixed(2)}`
    }

    const getSats = () => {
        return `${formatNumber(Number(withdrawThreshold) + Number(reserveAmount))} sats`
    }

    const getLineLeft = () => {
        return `${calculatePercentage(Number(withdrawThreshold), (Number(reserveAmount)))}%`
    }

    const getWidth = () => {
        return `${calculateBalancePercentage(Number(balance), Number(withdrawThreshold), Number(reserveAmount))}%`
    }
    console.log('allBTCWallets: ', allBTCWallets)

    const onReceiveClickHandler = () => {
        // if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
        //     dispatchNavigate('CreateInvoice', {
        //         matchedRate,
        //         currency,
        //         receiveType: true
        //     });
        // } else {
            receiveClickHandler?.(true);
        // }
    }

    const onSendClickHandler = () => {
        if(allBTCWallets.length == 1 && !coldStorageWalletID && !walletID) {
            dispatchNavigate('SendScreen', {
                matchedRate,
                currency,
                receiveType: true
            });
        } else {
            sendClickHandler?.(true);
        }
    }

    return (
        <View>
            <TouchableOpacity style={styles.shadowView} onPress={onCardClickHandler}>
                <Shadow
                    style={styles.shadowTop}
                    inner
                    useArt
                >
                    <View style={styles.view}>
                        <Text h2 bold style={styles.check}>
                            {title}
                        </Text>
                        <Image
                            source={receiveType ? CoinOSSmall : Strike2}
                            style={styles.blink}
                            resizeMode="contain"
                        />
                    </View>
                    <View style={styles.view}>
                        <Text h2 bold style={styles.sats}>
                            {getBalance()}
                        </Text>
                        <Text bold style={styles.totalsats}>
                            {getSats()}
                        </Text>
                    </View>
                    <View>
                        <View style={styles.showLine} />
                        <View style={[styles.box, { left: getLineLeft() } as any]} />
                        <LinearGradient
                            start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                            colors={[colors.white, colors.pink.dark]}
                            style={[styles.linearGradient2, { width: getWidth() } as any]}>
                        </LinearGradient>
                    </View>
                    <Shadow
                        inner
                        useArt
                        style={styles.shadowBottom}
                    />
                </Shadow>
            </TouchableOpacity>
            {isShowButtons &&
                <View style={styles.btnView}>
                    <GradientButtonWithShadow
                        title="Receive"
                        onPress={onReceiveClickHandler}
                        isShadow
                        isTextShadow
                    />
                    <GradientButtonWithShadow
                        title="Send"
                        onPress={onSendClickHandler}
                        isShadow
                        isTextShadow
                    />
                </View>
            }
        </View>
    )

}