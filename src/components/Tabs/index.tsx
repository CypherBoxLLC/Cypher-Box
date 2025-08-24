import React, { useState, useCallback, useMemo } from "react";
import { Image, LayoutAnimation, StyleSheet, TouchableOpacity, View } from "react-native";
import { Text } from "@Cypher/component-library";
import { Bank, Settings, Threshold, Time } from "@Cypher/assets/images";
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
}

export default function Tabs({ onChangeSelectedTab, selectedTab, vaultTab }: Props) {
    const tabs = useMemo(() => [
        { id: 0, name: 'Account', icon: Bank },
        { id: 1, name: 'Threshold', icon: Threshold },
        { id: 2, name: 'History', icon: Time },
        // { id: 3, name: 'Settings', icon: Settings },
    ], []);


    const tabClickListener = useCallback((id: number) => {
        // setSelectedTab(id);
        onChangeSelectedTab(id);
    }, []);

    const primaryColor = vaultTab ? colors.blueText : colors.greenNew

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
                        colors_={selectedTab === tab.id ? [colors.pink.extralight, colors.pink.default] : [colors.primary, colors.primary]}
                        onPress={() => tabClickListener(tab.id)}
                    >
                        <Image
                            source={tab.icon}
                            style={[
                                tab.id === 1 ? styles.coinos : tab.id === 0 ? styles.key : styles.icon,
                                // { tintColor: getTabStyle(tab.id).tintColor }
                            ]}
                            resizeMode="contain"
                        />
                    </GradientButton>
                    {selectedTab === tab.id ?
                        <GradientText style={styles.selectedtext}>{tab.name}</GradientText>
                        :
                        <Text bold style={styles.text}>{tab.name}</Text>
                    }
                    {/* <Text style={StyleSheet.flatten([styles.text, { color: getTabStyle(tab.id).color }])}>{tab.name}</Text> */}
                </View>
            ))}
        </View>
    );
}
