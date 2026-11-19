import React from "react";
import { View } from "react-native";
import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton, } from "@Cypher/components";
import Description from "./Description";
import { Shadow } from "react-native-neomorph-shadows";
import LinearGradient from "react-native-linear-gradient";
import { colors } from "@Cypher/style-guide";
import loc from "../../../loc";

interface Props {
    navigation: any;
}

export default function ThresholdAdjust({navigation}:Props) {

    return (
        <ScreenLayout isBackButton={false} showToolbar title={loc.cypherbox.vault.threshold_adjust.title}>
            <View style={styles.container}>
                <LinearGradient
                    start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                    colors={[colors.white, colors.pink.dark]}
                    style={styles.linearGradient2}>
                    <View style={styles.box} />
                    <Shadow
                        inner // <- enable inner shadow
                        useArt // <- set this prop to use non-native shadow on ios
                        style={styles.top2} >
                    </Shadow>
                </LinearGradient>
                <View style={styles.main}>
                    <Text h4 style={styles.text}>{loc.cypherbox.vault.threshold_adjust.intro}</Text>
                    <View style={styles.extra} />
                    <Text h4 style={styles.text}>{loc.cypherbox.vault.threshold_adjust.balance_warning}</Text>
                    <View style={styles.extra} />
                    <Description text={loc.cypherbox.vault.threshold_adjust.increase_desc} />
                    <Description text={loc.cypherbox.vault.threshold_adjust.decrease_desc} />
                    <View style={styles.extra} />
                    <Text h4 style={styles.text}>{loc.cypherbox.vault.threshold_adjust.coin_size_note}</Text>
                    <View style={styles.extra} />
                    <Text h4 style={styles.text}>{loc.cypherbox.vault.threshold_adjust.reserve_note}</Text>
                </View>
                <GradientButton style={styles.invoiceButton} textStyle={{ fontFamily: 'Lato-Medium', }} title={loc.cypherbox.vault.threshold_adjust.adjust_threshold} onPress={() => { navigation.pop(2)}} />
            </View>
        </ScreenLayout>
    )
}
