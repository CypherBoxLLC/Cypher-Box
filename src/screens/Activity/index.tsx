import React, { useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { ScreenLayout, Text } from "@Cypher/component-library";
import useEvents from "@Cypher/custom-hooks/useEvents";
import { AppEvent, EventWallet } from "@Cypher/stores/eventLogStore";
import loc from "../../../loc";

const getWalletLabel = (): Record<EventWallet, string> => ({
    "coinos": "CoinOS",
    "strike": "Strike",
    "hot-vault": loc.cypherbox.payments.common.hot_vault,
    "ark": "Ark",
});

const formatSats = (sats: number) =>
    `${sats.toLocaleString("en-US")} sats`;

const formatRelative = (ts: number, now: number): string => {
    const diff = now - ts;
    if (diff < 0) return loc.cypherbox.payments.activity.just_now;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return loc.cypherbox.payments.activity.just_now;
    if (min < 60) return String(loc.formatString(loc.cypherbox.payments.activity.minutes_ago, { count: min }));
    const hr = Math.floor(min / 60);
    if (hr < 24) return String(loc.formatString(hr === 1 ? loc.cypherbox.payments.activity.hour_ago : loc.cypherbox.payments.activity.hours_ago, { count: hr }));
    const day = Math.floor(hr / 24);
    if (day < 7) return String(loc.formatString(day === 1 ? loc.cypherbox.payments.activity.day_ago : loc.cypherbox.payments.activity.days_ago, { count: day }));
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
            return { icon: "flash", line1: String(loc.formatString(loc.cypherbox.payments.activity.sent, { amount: formatSats(ev.sats) })), walletLabel: getWalletLabel()[ev.wallet] };
        case "ln-received":
            return { icon: "flash-outline", line1: String(loc.formatString(loc.cypherbox.payments.activity.received, { amount: formatSats(ev.sats) })), walletLabel: getWalletLabel()[ev.wallet] };
        case "onchain-sent":
            return { icon: "arrow-up-circle-outline", line1: String(loc.formatString(loc.cypherbox.payments.activity.sent_onchain, { amount: formatSats(ev.sats) })), walletLabel: getWalletLabel()[ev.wallet] };
        case "onchain-received":
            return { icon: "arrow-down-circle-outline", line1: String(loc.formatString(loc.cypherbox.payments.activity.received_onchain, { amount: formatSats(ev.sats) })), walletLabel: getWalletLabel()[ev.wallet] };
        case "hot-vault-created":
            return { icon: "shield-checkmark-outline", line1: loc.cypherbox.payments.activity.hot_vault_created, walletLabel: getWalletLabel()["hot-vault"] };
        case "hot-vault-recovered":
            return {
                icon: "shield-checkmark-outline",
                line1: ev.source === "cloud" ? loc.cypherbox.payments.activity.hot_vault_recovered_cloud : loc.cypherbox.payments.activity.hot_vault_recovered_seed,
                walletLabel: getWalletLabel()["hot-vault"],
            };
        case "cold-vault-created":
            return { icon: "snow-outline", line1: loc.cypherbox.payments.activity.cold_vault_connected, walletLabel: loc.cypherbox.payments.common.cold_vault };
        case "cold-vault-deleted":
            return { icon: "trash-outline", line1: loc.cypherbox.payments.activity.cold_vault_deleted, walletLabel: loc.cypherbox.payments.common.cold_vault };
        case "ark-created":
            return { icon: "boat-outline", line1: loc.cypherbox.payments.activity.ark_created, walletLabel: getWalletLabel()["ark"] };
        case "ark-recovered":
            return { icon: "boat-outline", line1: loc.cypherbox.payments.activity.ark_recovered, walletLabel: getWalletLabel()["ark"] };
        case "ark-onchain-recovered":
            return {
                icon: "arrow-undo-outline",
                line1: String(loc.formatString(loc.cypherbox.payments.activity.ark_onchain_recovered, { amount: formatSats(ev.sats) })),
                walletLabel: getWalletLabel()["ark"],
            };
        case "ark-exit-started":
            return {
                icon: "exit-outline",
                line1: String(loc.formatString(loc.cypherbox.payments.activity.exit_started, { amount: formatSats(ev.sats) })),
                walletLabel: getWalletLabel()["ark"],
            };
        case "ark-exit-finished":
            return {
                icon: ev.result === "success" ? "checkmark-circle-outline" : "alert-circle-outline",
                line1: ev.result === "success" ? loc.cypherbox.payments.activity.exit_complete : loc.cypherbox.payments.activity.exit_failed,
                walletLabel: getWalletLabel()["ark"],
            };
        case "ark-refresh-started":
            return {
                icon: "refresh-outline",
                line1: String(loc.formatString(ev.vtxoCount === 1 ? loc.cypherbox.payments.activity.refreshing_vtxo : loc.cypherbox.payments.activity.refreshing_vtxos, { count: ev.vtxoCount, amount: formatSats(ev.totalSats) })),
                walletLabel: getWalletLabel()["ark"],
            };
        case "ark-refresh-finished":
            // Three outcomes, not two. "accepted" is the ASP taking the
            // delegation, which happens up to an hour before the round
            // finalises; calling it complete was the whole bug.
            return {
                icon: ev.result === "success"
                    ? "checkmark-circle-outline"
                    : ev.result === "accepted"
                        ? "time-outline"
                        : "alert-circle-outline",
                line1: ev.result === "success"
                    ? (ev.vtxoCount ? String(loc.formatString(ev.vtxoCount === 1 ? loc.cypherbox.payments.activity.refresh_complete_capsule : loc.cypherbox.payments.activity.refresh_complete_capsules, { count: ev.vtxoCount })) : loc.cypherbox.payments.activity.refresh_complete)
                    : ev.result === "accepted"
                        ? loc.cypherbox.payments.activity.refresh_submitted
                        : loc.cypherbox.payments.activity.refresh_failed,
                walletLabel: getWalletLabel()["ark"],
            };
        case "auto-backup":
            return {
                icon: ev.result === "success" ? "cloud-done-outline" : "cloud-offline-outline",
                line1: ev.result === "success" ? loc.cypherbox.payments.activity.auto_backup_saved : loc.cypherbox.payments.activity.auto_backup_failed,
                walletLabel: ev.target === "cloud" ? loc.cypherbox.payments.activity.cloud : loc.cypherbox.payments.activity.local,
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
                    ? loc.cypherbox.payments.activity.trigger_scheduled
                    : ev.trigger === "push"
                    ? loc.cypherbox.payments.activity.trigger_push
                    : ev.trigger === "foreground"
                    ? loc.cypherbox.payments.activity.trigger_foreground
                    : ev.trigger === "arrival"
                    ? loc.cypherbox.payments.activity.trigger_arrival
                    : loc.cypherbox.payments.activity.trigger_manual_test;
            let icon = "refresh-outline";
            let line1 = "";
            switch (ev.outcome) {
                case "success":
                    icon = "checkmark-circle-outline";
                    line1 =
                        ev.vtxoCount != null && ev.vtxoCount > 0
                            ? String(loc.formatString(ev.vtxoCount === 1 ? loc.cypherbox.payments.activity.auto_refresh_complete_vtxo : loc.cypherbox.payments.activity.auto_refresh_complete_vtxos, { count: ev.vtxoCount }))
                            : loc.cypherbox.payments.activity.auto_refresh_complete;
                    break;
                case "error":
                    icon = "alert-circle-outline";
                    line1 = ev.errorMsg
                        ? String(loc.formatString(loc.cypherbox.payments.activity.auto_refresh_failed_reason, { error: ev.errorMsg.slice(0, 60) }))
                        : loc.cypherbox.payments.activity.auto_refresh_failed;
                    break;
                case "fee_gated":
                    icon = "warning-outline";
                    line1 =
                        ev.feeSats != null
                            ? String(loc.formatString(loc.cypherbox.payments.activity.auto_refresh_paused_fee, { amount: formatSats(ev.feeSats) }))
                            : loc.cypherbox.payments.activity.auto_refresh_paused;
                    break;
                case "dust_uneconomic":
                    icon = "warning-outline";
                    line1 = loc.cypherbox.payments.activity.auto_refresh_dust_uneconomic;
                    break;
                case "dust_stranded":
                    icon = "warning-outline";
                    line1 = loc.cypherbox.payments.activity.auto_refresh_dust_stranded;
                    break;
                case "no_seed":
                    icon = "key-outline";
                    line1 = loc.cypherbox.payments.activity.auto_refresh_no_seed;
                    break;
                default:
                    icon = "refresh-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.auto_refresh_outcome, { outcome: ev.outcome }));
            }
            return {
                icon,
                line1,
                walletLabel: `${getWalletLabel()["ark"]} · ${triggerLabel}`,
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
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_shown, { details: satsTag }));
                    break;
                case "skipped-disabled":
                    icon = "notifications-off-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_skipped_disabled, { details: satsTag }));
                    break;
                case "skipped-background":
                    icon = "moon-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_skipped_background, { details: satsTag }));
                    break;
                case "skipped-in-flight":
                    icon = "hourglass-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_skipped_in_flight, { details: satsTag }));
                    break;
                case "skipped-vtxo-gone":
                    icon = "ghost-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_skipped_vtxo_gone, { details: satsTag }));
                    break;
                case "refresh-now":
                    icon = "refresh-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_refresh_now, { details: satsTag }));
                    break;
                case "use-immediately":
                    icon = "flash-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_use_immediately, { details: satsTag }));
                    break;
                case "auto-skipped":
                    icon = "shield-checkmark-outline";
                    line1 =
                        ev.vtxoCount != null && ev.vtxoCount > 0
                            ? String(loc.formatString(ev.vtxoCount === 1 ? loc.cypherbox.payments.activity.auto_skipped_vtxo : loc.cypherbox.payments.activity.auto_skipped_vtxos, { count: ev.vtxoCount }))
                            : loc.cypherbox.payments.activity.auto_skipped_deferral;
                    break;
                default:
                    icon = "chatbubble-ellipses-outline";
                    line1 = String(loc.formatString(loc.cypherbox.payments.activity.arkoor_outcome, { outcome: (ev as any).outcome }));
            }
            return {
                icon,
                line1,
                walletLabel: `${getWalletLabel()["ark"]}${idTag}`,
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
            <ScreenLayout showToolbar title={loc.cypherbox.payments.activity.title} disableScroll>
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>{loc.cypherbox.payments.activity.no_activity}</Text>
                </View>
            </ScreenLayout>
        );
    }

    return (
        <ScreenLayout showToolbar title={loc.cypherbox.payments.activity.title} disableScroll>
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
