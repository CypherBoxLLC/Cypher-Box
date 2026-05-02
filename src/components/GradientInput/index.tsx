import React from "react";
import { View } from "react-native"
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
    walletInfo: any
    /**
     * Override the active border gradient (when sats is non-empty).
     * Empty-state gray is the same regardless. Used by Ark surfaces to
     * render the input border in yellow instead of pink.
     */
    colors_?: string[];
}

export default function GradientInput({
    sats,
    setSats,
    usd,
    isSats,
    walletInfo,
    colors_,
}: Props) {
    const activeColors = colors_ ?? [colors.pink.extralight, colors.pink.default];
    return (
        <View>
            <View style={styles.priceView}>
                <GradientCard style={styles.card} colors_={sats ? activeColors : [colors.gray.thin, colors.gray.thin2]}
                    linearStyle={styles.lGradient}>
                    <Input onChange={setSats}
                        value={sats}
                        keyboardType="number-pad"
                        editable={false}
                        textInputStyle={styles.input}
                    />
                </GradientCard>
                <Text style={isSats ? styles.btc : styles.dollar}>{`${isSats ? 'sats' : getStrikeCurrency(walletInfo?.currency || 'USD')}`}</Text>
            </View>
            {isSats ?
                <Text style={styles.inDollar}>{getStrikeCurrency(walletInfo?.currency || 'USD')}{usd}</Text>
                :
                <Text style={styles.inDollar}>{usd} sats</Text>
            }
        </View>
    )
}
