import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { Text } from "@Cypher/component-library";

const AMBER = '#FFD54F';

/**
 * On the seed phrase and SeedQR screens of an Offline Seed-Signer. Staying offline is the whole protection, so a phone
 * that has been online once can't be trusted with the seed again.
 */
export default function OfflineSeedWarning({ style }: { style?: StyleProp<ViewStyle> }) {
    return (
        <View style={[styles.row, style]}>
            <Ionicons name="warning-outline" size={16} color={AMBER} style={styles.icon} />
            <Text style={styles.text}>
                If this offline phone ever connects to the internet, treat this seed as a hot wallet and plan to move
                your coins to a new seed.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginTop: 14,
        marginHorizontal: 16,
    },
    icon: {
        marginTop: 2,
        marginRight: 8,
    },
    text: {
        flex: 1,
        fontSize: 13,
        lineHeight: 19,
        color: AMBER,
    },
});
