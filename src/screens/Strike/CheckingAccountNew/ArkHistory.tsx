import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Linking,
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
import { btc } from '@Cypher/helpers/bitcoinUnits';
import {
    fetchArkHistory,
    type ArkMovementKind,
    type ArkMovementStatus,
    type ArkMovementView,
} from '@Cypher/services/ark';
import { colors } from '@Cypher/style-guide';
import screenHeight from '@Cypher/style-guide/screenHeight';
import useAuthStore from '@Cypher/stores/authStore';
import useEventLogStore, { type AppEvent } from '@Cypher/stores/eventLogStore';

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

// One row in the merged history timeline: either an Ark movement (from bark's
// local SQLite history) or an on-chain recovery (F3 — a below-min boarding
// deposit drained back out on-chain, which bark's Ark history never returns
// because it's a BDK transaction, not an Ark/VTXO movement).
type RecoverEvent = Extract<AppEvent, { kind: 'ark-onchain-recovered' }>;
type HistoryEntry =
    | { type: 'movement'; key: string; sortTs: number; movement: ArkMovementView }
    | { type: 'recover'; key: string; sortTs: number; recover: RecoverEvent };

export default function ArkHistory({ matchedRate, currency }: ArkHistoryProps) {
    const [movements, setMovements] = useState<ArkMovementView[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    // Refresh rows are internal capsule-roll operations — net delta is
    // just the round fee (0–2 sats), no external counterparty. They
    // dominate the list once bg-refresh is on (one per round, many per
    // day) and read as "Sent via Ark · -2 sats" noise that buries the
    // user's actual sends/receives. Hide by default; expose a single
    // header toggle for power users / triage.
    const [showRefreshes, setShowRefreshes] = useState(false);

    // Piggy-back on the global sync tick: when useArkSync completes a cycle
    // (every 30s or after a manual refresh), arkLastSyncedAt changes and we
    // re-pull history. Keeps the tab fresh without needing our own interval.
    const lastSyncedAt = useAuthStore((s) => s.arkLastSyncedAt);
    // Pending LN receives — entries here are payments that have landed at
    // the ASP but whose VTXO hasn't materialised yet. We use the invoice
    // string as the join key with movement.receivedOn to tag the matching
    // history row as "still claiming" rather than letting the SDK's
    // "successful" status read as fully done.
    const arkPendingLnReceives = useAuthStore((s) => s.arkPendingLnReceives);
    const pendingLnInvoices = React.useMemo(
        () => new Set(arkPendingLnReceives.map((r) => r.invoice)),
        [arkPendingLnReceives],
    );

    // On-chain recoveries (F3) are recorded in the event log, not bark's Ark
    // history. Pull them out and merge them into the timeline below. Subscribing
    // to the store means the list updates the instant a recovery is broadcast.
    const allEvents = useEventLogStore((s) => s.events);
    const recoverEvents = React.useMemo(
        () => allEvents.filter((e): e is RecoverEvent => e.kind === 'ark-onchain-recovered'),
        [allEvents],
    );

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

    // Refresh count for the toggle header — calculated against the full
    // list, not the filtered one, so the user always sees how many they're
    // hiding. Counts both successful and pending refreshes; failed/canceled
    // are excluded since they wouldn't bury the list visually anyway.
    const refreshCount = React.useMemo(
        () =>
            movements.filter(
                (m) =>
                    m.kind === 'refresh' &&
                    (m.status === 'successful' || m.status === 'pending'),
            ).length,
        [movements],
    );

    // Hide refreshes from the default view. The toggle header at the top of
    // the list flips this. Failed/canceled refreshes still surface — they're
    // rare and worth seeing so users notice when bg-refresh is misbehaving.
    const visibleMovements = React.useMemo(() => {
        if (showRefreshes) return movements;
        return movements.filter(
            (m) =>
                m.kind !== 'refresh' ||
                m.status === 'failed' ||
                m.status === 'canceled',
        );
    }, [movements, showRefreshes]);

    // Group by local-day string — matches how the Strike/CoinOS History tab
    // formats its section headers (Date.toDateString(), e.g. "Fri Apr 24 2026").
    const sections = React.useMemo(() => {
        // Merge Ark movements and on-chain recoveries into one timeline.
        const entries: HistoryEntry[] = [
            ...visibleMovements.map((m) => ({
                type: 'movement' as const,
                key: `m-${m.id}`,
                sortTs: m.timestamp,
                movement: m,
            })),
            ...recoverEvents.map((r) => ({
                type: 'recover' as const,
                key: `r-${r.id}`,
                sortTs: r.ts,
                recover: r,
            })),
        ];
        // Both inputs are newest-first on their own, but interleaving two
        // streams needs an explicit timestamp sort to stay newest-first.
        entries.sort((a, b) => b.sortTs - a.sortTs);
        const byDay: Record<string, HistoryEntry[]> = {};
        for (const e of entries) {
            const day = new Date(e.sortTs).toDateString();
            (byDay[day] ??= []).push(e);
        }
        return Object.entries(byDay).map(([title, data]) => ({ title, data }));
    }, [visibleMovements, recoverEvents]);

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
        // overflow: 'hidden' clips transaction rows that scroll above the
        // SectionList's top edge — without it, rows were visible above
        // the sticky date header bounds while scrolling.
        <View style={[styles.container, { overflow: 'hidden' }]}>
            <SectionList
                sections={sections}
                stickySectionHeadersEnabled
                ListHeaderComponent={
                    refreshCount > 0 ? (
                        <TouchableOpacity
                            onPress={() => setShowRefreshes((v) => !v)}
                            activeOpacity={0.7}
                            style={refreshToggleStyles.row}
                        >
                            <Text style={refreshToggleStyles.text}>
                                {showRefreshes
                                    ? `Hide ${refreshCount} capsule refresh${refreshCount === 1 ? '' : 'es'}`
                                    : `${refreshCount} capsule refresh${refreshCount === 1 ? '' : 'es'} hidden, tap to show`}
                            </Text>
                        </TouchableOpacity>
                    ) : null
                }
                keyExtractor={(item, index) => `${item.key}-${index}`}
                renderSectionHeader={({ section: { title } }) => (
                    <Header title={title} />
                )}
                renderItem={({ item }) =>
                    item.type === 'recover' ? (
                        <RecoverHistoryRow recover={item.recover} />
                    ) : (
                        <ArkHistoryRow
                            movement={item.movement}
                            matchedRate={Number(matchedRate) || 0}
                            currency={currency}
                            // True when this is a Lightning receive whose
                            // payment has landed but whose VTXO hasn't
                            // materialised yet. Drives a "Claiming via round"
                            // badge that overrides the SDK's "successful"
                            // pill so users don't think it's fully done.
                            isClaimingLn={
                                item.movement.kind === 'lightning' &&
                                item.movement.amountSats > 0 &&
                                item.movement.receivedOn.some((addr) => pendingLnInvoices.has(addr))
                            }
                        />
                    )
                }
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
    /**
     * True when this Lightning-receive row is mid-claim: the payment has
     * landed at the ASP but the resulting VTXO hasn't appeared in the
     * wallet's spendable list yet. The SDK reports the movement status as
     * "successful" the moment the preimage is revealed, several minutes
     * before the round commits the receive into a VTXO — without this
     * flag the row reads as fully done while the balance still sits at 0.
     * Drives a yellow "Claiming via round…" pill that visually overrides
     * the success state until the VTXO materialises.
     */
    isClaimingLn?: boolean;
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
        // Was "Movement" — Bam: drop it. Empty string + the pill is
        // hidden below when the label is empty so unknown-kind rows
        // don't render an empty pill outline.
        default:          return '';
    }
}

function ArkHistoryRow({ movement, matchedRate, currency, isClaimingLn }: ArkHistoryRowProps) {
    const { amountSats, feeSats, status, kind, description } = movement;
    // While a LN receive is mid-claim, render the row with the same yellow
    // palette a "pending" movement would get — even though the SDK already
    // moved it to "successful". The amount stays a coloured number rather
    // than a green inflow so the user reads it as in-flight value, not
    // settled value.
    const palette = isClaimingLn
        ? { amountColor: colors.ark.light, pillColor: colors.ark.light }
        : rowPalette(kind, status, amountSats);
    const { amountColor, pillColor } = palette;

    const absSats = Math.abs(amountSats);
    const sign = amountSats >= 0 ? '+' : '-';
    // `matchedRate` from HomeScreen is now USD-per-BTC (set by handleUser
    // via setMatchedRate(getFiatRate('USD')) — fix(coinos): use BlueWallet
    // USD rate as single source). Convert sats → BTC with btc(1) (= 1e-8)
    // before multiplying by the rate. An earlier iteration of this comment
    // assumed USD-per-sat and dropped the btc(1) factor; after the rate
    // unit flipped, that produced a 1e8× inflated fiat figure.
    const fiatAmount = absSats * matchedRate * btc(1);

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
                                {/* Override the description while in-flight
                                    so the row doesn't read as "Received via
                                    Lightning" (i.e. done) when the VTXO is
                                    still being condensed at the ASP. */}
                                {isClaimingLn ? 'Claiming via round…' : description}
                            </Text>
                            <View style={rowStyles.subRow}>
                                {kindLabel(kind) !== '' && (
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
                                )}
                                {/* Second pill — "~1–3 min" ETA — only on
                                    rows that are mid-claim. Sits next to
                                    the Lightning kind pill so the row reads
                                    "Lightning · ~1–3 min" at a glance. */}
                                {isClaimingLn && (
                                    <View
                                        style={[
                                            rowStyles.pill,
                                            { borderColor: colors.ark.light, marginLeft: 0 },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                rowStyles.pillText,
                                                { color: colors.ark.light },
                                            ]}
                                        >
                                            ~1–3 min
                                        </Text>
                                    </View>
                                )}
                                {feeSats > 0 && status === 'successful' && !isClaimingLn && (
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

/**
 * Row for an on-chain recovery (F3): a below-minimum boarding deposit that was
 * too small to ever board into a VTXO, drained back out on-chain. It's a BDK
 * transaction (carries a txid, not a vtxo id) and bark's Ark history never
 * returns it, so it comes from the event log. Tapping the row opens the tx in
 * a block explorer. Visual structure mirrors ArkHistoryRow for list parity.
 */
function RecoverHistoryRow({ recover }: { recover: RecoverEvent }) {
    const detail =
        recover.dest === 'hot-vault'
            ? 'Too small to onboard to Ark. Sent back to your Hot Vault.'
            : 'Too small to onboard to Ark. Sent on-chain to the address you entered.';
    const openExplorer = () => {
        const url = `https://mempool.space/tx/${recover.txid}#details`;
        Linking.openURL(url).catch((err) => console.error('[Ark history] explorer open failed', err));
    };
    return (
        <TouchableOpacity activeOpacity={0.85} onPress={openExplorer} style={itemStyles.shadowView}>
            <Shadow style={itemStyles.shadowTop} inner useArt>
                <View style={itemStyles.inner}>
                    <View style={itemStyles.main}>
                        <View style={itemStyles.imageView}>
                            <Image source={Bitcoin} />
                        </View>
                        <View style={[itemStyles.des, rowStyles.descCol]}>
                            <Text bold h4 numberOfLines={1}>
                                On-chain recovery
                            </Text>
                            <View style={rowStyles.subRow}>
                                <View style={[rowStyles.pill, { borderColor: colors.gray.light }]}>
                                    <Text style={[rowStyles.pillText, { color: colors.gray.light }]}>
                                        On-chain
                                    </Text>
                                </View>
                                {recover.feeSats > 0 && (
                                    <Text style={rowStyles.feeText}>fee {recover.feeSats} sats</Text>
                                )}
                            </View>
                        </View>
                        <Text h3 style={{ color: '#4FBF67' }}>
                            +{recover.sats} sats
                        </Text>
                    </View>
                    <Text style={recoverRowStyles.detail} numberOfLines={2}>
                        {detail}
                    </Text>
                    <Text style={recoverRowStyles.explorerLink}>
                        View in Bitcoin network explorer
                    </Text>
                    <Shadow inner useArt style={itemStyles.shadowBottom} />
                </View>
            </Shadow>
        </TouchableOpacity>
    );
}

const recoverRowStyles = StyleSheet.create({
    detail: {
        marginTop: 8,
        fontSize: 12,
        color: colors.gray.light,
        lineHeight: 17,
    },
    explorerLink: {
        marginTop: 6,
        fontSize: 12,
        color: '#4FBF67',
        fontFamily: 'Lato-Bold',
    },
});

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

// Header row above the section list: "N capsule refreshes hidden — show".
// Tapping flips `showRefreshes` to interleave them back into the day
// sections. Kept understated (small, gray) so it doesn't compete with
// the actual transaction rows for visual attention.
const refreshToggleStyles = StyleSheet.create({
    row: {
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: '#1a1a1a',
        alignItems: 'center',
    },
    text: {
        fontSize: 12,
        color: colors.gray.light,
        fontFamily: 'Lato-Medium',
    },
});
