import React from "react";
import { View } from "react-native";
import GradientCard from "../GradientCard";
import styles from "./styles";
import { colors } from "@Cypher/style-guide";
import { Input, Text } from "@Cypher/component-library";
import { getStrikeCurrency } from "@Cypher/helpers/coinosHelper";

interface Props {
    sats: string;
    setSats(val: string): void;
    usd: string;
    isSats: boolean;
    title?: string;
    _colors?: string[];
    isFeeesRate?: boolean;
    showTitle?: boolean;
    currency?: string
}

const GradientInputNew = ({
    sats,
    setSats,
    _colors,
    usd,
    isSats,
    title,
    isFeeesRate = false,
    showTitle = true,
    currency
}: Props) => {
    const gradientColors = sats ? _colors : [colors.gray.thin, colors.gray.thin2];

    return (
        <View style={styles.container}>
            <View style={styles.priceView}>
                {showTitle &&
                    <Text center style={styles.amount}>{title || 'Amount'}</Text>
                }
                <GradientCard style={styles.card} colors_={gradientColors} linearStyle={styles.lGradient}>
                    <Input
                        onChange={setSats}
                        value={sats}
                        keyboardType="number-pad"
                        editable={false}
                        textInputStyle={styles.input}
                    />
                </GradientCard>
                {!isFeeesRate && (
                    <Text
                        style={isSats ? styles.dollar : styles.btc}
                    >
                        {isSats ? title ? 'BTC' : 'sats' : getStrikeCurrency(currency || 'USD')}
                    </Text>
                )}
            </View>
            {isFeeesRate ? (
                <View style={styles.feesView}>
                    {/* <View style={{ alignItems: 'center' }}>
                        <Text style={styles.sats}>sats/vb</Text>
                        <Text center style={styles.netfee}>
                            Network fee: {'\n'}~ 20000 sats (~$39){'\n'}~(0.2%)
                        </Text>
                    </View>
                    <Text bold style={styles.tips}>Tip: The more bars and coins you select, the higher the network fees</Text> */}
                </View>
            ) : (
                <Text style={styles.inDollar}>{isSats ? `${getStrikeCurrency(currency || 'USD')}${usd}` : title ? `${usd} BTC` : `${usd} sats`}</Text>
            )}
        </View>
    );
};

export default GradientInputNew;
