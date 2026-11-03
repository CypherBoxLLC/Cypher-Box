import React from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { VaultCapsules } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import loc from "../../../loc";

const getTiers = () => [
    {
        name: loc.cypherbox.vault.capsule_catalog.tier_white,
        range: "10K – 100K sats",
        color: "#FFFFFF",
        description: loc.cypherbox.vault.capsule_catalog.tier_white_desc,
        samples: [10_000, 30_000, 50_000, 70_000, 99_000],
    },
    {
        name: loc.cypherbox.vault.capsule_catalog.tier_orange,
        range: "100K – 1.1M sats",
        color: "#FF8C00",
        description: loc.cypherbox.vault.capsule_catalog.tier_orange_desc,
        samples: [110_000, 300_000, 500_000, 700_000, 1_050_000],
    },
    {
        name: loc.cypherbox.vault.capsule_catalog.tier_green,
        range: "1.1M – 11M sats",
        color: "#23C47F",
        description: loc.cypherbox.vault.capsule_catalog.tier_green_desc,
        samples: [1_100_000, 3_000_000, 5_000_000, 7_000_000, 10_500_000],
    },
    {
        name: loc.cypherbox.vault.capsule_catalog.tier_pink,
        range: "11M – 110M sats (~0.11 – 1.1 BTC)",
        color: "#FF69B4",
        description: loc.cypherbox.vault.capsule_catalog.tier_pink_desc,
        samples: [11_000_000, 30_000_000, 50_000_000, 70_000_000, 105_000_000],
    },
    {
        name: loc.cypherbox.vault.capsule_catalog.tier_blue,
        range: "110M – 1.1B sats (~1.1 – 11 BTC)",
        color: "#1693ED",
        description: loc.cypherbox.vault.capsule_catalog.tier_blue_desc,
        samples: [110_000_000, 300_000_000, 500_000_000, 700_000_000, 1_050_000_000],
    },
    {
        name: loc.cypherbox.vault.capsule_catalog.tier_red,
        range: "1.1B+ sats (~11+ BTC)",
        color: "#FF0000",
        description: loc.cypherbox.vault.capsule_catalog.tier_red_desc,
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
        <ScreenLayout showToolbar title={loc.cypherbox.vault.capsule_catalog.title}>
            <ScrollView style={styles.container} contentContainerStyle={styles.content}>

                {/* Intro */}
                <View style={styles.introCard}>
                    <Text h4 style={styles.introText}>
                        {loc.cypherbox.vault.capsule_catalog.intro_white}{"\n"}
                        {loc.cypherbox.vault.capsule_catalog.intro_colored}
                    </Text>
                    <Text h4 style={[styles.introText, { marginTop: 10 }]}>
                        {loc.cypherbox.vault.capsule_catalog.fill_level}
                    </Text>
                </View>

                {/* Tier visuals */}
                {getTiers().map((tier) => (
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
                    <Text h4 bold style={styles.infoTitle}>{loc.cypherbox.vault.capsule_catalog.fees_title}</Text>
                    <Text h4 style={styles.infoText}>
                        {loc.cypherbox.vault.capsule_catalog.fees_text}
                    </Text>
                    <Text h4 style={[styles.infoText, { marginTop: 10 }]}>
                        {loc.cypherbox.vault.capsule_catalog.privacy_text}
                    </Text>
                </View>

                {/* Recommendations */}
                <View style={styles.infoCard}>
                    <Text h4 bold style={styles.infoTitle}>{loc.cypherbox.vault.capsule_catalog.recommendations_title}</Text>
                    <Text h4 style={styles.bulletText}>{loc.cypherbox.vault.capsule_catalog.rec_small}</Text>
                    <Text h4 style={styles.bulletText}>{loc.cypherbox.vault.capsule_catalog.rec_large}</Text>
                    <Text h4 style={styles.bulletText}>{loc.cypherbox.vault.capsule_catalog.rec_combine}</Text>
                    <Text h4 style={styles.bulletText}>{loc.cypherbox.vault.capsule_catalog.rec_label}</Text>
                </View>

                {/* KYC Warning */}
                <View style={[styles.infoCard, { borderWidth: 1, borderColor: '#FF8C00' }]}>
                    <Text h4 style={[styles.infoText, { fontWeight: 'bold', color: '#FF8C00' }]}>
                        {loc.cypherbox.vault.capsule_catalog.kyc_warning}
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
