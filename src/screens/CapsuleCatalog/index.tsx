import React from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { VaultCapsules } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";

const tiers = [
    {
        name: "White",
        range: "10K – 100K sats",
        color: "#FFFFFF",
        description: "Small amounts (like pennies & quarters)",
        samples: [10_000, 30_000, 50_000, 70_000, 99_000],
    },
    {
        name: "Orange",
        range: "100K – 1.1M sats",
        color: "#FF8C00",
        description: "Everyday spending range",
        samples: [110_000, 300_000, 500_000, 700_000, 1_050_000],
    },
    {
        name: "Green",
        range: "1.1M – 11M sats",
        color: "#23C47F",
        description: "Mid-size savings",
        samples: [1_100_000, 3_000_000, 5_000_000, 7_000_000, 10_500_000],
    },
    {
        name: "Blue",
        range: "11M – 110M sats (~0.11 – 1.1 BTC)",
        color: "#1693ED",
        description: "Significant holdings",
        samples: [11_000_000, 30_000_000, 50_000_000, 70_000_000, 105_000_000],
    },
    {
        name: "Pink",
        range: "110M – 1.1B sats (~1.1 – 11 BTC)",
        color: "#FF69B4",
        description: "Large savings",
        samples: [110_000_000, 300_000_000, 500_000_000, 700_000_000, 1_050_000_000],
    },
    {
        name: "Red",
        range: "1.1B+ sats (~11+ BTC)",
        color: "#FF0000",
        description: "Whale tier",
        samples: [1_100_000_000],
    },
];

const formatSats = (sats: number) => {
    if (sats >= 100_000_000) return (sats / 100_000_000).toFixed(2) + " BTC";
    if (sats >= 1_000_000) return (sats / 1_000_000).toFixed(1) + "M";
    if (sats >= 1_000) return (sats / 1_000).toFixed(0) + "K";
    return sats + "";
};

export default function CapsuleCatalog() {
    return (
        <ScreenLayout showToolbar title="Capsule Cheat Sheet">
            <ScrollView style={styles.container} contentContainerStyle={styles.content}>

                {/* Intro */}
                <View style={styles.introCard}>
                    <Text h4 style={styles.introText}>
                        White capsules = small amounts (like pennies, nickels, quarters) - cost high fees relative to their size{"\n"}
                        Colored capsules = larger amounts of Bitcoin - cost lower fees relative to their size
                    </Text>
                    <Text h4 style={[styles.introText, { marginTop: 10 }]}>
                        The fill level shows how full the capsule is within its tier.
                    </Text>
                </View>

                {/* Tier visuals */}
                {tiers.map((tier) => (
                    <View key={tier.name} style={styles.tierContainer}>
                        <View style={styles.tierHeader}>
                            <View style={[styles.colorDot, { backgroundColor: tier.color }]} />
                            <Text h3 bold style={styles.tierName}>{tier.name}</Text>
                            <Text style={styles.tierRangeInline}>{tier.range}</Text>
                        </View>
                        <Text style={styles.tierDesc}>{tier.description}</Text>

                        <View style={styles.samplesRow}>
                            {tier.samples.map((sats, i) => (
                                <View key={i} style={styles.sampleItem}>
                                    <View style={styles.capsuleWrapper}>
                                        <VaultCapsules item={sats} />
                                    </View>
                                    <Text style={styles.sampleLabel}>{formatSats(sats)}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                ))}

                {/* Fees & Change */}
                <View style={styles.infoCard}>
                    <Text h4 bold style={styles.infoTitle}>⛽ Fees & Change</Text>
                    <Text h4 style={styles.infoText}>
                        Just like spending quarters and pennies can be cumbersome, spending small-sized BTC capsules has its engineering friction in terms of fees. If you select lots of white capsules to spend from, your transaction gets bigger in terms of complexity which means higher fees.
                    </Text>
                    <Text h4 style={[styles.infoText, { marginTop: 10 }]}>
                        There's also a privacy concern. Each capsule usually has its own history. If you use a large capsule to buy something small, your wallet will send the leftover back to you as a new "change capsule." This can sometimes suggest that you control a larger amount of Bitcoin.
                    </Text>
                </View>

                {/* Recommendations */}
                <View style={styles.infoCard}>
                    <Text h4 bold style={styles.infoTitle}>💡 Recommendations</Text>
                    <Text h4 style={styles.bulletText}>• Use small capsules for everyday payments</Text>
                    <Text h4 style={styles.bulletText}>• Keep larger capsules for long-term saving</Text>
                    <Text h4 style={styles.bulletText}>• Occasionally combine small capsules when fees are low, unless you plan to spend them soon</Text>
                    <Text h4 style={styles.bulletText}>• Label your capsules when you receive them, especially KYC'd ones, so you can track and manage them strategically</Text>
                </View>

                {/* KYC Warning */}
                <View style={[styles.infoCard, { borderWidth: 1, borderColor: '#FF8C00' }]}>
                    <Text h4 style={[styles.infoText, { fontWeight: 'bold', color: '#FF8C00' }]}>
                        ⚠️ Never mix KYC and non-KYC capsules in the same transaction. Selecting a KYC capsule alongside a non-KYC one links them on-chain, compromising the privacy of your non-KYC coins.
                    </Text>
                </View>

            </ScrollView>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        padding: 20,
        paddingBottom: 40,
    },
    introCard: {
        backgroundColor: "#1A1A1F",
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
    },
    introText: {
        color: "#ccc",
        lineHeight: 20,
    },
    tierContainer: {
        marginBottom: 16,
        backgroundColor: "#1A1A1F",
        borderRadius: 16,
        padding: 14,
    },
    tierHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 2,
    },
    colorDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 8,
    },
    tierName: {
        fontSize: 16,
    },
    tierRangeInline: {
        color: "#777",
        fontSize: 12,
        marginLeft: 8,
    },
    tierDesc: {
        color: "#999",
        fontSize: 12,
        marginBottom: 10,
    },
    samplesRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
    },
    sampleItem: {
        alignItems: "center",
        width: "18%",
        marginBottom: 8,
    },
    capsuleWrapper: {
        flex: 1,
        height: 12,
    },
    sampleLabel: {
        color: "#AAA",
        fontSize: 9,
        marginTop: 3,
    },
    infoCard: {
        backgroundColor: "#1A1A1F",
        borderRadius: 16,
        padding: 16,
        marginTop: 10,
    },
    infoTitle: {
        marginBottom: 8,
    },
    infoText: {
        color: "#999",
        fontSize: 13,
        lineHeight: 19,
    },
    bulletText: {
        color: "#999",
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 6,
        paddingLeft: 4,
    },
});
