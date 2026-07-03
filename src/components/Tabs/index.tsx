import React, { useState, useCallback, useMemo } from "react";
import { Image, LayoutAnimation, StyleSheet, TouchableOpacity, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
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
    // management surface users land on most often. The Vault tab (balance
    // + threshold copy) is second. Strike/CoinOS keep the historical
    // Account/Threshold ordering since they don't have a Capsules
    // concept.
    //
    // Ark icons:
    //   - Capsules: Electricity (white-tinted lightning bolt) — VTXOs
    //     are Lightning-native capsules, the bolt signals that lineage.
    //   - Vault: Ionicons "boat-outline" — matches the Ark = boat icon
    //     already used in the receive flow ([ReceivedListNew:310]) so the
    //     visual is consistent everywhere Ark is represented.
    type TabDef = {
        id: number;
        name: string;
        icon?: any;
        ionicon?: string;
    };
    const tabs: TabDef[] = useMemo(() => [
        {
            id: 0,
            name: isArk ? 'Capsules' : 'Account',
            icon: isArk ? Electricity : Bank,
        },
        isArk
            ? {
                id: 1,
                name: 'Vault',
                ionicon: 'boat-outline',
            }
            : { id: 1, name: 'Threshold', icon: Threshold },
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
                        {tab.ionicon ? (
                            // Vector-icon tab (the Ark Vault boat-outline).
                            // Black on the selected tab (its fill is the
                            // light Ark color) and white on the dark
                            // unselected fill, so the icon always contrasts.
                            <Ionicons
                                name={tab.ionicon}
                                size={32}
                                color={selectedTab === tab.id ? '#000000' : '#FFFFFF'}
                            />
                        ) : (
                            <Image
                                source={tab.icon}
                                style={[
                                    tab.id === 1 ? styles.coinos : tab.id === 0 ? styles.key : tab.id === 3 ? styles.key : styles.icon,
                                    // Ark tabs: black icon on the selected (light) fill,
                                    // white on the dark unselected fill. Non-Ark tabs keep
                                    // their native artwork untinted.
                                    isArk ? { tintColor: selectedTab === tab.id ? '#000000' : '#FFFFFF' } : null,
                                ]}
                                resizeMode="contain"
                            />
                        )}
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
