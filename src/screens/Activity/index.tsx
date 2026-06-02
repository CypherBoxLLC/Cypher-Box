import React, { useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { ScreenLayout, Text } from "@Cypher/component-library";
import useEvents from "@Cypher/custom-hooks/useEvents";
import { AppEvent, EventWallet } from "@Cypher/stores/eventLogStore";

const WALLET_LABEL: Record<EventWallet, string> = {
    "coinos": "CoinOS",
    "strike": "Strike",
    "hot-vault": "Hot Vault",
    "ark": "Ark",
};

const formatSats = (sats: number) =>
    `${sats.toLocaleString("en-US")} sats`;

const formatRelative = (ts: number, now: number): string => {
    const diff = now - ts;
    if (diff < 0) return "just now";
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

type RowMeta = {
    icon: string;
    line1: string;
    walletLabel?: string;
};

const describe = (ev: AppEvent): RowMeta => {
    switch (ev.kind) {
        case "ln-sent":
            return { icon: "flash", line1: `Sent ${formatSats(ev.sats)}`, walletLabel: WALLET_LABEL[ev.wallet] };
        case "ln-received":
            return { icon: "flash-outline", line1: `Received ${formatSats(ev.sats)}`, walletLabel: WALLET_LABEL[ev.wallet] };
        case "onchain-sent":
            return { icon: "arrow-up-circle-outline", line1: `Sent ${formatSats(ev.sats)} on-chain`, walletLabel: WALLET_LABEL[ev.wallet] };
        case "onchain-received":
            return { icon: "arrow-down-circle-outline", line1: `Received ${formatSats(ev.sats)} on-chain`, walletLabel: WALLET_LABEL[ev.wallet] };
        case "hot-vault-created":
            return { icon: "shield-checkmark-outline", line1: "Hot Vault created", walletLabel: WALLET_LABEL["hot-vault"] };
        case "hot-vault-recovered":
            return {
                icon: "shield-checkmark-outline",
                line1: ev.source === "cloud" ? "Hot Vault recovered from cloud" : "Hot Vault recovered from seed",
                walletLabel: WALLET_LABEL["hot-vault"],
            };
        case "cold-vault-created":
            return { icon: "snow-outline", line1: "Cold Vault connected", walletLabel: "Cold Vault" };
        case "cold-vault-deleted":
            return { icon: "trash-outline", line1: "Cold Vault deleted", walletLabel: "Cold Vault" };
        case "ark-created":
            return { icon: "boat-outline", line1: "Ark wallet created", walletLabel: WALLET_LABEL["ark"] };
        case "ark-recovered":
            return { icon: "boat-outline", line1: "Ark wallet recovered", walletLabel: WALLET_LABEL["ark"] };
        case "ark-exit-started":
            return {
                icon: "exit-outline",
                line1: `Emergency exit started (${formatSats(ev.sats)})`,
                walletLabel: WALLET_LABEL["ark"],
            };
        case "ark-exit-finished":
            return {
                icon: ev.result === "success" ? "checkmark-circle-outline" : "alert-circle-outline",
                line1: ev.result === "success" ? "Emergency exit complete" : "Emergency exit failed",
                walletLabel: WALLET_LABEL["ark"],
            };
        case "ark-refresh-started":
            return {
                icon: "refresh-outline",
                line1: `Refreshing ${ev.vtxoCount} VTXO${ev.vtxoCount === 1 ? "" : "s"} (${formatSats(ev.totalSats)})`,
                walletLabel: WALLET_LABEL["ark"],
            };
        case "ark-refresh-finished":
            return {
                icon: ev.result === "success" ? "checkmark-circle-outline" : "alert-circle-outline",
                line1: ev.result === "success" ? "Refresh complete" : "Refresh failed",
                walletLabel: WALLET_LABEL["ark"],
            };
        case "auto-backup":
            return {
                icon: ev.result === "success" ? "cloud-done-outline" : "cloud-offline-outline",
                line1: ev.result === "success" ? "Auto-backup saved" : "Auto-backup failed",
                walletLabel: ev.target === "cloud" ? "Cloud" : "Local",
            };
        case "ark-bg-refresh": {
            // Per-outcome copy. The outcome set here is the user-visible
            // subset that backgroundRefresh.ts records — rate_limited /
            // no_eligible_vtxos / disabled / pending_round_conflict are
            // filtered at the call site so we never see them here. We
            // still default-case the switch for forward-compat in case a
            // future outcome lands without an explicit branch.
            const triggerLabel =
                ev.trigger === "scheduled"
                    ? "Scheduled"
                    : ev.trigger === "push"
                    ? "Push"
                    : ev.trigger === "foreground"
                    ? "Foreground"
                    : ev.trigger === "arrival"
                    ? "On-arrival"
                    : "Manual-test";
            let icon = "refresh-outline";
            let line1 = "";
            switch (ev.outcome) {
                case "success":
                    icon = "checkmark-circle-outline";
                    line1 =
                        ev.vtxoCount != null && ev.vtxoCount > 0
                            ? `Auto-refresh complete · ${ev.vtxoCount} VTXO${ev.vtxoCount === 1 ? "" : "s"}`
                            : "Auto-refresh complete";
                    break;
                case "error":
                    icon = "alert-circle-outline";
                    line1 = ev.errorMsg
                        ? `Auto-refresh failed · ${ev.errorMsg.slice(0, 60)}`
                        : "Auto-refresh failed";
                    break;
                case "fee_gated":
                    icon = "warning-outline";
                    line1 =
                        ev.feeSats != null
                            ? `Auto-refresh paused · fee ${formatSats(ev.feeSats)} above limit`
                            : "Auto-refresh paused · fee above limit";
                    break;
                case "dust_uneconomic":
                    icon = "warning-outline";
                    line1 = "Auto-refresh skipped · fee exceeds VTXO value";
                    break;
                case "dust_stranded":
                    icon = "warning-outline";
                    line1 = "Auto-refresh skipped · balance below recoverable threshold";
                    break;
                case "no_seed":
                    icon = "key-outline";
                    line1 = "Auto-refresh blocked · seed not available";
                    break;
                default:
                    icon = "refresh-outline";
                    line1 = `Auto-refresh: ${ev.outcome}`;
            }
            return {
                icon,
                line1,
                walletLabel: `${WALLET_LABEL["ark"]} · ${triggerLabel}`,
            };
        }
        case "arkoor-prompt": {
            // Surface every popup-lifecycle outcome so the user (and us
            // debugging) can see exactly what the Arkoor-receive prompt
            // did, including the silent skip modes that are otherwise
            // invisible without tailing Metro.
            const satsTag =
                ev.sats != null ? ` · ${formatSats(ev.sats)}` : "";
            const idTag = ev.vtxoIdPrefix ? ` · ${ev.vtxoIdPrefix}` : "";
            let icon = "chatbubble-ellipses-outline";
            let line1 = "";
            switch (ev.outcome) {
                case "fired":
                    icon = "chatbubble-ellipses-outline";
                    line1 = `Arkoor prompt shown${satsTag}`;
                    break;
                case "skipped-disabled":
                    icon = "notifications-off-outline";
                    line1 = `Arkoor prompt skipped · toggle off${satsTag}`;
                    break;
                case "skipped-background":
                    icon = "moon-outline";
                    line1 = `Arkoor prompt skipped · app backgrounded${satsTag}`;
                    break;
                case "skipped-in-flight":
                    icon = "hourglass-outline";
                    line1 = `Arkoor prompt skipped · alert busy${satsTag}`;
                    break;
                case "skipped-vtxo-gone":
                    icon = "ghost-outline";
                    line1 = `Arkoor prompt skipped · capsule already refreshed${satsTag}`;
                    break;
                case "refresh-now":
                    icon = "refresh-outline";
                    line1 = `You chose: Refresh now${satsTag}`;
                    break;
                case "use-immediately":
                    icon = "flash-outline";
                    line1 = `You chose: Use immediately${satsTag}`;
                    break;
                case "auto-skipped":
                    icon = "shield-checkmark-outline";
                    line1 =
                        ev.vtxoCount != null && ev.vtxoCount > 0
                            ? `Auto-refresh skipped ${ev.vtxoCount} deferred VTXO${ev.vtxoCount === 1 ? "" : "s"}`
                            : "Auto-refresh respected your deferral";
                    break;
                default:
                    icon = "chatbubble-ellipses-outline";
                    line1 = `Arkoor prompt: ${(ev as any).outcome}`;
            }
            return {
                icon,
                line1,
                walletLabel: `${WALLET_LABEL["ark"]}${idTag}`,
            };
        }
    }
};

export const Row = React.memo(function Row({ ev, now }: { ev: AppEvent; now: number }) {
    const meta = describe(ev);
    return (
        <View style={styles.row}>
            <View style={styles.iconWrap}>
                <Ionicons name={meta.icon} size={22} color="#FFFFFF" />
            </View>
            <View style={styles.body}>
                <Text style={styles.line1}>{meta.line1}</Text>
                <Text style={styles.line2}>
                    {meta.walletLabel ? `${meta.walletLabel} · ` : ""}{formatRelative(ev.ts, now)}
                </Text>
            </View>
        </View>
    );
});

export default function Activity() {
    const events = useEvents();
    const now = useMemo(() => Date.now(), [events.length]);

    if (events.length === 0) {
        return (
            <ScreenLayout showToolbar title="Activity" disableScroll>
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>No activity yet.</Text>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout showToolbar title="Activity" disableScroll>
            <FlatList
                data={events}
                keyExtractor={(ev) => ev.id}
                renderItem={({ item }) => <Row ev={item} now={now} />}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                contentContainerStyle={styles.listContent}
            />
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    listContent: {
        paddingTop: 8,
        paddingBottom: 24,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 14,
    },
    iconWrap: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 14,
        backgroundColor: "rgba(255,255,255,0.08)",
    },
    body: {
        flex: 1,
    },
    line1: {
        color: "#FFFFFF",
        fontSize: 15,
        fontFamily: "Lato-Bold",
    },
    line2: {
        color: "rgba(255,255,255,0.6)",
        fontSize: 12,
        marginTop: 2,
        fontFamily: "Lato-Regular",
    },
    sep: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: "rgba(255,255,255,0.08)",
        marginLeft: 70,
    },
    empty: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 60,
    },
    emptyText: {
        color: "rgba(255,255,255,0.5)",
        fontSize: 14,
    },
});
