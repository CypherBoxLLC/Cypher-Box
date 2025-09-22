import React from "react"
import { Image, StyleSheet, TouchableOpacity, View } from "react-native"
import { Shadow } from "react-native-neomorph-shadows"
import styles from "./styles"
import { Text } from "@Cypher/component-library";
import { Bitcoin, LiquidBitCoin, Socked } from "@Cypher/assets/images";
import { btc, getStrikeCurrency } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";

interface Props {
    matchedRate: number
    currency: any;
    item: any;
    receiveType: boolean;
    onPressHandler(item: any): void;
}

export default function Items({ matchedRate, currency, receiveType, item, onPressHandler }: Props) {

    const BTCToSats = receiveType ? 0 : (Number(item.amount?.amount) * 100000000).toFixed(2);
    const satsAmount = receiveType ? item.amount.toString().replace('-', '') : BTCToSats.toString().replace('-', ''); // Adjusted for negative sign
    const amountSign = receiveType ? item.amount < 0 ? "-" : "+" : Number(BTCToSats) < 0 ? "-" : "+";
    const currencyBTC = btc(1);
    const dollarAmount = satsAmount * matchedRate * currencyBTC;

    const textColor = {
      color: item.amount < 0 ? colors.red : colors.green,
    };

    return <TouchableOpacity disabled={receiveType ? false : true} style={styles.shadowView} onPress={() => onPressHandler(item)}>
        <Shadow
            style={styles.shadowTop}
            inner
            useArt
        >
            <View style={styles.inner}>
                <View style={styles.main}>
                    <View style={styles.imageView}>
                        {item?.type === 'bitcoin' ?
                            <Image source={Bitcoin} />
                            : item?.type === 'liquid' ?
                                <Image source={LiquidBitCoin} />
                            :
                                <Image source={Socked} style={styles.image} />
                        }
                    </View>
                    {receiveType ? 
                        <Text bold style={styles.des}>
                            {item.amount > 0
                                ? item.confirmed
                                ? "Received"
                                : "Pending"
                                : "Sent"}
                        </Text>
                    :
                        <Text bold style={styles.des}>
                            {item.amount?.amount > 0
                                ? item.state === "UNPAID" ? "Pending"
                                : item.state === "PAID" ? "Received"
                                : item.state === "PENDING" ? "Pending"
                                : "Cancelled" : ""
                            }
                        </Text>
                    }
                    <Text h3 style={{ color: amountSign == '+' ? '#4FBF67' : '#FF7A68' }}>{amountSign+satsAmount} sats</Text>
                </View>
                <Text style={StyleSheet.flatten([styles.text, { color: amountSign == '+' ? '#4FBF67' : '#FF7A68' }])}>{getStrikeCurrency(currency)}{amountSign+dollarAmount.toFixed(2)}</Text>
                <Shadow
                    inner
                    useArt
                    style={styles.shadowBottom}
                />
            </View>
        </Shadow>
    </TouchableOpacity>
}