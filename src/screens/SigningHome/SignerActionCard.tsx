import React from "react";
import { StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";

import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";

/**
 * The big card at the top of a seed-signer's home, for what the phone is there to do next: make a seed, then sign.
 * The vault cards' green ring and dark face, with the action's icon (signing has the Hot Vault's "Sign a transaction"
 * icon), its name and a line on what follows.
 */
export default function SignerActionCard({ icon, title, subtitle, onPress }: {
    icon: string;
    title: string;
    subtitle: string;
    onPress: () => void;
}) {
    // sized from the live window, like the vault cards: the width read at start-up is wrong if the phone started sideways
    const { width } = useWindowDimensions();
    return (
        <TouchableOpacity
            activeOpacity={0.85}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint={subtitle}
            style={[styles.card, { width: width - 40 }]}
        >
            <LinearGradient
                colors={[colors.green_.greenGradient1, colors.green_.greenGradient2]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ring}
            >
                <View style={styles.face}>
                    {/* a layer of its own, as on the vault cards: a gradient's own padding isn't painted on every platform */}
                    <LinearGradient
                        colors={['#2A2A2A', '#000000']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        pointerEvents="none"
                        style={styles.faceFill}
                    />
                    <View style={styles.badge}>
                        <MaterialCommunityIcons name={icon} size={30} color={colors.green} />
                    </View>
                    <Text h3 bold center style={styles.title}>
                        {title}
                    </Text>
                    <Text center style={styles.subtitle}>
                        {subtitle}
                    </Text>
                </View>
            </LinearGradient>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 25,
    },
    ring: {
        borderRadius: 25,
        padding: 1.5,
    },
    face: {
        borderRadius: 23.5,
        overflow: 'hidden',
        alignItems: 'center',
        paddingTop: 22,
        paddingBottom: 20,
        paddingHorizontal: 24,
    },
    faceFill: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 23.5,
    },
    badge: {
        width: 60,
        height: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
        backgroundColor: 'rgba(35, 196, 127, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(35, 196, 127, 0.35)',
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
    },
    subtitle: {
        marginTop: 6,
        fontSize: 14,
        lineHeight: 20,
        color: colors.gray.light,
    },
});
