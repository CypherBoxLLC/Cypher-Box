import React, { useState, useCallback, useMemo } from "react";
import { Image, LayoutAnimation, StyleSheet, TouchableOpacity, View } from "react-native";
import { Text } from "@Cypher/component-library";
import { Bank, CoinOs, Electricity, Settings, Threshold, Time } from "@Cypher/assets/images";
import { colors, widths } from "@Cypher/style-guide";
import styles from "./styles";
import GradientCard from "../GradientCard";
import LinearGradient from "react-native-linear-gradient";
import GradientText from "../GradientText";
import GradientButton from "./GradientButton";

interface Props {
    onChangeSelectedTab(id: number): void;
    selectedTab: number;
    vaultTab: boolean;
    // When set to 'ark', the selected-tab gradient + label switch from the
    // pink Lightning palette to the Ark yellow palette. Other account types
    // keep the historical pink theming.
    accountType?: string;
}

export default function Tabs({ onChangeSelectedTab, selectedTab, vaultTab, accountType }: Props) {
    const isArk = accountType === 'ark';
    // Ark surfaces Capsules as the FIRST tab — it's the day-to-day VTXO
    // management surface that users land on most often. The custodial-
    // shaped "Vault" tab (balance + threshold copy) is second. Strike/
    // CoinOS keep the historical Account/Threshold ordering since they
    // don't have a Capsules concept.
    //
    // Ark icons: Capsules uses the CoinOs coin/capsule glyph (also used
    // by Hot Vault's Capsules tab) for visual continuity across UTXO/
    // VTXO surfaces. "Vault" uses Electricity (white-tinted lightning
    // bolt) to signal "Lightning-native non-custodial vault" at a glance.
    const tabs = useMemo(() => [
        { id: 0, name: isArk ? 'Capsules' : 'Account', icon: isArk ? CoinOs : Bank },
        { id: 1, name: isArk ? 'Vault' : 'Threshold', icon: isArk ? Electricity : Threshold },
        { id: 2, name: 'History', icon: Time },
        { id: 3, name: 'Settings', icon: Settings },
    ], [isArk]);


    const tabClickListener = useCallback((id: number) => {
        // setSelectedTab(id);
        onChangeSelectedTab(id);
    }, []);

    const primaryColor = vaultTab ? colors.coldGreen : colors.greenNew

    const getTabStyle = (id: number) => ({
        backgroundColor: selectedTab === id ? primaryColor : colors.primary,
        tintColor: selectedTab === id ? colors.white : colors.gray.text,
        color: selectedTab === id ? primaryColor : colors.gray.text,
    });

    return (
        <View style={styles.main}>
            {tabs.map(tab => (
                <View key={tab.id} style={styles.container}>
                    <GradientButton
                        style={styles.inner}
                        colors_={
                            selectedTab === tab.id
                                ? (isArk
                                    ? [colors.ark.extralight, colors.ark.main]
                                    : [colors.pink.extralight, colors.pink.default])
                                : [colors.primary, colors.primary]
                        }
                        onPress={() => tabClickListener(tab.id)}
                    >
                        <Image
                            source={tab.icon}
                            style={[
                                tab.id === 1 ? styles.coinos : tab.id === 0 ? styles.key : tab.id === 3 ? styles.key : styles.icon,
                                // { tintColor: getTabStyle(tab.id).tintColor }
                            ]}
                            resizeMode="contain"
                        />
                    </GradientButton>
                    {selectedTab === tab.id ?
                        <GradientText
                            style={styles.selectedtext}
                            colors_={isArk ? [colors.ark.light, colors.ark.main] : undefined}
                        >{tab.name}</GradientText>
                        :
                        <Text bold style={styles.text}>{tab.name}</Text>
                    }
                    {/* <Text style={StyleSheet.flatten([styles.text, { color: getTabStyle(tab.id).color }])}>{tab.name}</Text> */}
                </View>
            ))}
        </View>
    );
}
