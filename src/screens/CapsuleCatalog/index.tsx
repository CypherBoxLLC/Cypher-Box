import React from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { VaultCapsules } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
// navigation handled by ScreenLayout

const tiers = [
    {
        name: "White",
        range: "10K – 100K sats",
        color: "#FFFFFF",
        description: "Each chunk = 10K sats",
        samples: [10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 99_000],
    },
    {
        name: "Orange",
        range: "100K – 1.1M sats",
        color: "#FF8C00",
        description: "Each chunk = 100K sats",
        samples: [110_000, 200_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 900_000, 1_050_000],
    },
    {
        name: "Green",
        range: "1.1M – 11M sats",
        color: "#23C47F",
        description: "Each chunk = 1M sats",
        samples: [1_100_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_000_000, 7_000_000, 8_000_000, 9_000_000, 10_500_000],
    },
    {
        name: "Blue",
        range: "11M – 110M sats (~0.11 – 1.1 BTC)",
        color: "#1693ED",
        description: "Each chunk = 10M sats",
        samples: [11_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000, 60_000_000, 70_000_000, 80_000_000, 90_000_000, 105_000_000],
    },
    {
        name: "Pink",
        range: "110M – 1.1B sats (~1.1 – 11 BTC)",
        color: "#FF69B4",
        description: "Each chunk = 100M sats",
        samples: [110_000_000, 200_000_000, 300_000_000, 400_000_000, 500_000_000, 600_000_000, 700_000_000, 800_000_000, 900_000_000, 1_050_000_000],
    },
    {
        name: "Red",
        range: "1.1B+ sats (~11+ BTC)",
        color: "#FF0000",
        description: "Always full (10 chunks)",
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
        <ScreenLayout showToolbar title="Capsule Guide">
            <ScrollView style={styles.container} contentContainerStyle={styles.content}>
                <Text h4 style={styles.subtitle}>
                    Each capsule represents a UTXO (unspent coin) in your vault.{"\n"}
                    The color shows the value tier, and the fill level shows where it sits within that tier.
                </Text>

                {tiers.map((tier, tierIndex) => (
                    <View key={tier.name} style={styles.tierContainer}>
                        <View style={styles.tierHeader}>
                            <View style={[styles.colorDot, { backgroundColor: tier.color }]} />
                            <Text h3 bold style={styles.tierName}>{tier.name}</Text>
                        </View>
                        <Text h4 style={styles.tierRange}>{tier.range}</Text>
                        <Text style={styles.tierDesc}>{tier.description}</Text>

                        <View style={styles.samplesRow}>
                            {tier.samples.map((sats, i) => (
                                <View key={i} style={styles.sampleItem5}>
                                    <View style={styles.capsuleWrapperLarge}>
                                        <VaultCapsules item={sats} />
                                    </View>
                                    <Text style={styles.sampleLabel}>{formatSats(sats)}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                ))}

                <View style={styles.legend}>
                    <Text h4 bold style={styles.legendTitle}>🏷️ Labeling Best Practices</Text>
                    <Text h4 style={styles.legendText}>
                        Label your capsules by source to protect your privacy. For example, label exchange withdrawals as "Strike" — these are KYC capsules tied to your identity.
                    </Text>
                    <Text h4 style={[styles.legendText, {marginTop: 8}]}>
                        Label peer-to-peer receives as "P2P", "Cash trade", or "No KYC". Keeping track of the origin of each capsule helps you make smarter spending decisions.
                    </Text>
                    <Text h4 style={[styles.legendText, {marginTop: 8, fontWeight: 'bold', color: '#FF8C00'}]}>
                        ⚠️ Never mix KYC and non-KYC capsules in the same transaction. Selecting a KYC capsule alongside a non-KYC one links them on-chain, compromising the privacy of your non-KYC coins.
                    </Text>
                </View>

                <View style={styles.legend}>
                    <Text h4 bold style={styles.legendTitle}>💡 Smart Spending Strategy</Text>
                    <Text h4 style={styles.legendText}>
                        When sending bitcoin, pick a capsule that is equal to or slightly larger than the amount you're sending. This minimizes the change output.
                    </Text>
                    <Text h4 style={[styles.legendText, {marginTop: 8}]}>
                        Avoid using a capsule much larger than needed — the leftover change creates a new smaller capsule that is linked to your transaction, reducing your privacy. The recipient and any observer can infer the change belongs to you.
                    </Text>
                    <Text h4 style={[styles.legendText, {marginTop: 8}]}>
                        If you must use a larger capsule, consider sending the full amount and requesting a partial refund through a separate channel.
                    </Text>
                </View>

                <View style={styles.legend}>
                    <Text h4 bold style={styles.legendTitle}>🧹 Consolidation Tips</Text>
                    <Text h4 style={styles.legendText}>
                        Small capsules (white tier) cost more to spend relative to their value due to transaction fees. A 10K sats capsule might cost 1,500+ sats just in fees — that's 15% lost!
                    </Text>
                    <Text h4 style={[styles.legendText, {marginTop: 8}]}>
                        Periodically consolidate small capsules into larger ones using the "Consolidate" button. Select multiple small capsules and merge them into one. Do this when fees are low (weekends, quiet periods).
                    </Text>
                    <Text h4 style={[styles.legendText, {marginTop: 8}]}>
                        You can also consolidate by selecting multiple capsules and sending them to your own Cold Storage vault. This combines them into a single larger capsule at the destination.
                    </Text>
                </View>

                <View style={styles.legend}>
                    <Text h4 bold style={styles.legendTitle}>⛽ Fee Implications</Text>
                    <Text h4 style={styles.legendText}>
                        Every capsule you include in a transaction adds to the transaction size and therefore the fee. Selecting 5 small capsules costs significantly more in fees than using 1 larger one.
                    </Text>
                    <Text h4 style={[styles.legendText, {marginTop: 8}]}>
                        This is why consolidation matters — fewer, larger capsules mean cheaper transactions in the future.
                    </Text>
                </View>
            </ScrollView>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 15,
        paddingTop: 25,
        paddingBottom: 10,
    },
    backBtn: {
        width: 50,
        height: 50,
        alignItems: "center",
        justifyContent: "center",
    },
    headerTitle: {
        textAlign: "center",
    },
    container: {
        flex: 1,
    },
    content: {
        padding: 20,
        paddingBottom: 40,
    },
    subtitle: {
        color: "#999",
        marginBottom: 25,
        textAlign: "center",
        lineHeight: 20,
    },
    tierContainer: {
        marginBottom: 25,
        backgroundColor: "#1A1A1F",
        borderRadius: 16,
        padding: 16,
    },
    tierHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 4,
    },
    colorDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginRight: 8,
    },
    tierName: {
        fontSize: 18,
    },
    tierRange: {
        color: "#999",
        marginBottom: 12,
        fontSize: 13,
    },
    samplesRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
    },
    sampleItem5: {
        alignItems: "center",
        width: "17%",
        marginBottom: 12,
        marginHorizontal: "1.5%",
    },
    tierDesc: {
        color: "#BBB",
        fontSize: 12,
        marginBottom: 10,
        fontStyle: "italic",
    },
    capsuleWrapperLarge: {
        flex: 1,
        height: 12,
    },
    sampleLabel: {
        color: "#AAA",
        fontSize: 10,
        marginTop: 4,
    },
    legend: {
        backgroundColor: "#1A1A1F",
        borderRadius: 16,
        padding: 16,
        marginTop: 5,
    },
    legendTitle: {
        marginBottom: 8,
    },
    legendText: {
        color: "#999",
        marginBottom: 4,
        fontSize: 13,
    },
});
