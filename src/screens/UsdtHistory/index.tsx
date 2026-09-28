import Clipboard from "@react-native-clipboard/clipboard";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { getTronUsdtTransfers, type TronUsdtTransfer } from "@Cypher/api/tronAPIs";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import { USDT_ASSET_LABEL } from "@Cypher/services/tron/constants";
import { formatUsdtExact } from "@Cypher/services/tron/format";
import {
    type UsdtHistoryEntry,
    buildUsdtHistory,
    dayLabel,
    shortId,
} from "@Cypher/services/tron/history";
import { satsFromBitcoin } from "@Cypher/services/tron/swapConvert";
import useAuthStore from "@Cypher/stores/authStore";
import useUsdtHistoryStore from "@Cypher/stores/usdtHistoryStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import styles from "./styles";

/** What a row says on its right, and in which colour. */
function amountOf(entry: UsdtHistoryEntry): { text: string; style: any } {
    switch (entry.kind) {
        case 'received':
            return { text: `+${formatUsdtExact(entry.amount)} USDT`, style: styles.amountIn };
        case 'sent':
            return { text: `-${formatUsdtExact(entry.amount)} USDT`, style: styles.amountOut };
        case 'swap':
            return {
                text:
                    entry.settleAmount !== null
                        ? `+${satsFromBitcoin(entry.settleAmount)} sats`
                        : `-${formatUsdtExact(entry.amount)} USDT`,
                style: entry.settleAmount !== null ? styles.amountSwap : styles.amountOut,
            };
    }
}

/** The line under the title: who, or what became of it. */
function detailOf(entry: UsdtHistoryEntry): string {
    switch (entry.kind) {
        case 'received':
            return `From ${shortId(entry.counterparty)}`;
        case 'sent':
            return `To ${shortId(entry.counterparty)}`;
        case 'swap':
            switch (entry.status) {
                case 'settled':
                    return `${formatUsdtExact(entry.amount)} USDT to ${shortId(entry.settleAddress)}`;
                case 'refunded':
                    return 'Returned to your wallet, less fees already paid';
                case 'expired':
                    return 'Did not complete in time';
                default:
                    return 'Failed at the venue';
            }
    }
}

function titleOf(entry: UsdtHistoryEntry): string {
    if (entry.kind === 'received') return 'Received';
    if (entry.kind === 'sent') return 'Sent';
    return entry.settleNetwork === 'bitcoin' ? 'Swapped to bitcoin' : 'Swapped to Lightning';
}

/**
 * Everything this wallet's USDT has done.
 *
 * Two sources, merged by services/tron/history: TronGrid's index of TRC-20
 * transfers, which is the record of what moved and survives a reinstall, and
 * the log of finished swaps, because a swap's bitcoin side never touches Tron
 * and the chain alone would show only USDT leaving for an address.
 *
 * Read only. Nothing here can spend, so a stale or partial reading is a
 * cosmetic problem rather than a dangerous one, which is why a failed load
 * shows what it has and offers a pull to refresh rather than blocking.
 */
export default function UsdtHistory() {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);
    const swaps = useUsdtHistoryStore((s) => s.swaps);

    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);
    const address = account?.address ?? null;

    const [transfers, setTransfers] = useState<TronUsdtTransfer[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(
        async (isRefresh: boolean) => {
            if (!address) return;
            if (isRefresh) setRefreshing(true);
            setFailed(false);
            try {
                setTransfers(await getTronUsdtTransfers(address));
            } catch {
                // Whatever was already read stays on screen: a list that
                // empties itself on a flaky network reads as lost money.
                setFailed(true);
            } finally {
                if (isRefresh) setRefreshing(false);
            }
        },
        [address],
    );

    useEffect(() => {
        void load(false);
    }, [load]);

    const entries = useMemo(
        () => (address ? buildUsdtHistory(address, transfers ?? [], swaps) : []),
        [address, transfers, swaps],
    );

    const copy = (value: string, what: string) => {
        Clipboard.setString(value);
        SimpleToast.show(`${what} copied`, SimpleToast.SHORT);
    };

    const renderItem = ({ item, index }: { item: UsdtHistoryEntry; index: number }) => {
        const amount = amountOf(item);
        const day = dayLabel(item.atMs);
        const newDay = index === 0 || dayLabel(entries[index - 1].atMs) !== day;
        return (
            <View>
                {newDay && <Text style={styles.day}>{day}</Text>}
                <TouchableOpacity
                    style={styles.row}
                    activeOpacity={item.txID ? 0.7 : 1}
                    onPress={() => (item.txID ? copy(item.txID, 'Transaction id') : undefined)}
                    accessibilityRole="button"
                >
                    <View style={styles.rowLeft}>
                        <Text bold style={styles.rowTitle}>{titleOf(item)}</Text>
                        <Text style={styles.rowDetail} numberOfLines={1}>{detailOf(item)}</Text>
                    </View>
                    <Text bold style={[styles.amount, amount.style]}>{amount.text}</Text>
                </TouchableOpacity>
            </View>
        );
    };

    const loading = transfers === null && !failed;

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title={`${USDT_ASSET_LABEL} history`}>
            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.usdt.light} />
                </View>
            ) : (
                <FlatList
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    data={entries}
                    keyExtractor={(e) => e.id}
                    renderItem={renderItem}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => void load(true)}
                            tintColor={colors.usdt.light}
                        />
                    }
                    ListHeaderComponent={
                        failed ? (
                            <Text style={styles.problem}>
                                Could not read your latest transfers. Pull down to try again.
                            </Text>
                        ) : null
                    }
                    ListEmptyComponent={
                        <View style={styles.center}>
                            <Text style={styles.empty}>Nothing yet</Text>
                            <Text style={styles.emptyDetail}>
                                {account
                                    ? 'USDT you receive, send or swap will be listed here.'
                                    : 'Your USDT comes from your Hot Vault, and this phone no longer has one.'}
                            </Text>
                        </View>
                    }
                />
            )}
        </ScreenLayout>
    );
}
