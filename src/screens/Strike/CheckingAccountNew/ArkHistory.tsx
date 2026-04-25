import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    RefreshControl,
    SectionList,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { Shadow } from 'react-native-neomorph-shadows';
import SimpleToast from 'react-native-simple-toast';

import { Text } from '@Cypher/component-library';
import { Bitcoin, Socked } from '@Cypher/assets/images';
import { dispatchNavigate } from '@Cypher/helpers';
import { getStrikeCurrency } from '@Cypher/helpers/coinosHelper';
import {
    fetchArkHistory,
    type ArkMovementKind,
    type ArkMovementStatus,
    type ArkMovementView,
} from '@Cypher/services/ark';
import { colors } from '@Cypher/style-guide';
import screenHeight from '@Cypher/style-guide/screenHeight';
import useAuthStore from '@Cypher/stores/authStore';

import itemStyles from './Items/styles';
import Header from './Header';
import styles from './styles';

/**
 * ArkHistory — transaction history list for the Ark wallet menu's History tab.
 *
 * Why a dedicated screen (rather than extending `History.tsx`): the CoinOS /
 * Strike history list is backed by a remote HTTP endpoint with pagination and
 * a completely different row shape (item.amount, item.state, item.created).
 * The Ark history comes from a local SQLite call (`handle.history()` via
 * `fetchArkHistory`) that returns all rows in one shot, and its row shape —
 * signed sats + kind/status + fee + vtxo ids — has no useful intersection
 * with the Strike/CoinOS payload. Trying to share one component would be all
 * conditionals; forking gives each one a tight, predictable render path.
 *
 * Visual parity with the other tabs is preserved: same SectionList + date
 * header pattern, same neomorph shadow dimensions for each row, same
 * green/red amount convention. The per-row content is Ark-specific (kind
 * label, pending/failed status, offchain fee) — that's the whole point of
 * the history view.
 *
 * Data freshness: we fetch on mount, on pull-to-refresh, and whenever
 * `arkLastSyncedAt` ticks (i.e. the 30s useArkSync loop completed). We do
 * NOT persist movements into zustand — they're cheap to re-read from SQLite
 * on every tab mount, and keeping them only in local state avoids a
 * persist-middleware surface for data we can always recompute.
 */

interface ArkHistoryProps {
    matchedRate: string;
    currency: any;
}

export default function ArkHistory({ matchedRate, currency }: ArkHistoryProps) {
    const [movements, setMovements] = useState<ArkMovementView[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Piggy-back on the global sync tick: when useArkSync completes a cycle
    // (every 30s or after a manual refresh), arkLastSyncedAt changes and we
    // re-pull history. Keeps the tab fresh without needing our own interval.
    const lastSyncedAt = useAuthStore((s) => s.arkLastSyncedAt);

    const load = useCallback(async (showSpinner = true) => {
        if (showSpinner) setIsLoading(true);
        try {
            const rows = await fetchArkHistory();
            if (rows) setMovements(rows);
        } catch (err: any) {
            // Local SQLite read — the only realistic failure mode is "handle
            // not open" (already handled inside fetchArkHistory by returning
            // null) or an SDK crash. Don't clobber existing rows on error.
            console.warn('[Ark history] load failed:', err);
            SimpleToast.show(
                `History unavailable: ${err?.message ?? 'unknown error'}`,
                SimpleToast.SHORT,
            );
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    // Initial load + passive refresh on every sync tick. `lastSyncedAt`
    // starts as null and bumps each cycle — depending on it means the
    // history catches up to whatever the sync just pulled (e.g. a newly
    // materialised Lightning receive produces a movement row in the same
    // tick its VTXO appears in the capsules tab).
    useEffect(() => {
        void load(movements.length === 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSyncedAt]);

    const onRefresh = useCallback(() => {
        setIsRefreshing(true);
        void load(false);
    }, [load]);

    // Group by local-day string — matches how the Strike/CoinOS History tab
    // formats its section headers (Date.toDateString(), e.g. "Fri Apr 24 2026").
    const sections = React.useMemo(() => {
        const byDay: Record<string, ArkMovementView[]> = {};
        for (const m of movements) {
            const day = new Date(m.timestamp).toDateString();
            (byDay[day] ??= []).push(m);
        }
        // Entries preserve insertion order, and movements are already sorted
        // newest-first, so the day keys naturally come out newest-first too.
        return Object.entries(byDay).map(([title, data]) => ({ title, data }));
    }, [movements]);

    if (isLoading && !isRefreshing) {
        return (
            <View style={styles.container}>
                <View style={styles.container}>
                    <ActivityIndicator size={100} color={colors.white} />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <SectionList
                sections={sections}
                keyExtractor={(item) => String(item.id)}
                renderSectionHeader={({ section: { title } }) => (
                    <Header title={title} />
                )}
                renderItem={({ item }) => (
                    <ArkHistoryRow
                        movement={item}
                        matchedRate={Number(matchedRate) || 0}
                        currency={currency}
                    />
                )}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={onRefresh}
                        tintColor="white"
                    />
                }
                ListEmptyComponent={() => (
                    <View
                        style={{
                            height: screenHeight / 2.2,
                            justifyContent: 'center',
                            alignItems: 'center',
                            marginTop: 30,
                        }}
                    >
                        <Text white h3 bold>
                            No Ark Transactions
                        </Text>
                        <Text style={{ color: colors.gray.light, marginTop: 8, paddingHorizontal: 30, textAlign: 'center' }}>
                            Receive or send Bitcoin via your Ark vault to see
                            it here.
                        </Text>
                    </View>
                )}
            />
        </View>
    );
}

// --- Row component ---
// Kept inline (not its own file) because nothing else uses it and the render
// is small enough that an extra directory would be noise. If a second
// consumer ever appears (e.g. an embeddable "recent activity" widget on the
// home screen), promote it to src/components/ark/ at that point.

interface ArkHistoryRowProps {
    movement: ArkMovementView;
    matchedRate: number;
    currency: any;
}

/**
 * Map (kind, status) → row color + label pill.
 *
 * Color logic:
 *   - failed / canceled → muted gray — user shouldn't mistake it for value moved.
 *   - pending → Ark yellow regardless of direction — in-flight, don't commit
 *     to green/red yet.
 *   - successful → green for inflow, red for outflow.
 *
 * The pill label is the coarse kind (Lightning / Ark / On-chain / …), shown
 * under the main description so a glance tells the user which rail moved the
 * funds. Keeps the row useful when multiple kinds interleave in one day.
 */
function rowPalette(kind: ArkMovementKind, status: ArkMovementStatus, amountSats: number) {
    if (status === 'failed' || status === 'canceled') {
        return { amountColor: colors.gray.light, pillColor: colors.gray.light };
    }
    if (status === 'pending') {
        return { amountColor: colors.ark.light, pillColor: colors.ark.light };
    }
    const amountColor = amountSats >= 0 ? '#4FBF67' : '#FF7A68';
    return { amountColor, pillColor: colors.gray.light };
}

function kindLabel(kind: ArkMovementKind): string {
    switch (kind) {
        case 'lightning': return 'Lightning';
        case 'ark':       return 'Ark';
        case 'onchain':   return 'On-chain';
        case 'board':     return 'Board';
        case 'exit':      return 'Exit';
        case 'refresh':   return 'Refresh';
        default:          return 'Movement';
    }
}

function ArkHistoryRow({ movement, matchedRate, currency }: ArkHistoryRowProps) {
    const { amountSats, feeSats, status, kind, description } = movement;
    const { amountColor, pillColor } = rowPalette(kind, status, amountSats);

    const absSats = Math.abs(amountSats);
    const sign = amountSats >= 0 ? '+' : '-';
    // `matchedRate` from HomeScreen is already USD-per-sat — HomeScreen
    // stores it in that form (see `handleUser` lines 671 + 676-677), so
    // sats × rate = USD. An earlier version multiplied by `btc(1)` again
    // and rendered every row as $0.00 next to a non-zero sats amount.
    const fiatAmount = absSats * matchedRate;

    return (
        <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
                // Pass the full movement object (all plain JS — no bigints
                // or handle references) so the details screen doesn't need
                // to re-call the SDK. Also forward the rate/currency
                // context so it can compute fiat consistently with the row.
                dispatchNavigate('ArkTransactionDetailsScreen', {
                    movement,
                    matchedRate,
                    currency,
                });
            }}
            style={itemStyles.shadowView}
        >
            <Shadow style={itemStyles.shadowTop} inner useArt>
                <View style={itemStyles.inner}>
                    <View style={itemStyles.main}>
                        <View style={itemStyles.imageView}>
                            <Image
                                source={kind === 'lightning' ? Socked : Bitcoin}
                                style={kind === 'lightning' ? itemStyles.image : undefined}
                            />
                        </View>
                        <View style={[itemStyles.des, rowStyles.descCol]}>
                            <Text bold h4 numberOfLines={1}>
                                {description}
                            </Text>
                            <View style={rowStyles.subRow}>
                                <View
                                    style={[
                                        rowStyles.pill,
                                        { borderColor: pillColor },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            rowStyles.pillText,
                                            { color: pillColor },
                                        ]}
                                    >
                                        {kindLabel(kind)}
                                    </Text>
                                </View>
                                {feeSats > 0 && status === 'successful' && (
                                    <Text style={rowStyles.feeText}>
                                        fee {feeSats} sats
                                    </Text>
                                )}
                            </View>
                        </View>
                        <Text h3 style={{ color: amountColor }}>
                            {sign}
                            {absSats} sats
                        </Text>
                    </View>
                    <Text
                        style={StyleSheet.flatten([
                            itemStyles.text,
                            { color: amountColor },
                        ])}
                    >
                        {getStrikeCurrency(currency)}
                        {sign}
                        {fiatAmount.toFixed(2)}
                    </Text>
                    <Shadow inner useArt style={itemStyles.shadowBottom} />
                </View>
            </Shadow>
        </TouchableOpacity>
    );
}

// Local styles for the sub-label row (kind pill + optional fee text). We
// bolt these on top of the shared Items/styles rather than editing that
// file, so other consumers of the shared Items styles aren't affected.
const rowStyles = StyleSheet.create({
    descCol: {
        flex: 1,
        paddingStart: 20,
        justifyContent: 'center',
    },
    subRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    pill: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 1,
        marginRight: 8,
    },
    pillText: {
        fontSize: 10,
        fontFamily: 'Lato-Bold',
    },
    feeText: {
        fontSize: 10,
        color: colors.gray.light,
    },
});
