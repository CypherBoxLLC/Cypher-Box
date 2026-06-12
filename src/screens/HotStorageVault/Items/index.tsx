import React from "react"
import { Image, StyleSheet, TouchableOpacity, View } from "react-native"
import { Shadow } from "react-native-neomorph-shadows"
import styles from "./styles"
import { Text } from "@Cypher/component-library";
import { Bitcoin, Socked } from "@Cypher/assets/images";
import { btc } from "@Cypher/helpers/coinosHelper";

interface CpfpChildInfo {
    childTxid: string;
    childFeeSats: number;
}

interface Props {
    wallet: any;
    item: any;
    matchedRate: any;
    vaultTab: boolean;
    onPressHandler(item: any): void;
    /**
     * If this parent tx has been fee-accelerated by a CPFP child, the
     * child's stats are passed in here. Drives the "⚡ Accelerated" badge
     * and the gating of further CPFP attempts on the detail screen.
     * `null` when no accelerator exists.
     */
    cpfpChildInfo?: CpfpChildInfo | null;
}

export default function Items({ wallet, item, matchedRate, vaultTab, onPressHandler, cpfpChildInfo }: Props) {
    const satsAmount = item.value.toString().replace('-', ''); // Adjusted for negative sign
    const BTCAmount = btc(satsAmount) + " BTC";
    const amountSign = item.value < 0 ? "-" : "+";
    const currency = btc(1);
    const dollarAmount = Number(satsAmount) * matchedRate * currency;

    console.log('item: ', item)
    return <TouchableOpacity style={styles.shadowView} onPress={() => onPressHandler(item)}>
        <Shadow
            style={styles.shadowTop}
            inner
            useArt
        >
            <View style={styles.inner}>
                <View style={styles.main}>
                    <View style={styles.imageView}>
                        <Image source={Bitcoin} style={styles.image} />
                    </View>
                    <Text bold h4 style={styles.des}>                    
                        {item.confirmations > 0
                        ? amountSign == '+'
                          ? "Received"
                          : "Sent"
                        : "Pending"}
                    </Text>
                    <Text h3 style={{ color: amountSign == '+' ? '#4FBF67' : '#FF7A68' }}>{amountSign+BTCAmount}</Text>
                    {/* <Text h3 style={{ color: item?.sats?.includes('+') ? '#4FBF67' : '#FF7A68' }}>{item?.sats}</Text> */}
                </View>
                <Text style={StyleSheet.flatten([styles.text, { color: amountSign == '+' ? '#4FBF67' : '#FF7A68' }])}>{'$'+dollarAmount.toFixed(2)}</Text>
                {cpfpChildInfo && (
                    <Text style={{ marginTop: 4, fontSize: 11, opacity: 0.75, color: '#FFD54F' }}>
                        {'⚡ Accelerated · +' + cpfpChildInfo.childFeeSats.toLocaleString() + ' sats fee'}
                    </Text>
                )}
                {/* <Text style={StyleSheet.flatten([styles.text, { color: item?.sats?.includes('+') ? '#4FBF67' : '#FF7A68' }])}>{item?.usd}</Text> */}
                <Shadow
                    inner
                    useArt
                    style={styles.shadowBottom}
                />
            </View>
        </Shadow>
    </TouchableOpacity>
}
