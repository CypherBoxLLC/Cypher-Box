import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, ImageBackground, TouchableOpacity, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import SimpleToast from "react-native-simple-toast";

import { Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import { Tag, Transaction, Yes } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { btc as btcHandle } from "@Cypher/helpers/coinosHelper";

import {
    AVG_BLOCK_MINUTES,
    blocksToDays,
    estimateArkRefreshFee,
    refreshArkVtxosAndSync,
} from "@Cypher/services/ark";
import useAuthStore from "@Cypher/stores/authStore";
import { colors, widths } from "@Cypher/style-guide";
import vaultStyles from "../../HotStorageVault/styles";
import rowStyles from "../../HotStorageVault/ListView/styles";

/**
 * ArkCapsules — VTXO management surface for the Ark wallet menu.
 *
 * Layout mirrors the Hot Vault Capsules tab so the interaction model is
 * familiar (same Transaction background row, same 4-column grid: visual / size
 * / label / select). The only thing that swaps is the per-row visual: instead
 * of the UTXO capsule mask, we draw a small SVG "depletion ring" — a circle
 * that empties as the VTXO ages and shifts color from green → yellow →
 * orange → red as expiry approaches. Sats amount stays in the Size column
 * (same place Hot Vault shows BTC); nothing renders inside the ring itself.
 *
 * Why no Emergency Exit here: in Cypher Box, withdrawing from Ark = unilateral
 * exit, and that lives behind the global Withdraw button on the home screen.
 * Two paths to the same operation would be confusing.
 *
 * Data source: live VTXO list + chain tip from zustand, populated by the
 * HomeScreen's `useArkSync` hook. Send / Refresh handlers still navigate to
 * placeholder screens — those wire to Bark in Phase 4/5.
 */

// Bark default VTXO lifetime — used as the denominator for the depletion ring
// fraction. Captured once here as a fallback for arkoor VTXOs with no
// expiry height; real expiries come from the SDK via arkVtxos[i].expiryHeight.
const VTXO_MAX_DAYS = 28;
const VTXO_MAX_BLOCKS = Math.round((VTXO_MAX_DAYS * 24 * 60) / AVG_BLOCK_MINUTES);

type ExpiryStatus = "green" | "yellow" | "orange" | "red";

interface ExpiryView {
    status: ExpiryStatus;
    color: string;
    fractionLeft: number; // 0..1 of total VTXO lifetime
}

/**
 * Map days-remaining → ring color + fill fraction. Boundaries chosen so each
 * band covers roughly a quarter of the 28-day window:
 *   ≥21d (≥75% life) → green   — fresh, no action needed
 *   14–20d (50–74%)  → yellow  — past midlife, monitor
 *   7–13d  (25–49%)  → orange  — start thinking about refresh
 *    <7d   (<25%)    → red     — refresh immediately or risk losing exit
 */
function getExpiryView(daysLeft: number): ExpiryView {
    const fractionLeft = Math.max(0, Math.min(1, daysLeft / VTXO_MAX_DAYS));
    if (daysLeft >= 21) return { status: "green",  color: "#4ADE80",        fractionLeft };
    if (daysLeft >= 14) return { status: "yellow", color: colors.ark.light, fractionLeft };
    if (daysLeft >= 7)  return { status: "orange", color: "#FB923C",        fractionLeft };
    return                      { status: "red",   color: colors.redLight,  fractionLeft };
}

// --- Ring constants ---
// Small enough to sit comfortably in the row's "coin" column (matches the
// space the UTXO capsule mask occupies in Hot Vault, but visually distinct so
// users don't confuse VTXOs with UTXOs).
const RING_SIZE = 38;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

interface VtxoRingProps {
    daysLeft: number;
}

/**
 * VtxoRing — small static SVG depletion indicator.
 *
 * Two concentric circles:
 *   - background ring (dim gray, full circle) — track for the depletion
 *   - foreground ring (status color, partial arc) — covers `fractionLeft` of
 *     the circle, starting from 12 o'clock (after -90° rotation transform)
 *     so it visually depletes clockwise as time runs out.
 *
 * No animation, no center text — the row's Size column carries the sats
 * amount; the ring is purely the urgency indicator.
 */
function VtxoRing({ daysLeft }: VtxoRingProps) {
    const view = useMemo(() => getExpiryView(daysLeft), [daysLeft]);
    const dashOffset = RING_CIRC * (1 - view.fractionLeft);

    return (
        <Svg width={RING_SIZE} height={RING_SIZE}>
            {/* Track ring — full circle, dim gray */}
            <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                stroke={colors.gray.disable}
                strokeWidth={RING_STROKE}
                fill="transparent"
                opacity={0.4}
            />
            {/* Depletion ring — partial arc, status color. -90° rotation
                pivots the start point from the SVG default (3 o'clock) to 12
                o'clock so depletion reads as a clock running down. */}
            <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                stroke={view.color}
                strokeWidth={RING_STROKE}
                fill="transparent"
                strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
        </Svg>
    );
}

interface VtxoRowData {
    id: string;
    sats: number;
    /** Days until expiry. May be Infinity for arkoor (no expiryHeight). */
    daysLeft: number;
    /** True when expiryHeight is 0 or chain tip is unknown — hide the "Xd left" line. */
    unknownExpiry: boolean;
    kind: string;
    /**
     * True when the VTXO is mid-round (SDK state `Locked`). Not spendable
     * and its expiry countdown is meaningless — the round either finalises
     * and produces a replacement VTXO, or (if the round stalls) the VTXO
     * eventually flips back to Spendable on the client. Either way, we
     * don't render expiry for it.
     */
    pendingRound: boolean;
    /**
     * Recoverability classification for the per-row badge.
     *
     * The TRUTH about Ark/Bark recovery: VTXOs cannot be reconstructed
     * from the seed alone. The local datadir (VTXO commitments, presigned
     * forfeit txs, exit txs, round state) IS the wallet. The only path to
     * non-destructive recovery is the encrypted ark-backup file produced
     * by `writeArkAutoBackup` (every sync tick) + the original seed phrase.
     *
     * That makes the classification depend on TWO orthogonal axes:
     *
     *   1. Is this VTXO in a state that CAN be backed up at all?
     *      - Pubkey/Spendable: yes (settled, written to datadir)
     *      - Locked / mid-round / mid-HTLC: NO — even with a backup
     *        taken right now, the in-flight state is non-deterministic
     *        and a restore may land you in a stuck round.
     *
     *   2. Is there actually a recent backup that captures it?
     *      - `arkLastBackupAt` is set, AND it postdates this VTXO's
     *        appearance (we approximate this by "any backup at all"
     *        since we don't track per-VTXO creation timestamps).
     *      - Otherwise → user must back up before they can recover.
     *
     * Resulting buckets:
     *   - `'backed-up'`     — Pubkey/Spendable AND `arkLastBackupAt != null`
     *   - `'needs-backup'`  — Pubkey/Spendable but no backup yet
     *   - `'in-flight'`     — Locked / Server HTLC / Board / Exit (not
     *                          backable in this state)
     */
    recoverability: 'backed-up' | 'needs-backup' | 'in-flight';
}

interface VtxoRowProps {
    vtxo: VtxoRowData;
    selected: boolean;
    onPress: () => void;
    /** Round cadence in seconds (from wallet.arkInfo()), null until fetched. */
    roundIntervalSecs: number | null;
}

/**
 * Format the round cadence as an upper-bound suffix for "Refreshing…".
 * Mainnet (3600s) → "1h", signet (300s) → "5m", arbitrary intervals
 * round to whole minutes. Per Erik (Bark team), the SDK doesn't expose
 * `nextRoundAt`, so this is honestly the upper bound — the actual wait is
 * anywhere from a few seconds to one full interval.
 */
function formatRoundUpperBound(secs: number): string {
    if (secs >= 3600 && secs % 3600 === 0) return `${secs / 3600}h`;
    return `${Math.max(1, Math.round(secs / 60))}m`;
}

/**
 * VtxoRow — one VTXO. Same Transaction background + 4-column layout as the
 * Hot Vault ListView. The only swap from Hot Vault is the visual in the
 * "coin" column (depletion ring instead of UTXO capsule mask), and the
 * selection halo color is yellow (Ark) instead of green (Vault).
 */
function VtxoRow({ vtxo, selected, onPress, roundIntervalSecs }: VtxoRowProps) {
    const view = getExpiryView(vtxo.daysLeft);
    const BTCAmount = btcHandle(vtxo.sats) + " BTC";

    // Pending-round VTXOs: flat yellow label, full ring (so the row doesn't
    // read as "almost expired" while it's actually sitting in a round).
    const labelColor = vtxo.pendingRound ? colors.ark.light : view.color;
    const refreshingLabel = roundIntervalSecs != null
        ? `Refreshing… ≤${formatRoundUpperBound(roundIntervalSecs)}`
        : "Refreshing…";
    const labelText = vtxo.pendingRound
        ? refreshingLabel
        : vtxo.unknownExpiry
            ? vtxo.kind
            : `${Math.max(0, Math.round(vtxo.daysLeft))}d left`;
    const ringDaysLeft = vtxo.pendingRound ? VTXO_MAX_DAYS : vtxo.daysLeft;

    // Recoverability suffix — appended to the existing expiry/state line as
    // a second colored span separated by " - ". Three states drive both
    // the icon and the message; see VtxoRowData.recoverability for the
    // full classification rationale.
    //   ✓ Backed up         — Pubkey/Spendable + recent .cbark exists (green)
    //   ⚠ Back up first     — Pubkey/Spendable but no backup recorded (orange)
    //   ⚠ In-flight         — Locked / HTLC / Board / Exit (yellow, can't
    //                          be reliably backed up in this state)
    let recoverabilityText: string;
    let recoverabilityColor: string;
    switch (vtxo.recoverability) {
        case 'backed-up':
            recoverabilityText = "✓ Backed up";
            recoverabilityColor = "#4ADE80";
            break;
        case 'needs-backup':
            recoverabilityText = "⚠ Back up to recover";
            recoverabilityColor = "#FB923C"; // orange — actionable, not just informative
            break;
        case 'in-flight':
        default:
            recoverabilityText = "⚠ In-flight";
            recoverabilityColor = colors.ark.light;
            break;
    }

    return (
        <ImageBackground source={Transaction} style={rowStyles.main}>
            {selected && (
                <View style={[rowStyles.borderview, { borderColor: colors.ark.light }]} />
            )}
            <TouchableOpacity activeOpacity={0.7} style={rowStyles.container} onPress={onPress}>
                <View style={rowStyles.coin}>
                    <VtxoRing daysLeft={ringDaysLeft} />
                </View>
                <View style={rowStyles.size}>
                    <Text bold style={rowStyles.value}>{BTCAmount}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Text bold style={{ color: labelColor, fontSize: 12, fontStyle: "italic" }}>
                            {labelText}
                        </Text>
                        <Text style={{ color: colors.gray.light, fontSize: 12 }}>
                            {" - "}
                        </Text>
                        <Text bold style={{ color: recoverabilityColor, fontSize: 12 }}>
                            {recoverabilityText}
                        </Text>
                    </View>
                </View>
                <TouchableOpacity style={rowStyles.label} onPress={onPress}>
                    <Image source={Tag} />
                </TouchableOpacity>
                <View style={rowStyles.select}>
                    <View style={rowStyles.checkbox}>
                        {selected && <Image source={Yes} />}
                    </View>
                </View>
            </TouchableOpacity>
        </ImageBackground>
    );
}

interface ArkCapsulesProps {
    matchedRate: string;
    currency: any;
}

export default function ArkCapsules({ matchedRate, currency }: ArkCapsulesProps) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const chainTipHeight = useAuthStore((s) => s.arkChainTipHeight);
    const arkLastBackupAt = useAuthStore((s) => s.arkLastBackupAt);
    const arkRoundIntervalSecs = useAuthStore((s) => s.arkRoundIntervalSecs);

    // Project SDK VTXOs → row data with days-until-expiry computed from the
    // current chain tip. If tip is unknown (esplora offline) we render a
    // full green ring and hide the "Xd left" line — still visible, but with
    // no misleading time estimate.
    const rows: VtxoRowData[] = useMemo(() => {
        return arkVtxos.map((v) => {
            const stateLower = v.state.toLowerCase();
            const kindLower = v.kind.toLowerCase();
            const pendingRound = stateLower === "locked";

            // Tri-state recoverability — see VtxoRowData.recoverability
            // for the full reasoning. Quick summary: a Pubkey/Spendable
            // VTXO can be safely backed up (and therefore recovered);
            // anything in flight cannot. The user-facing distinction
            // between "Backed up" and "Back up first" is whether
            // arkLastBackupAt is set — not whether it postdates this
            // specific VTXO (we don't track per-VTXO mtime). That's
            // slightly optimistic when a fresh VTXO appears AFTER the
            // last backup, but the existence of any backup is the
            // dominant signal users care about.
            const isStablyOwned = kindLower === 'pubkey' && stateLower === 'spendable';
            const recoverability: 'backed-up' | 'needs-backup' | 'in-flight' =
                !isStablyOwned
                    ? 'in-flight'
                    : arkLastBackupAt
                        ? 'backed-up'
                        : 'needs-backup';

            // expiryHeight === 0 happens for arkoor VTXOs that inherit their
            // parent's expiry rather than declaring their own.
            if (v.expiryHeight === 0 || chainTipHeight === null) {
                return {
                    id: v.id,
                    sats: v.sats,
                    daysLeft: VTXO_MAX_DAYS, // maxed-out ring → neutral visual
                    unknownExpiry: true,
                    kind: v.kind,
                    pendingRound,
                    recoverability,
                };
            }
            const blocksLeft = Math.max(0, v.expiryHeight - chainTipHeight);
            return {
                id: v.id,
                sats: v.sats,
                daysLeft: blocksToDays(Math.min(blocksLeft, VTXO_MAX_BLOCKS)),
                unknownExpiry: false,
                kind: v.kind,
                pendingRound,
                recoverability,
            };
        });
    }, [arkVtxos, chainTipHeight, arkLastBackupAt]);

    const toggle = (id: string) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
        );
    };

    const { totalBTC, totalUSD } = useMemo(() => {
        const totalSats = rows
            .filter((v) => selectedIds.includes(v.id))
            .reduce((acc, v) => acc + v.sats, 0);
        const totalBTC = btcHandle(totalSats);
        const totalUSD = Number(totalBTC) * Number(matchedRate || 0);
        return { totalBTC, totalUSD };
    }, [rows, selectedIds, matchedRate]);

    // --- Action handlers ---
    //
    // Send goes to the dedicated ArkSendScreen. Note the `selectedVtxoIds`
    // list is NOT forwarded: the Bark SDK auto-selects VTXO inputs internally
    // and provides no API to pre-pin them. The capsule selector in this tab
    // therefore doesn't influence send composition — it's retained because
    // it's still meaningful for the Refresh action below. If the user wants
    // to force a specific set of old VTXOs to be spent first, they need to
    // refresh the others out of the way before sending.

    const handleSend = () => {
        dispatchNavigate("ArkSendScreen", {
            matchedRate,
            currency,
        });
    };

    const handleRefresh = async () => {
        if (selectedIds.length === 0) {
            SimpleToast.show("Select capsules to refresh", SimpleToast.SHORT);
            return;
        }
        if (refreshing) return;

        // Refusing to refresh a VTXO that's already Locked in a pending
        // round — the SDK will just block waiting on the same round, and
        // stacking calls makes it harder to reason about. The user should
        // wait for the existing round to finalise (or time out) first.
        const lockedSelected = rows.filter(
            (r) => selectedIds.includes(r.id) && r.pendingRound,
        );
        if (lockedSelected.length > 0) {
            SimpleToast.show(
                `${lockedSelected.length} capsule(s) already in a pending round — wait for it to finalise before refreshing again`,
                SimpleToast.LONG,
            );
            return;
        }

        const ids = [...selectedIds];
        setRefreshing(true);
        try {
            const fee = await estimateArkRefreshFee(ids);
            // Present fee preview + confirmation before committing. Round is
            // blocking and can take seconds-to-minutes, so the user should
            // opt in explicitly rather than have it happen silently.
            const confirmed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    "Refresh capsules?",
                    `Re-board ${ids.length} capsule(s) into a new Ark round for ~${fee.feeSats} sats. ` +
                    `This extends their expiry by another full lifetime and may take up to a minute.`,
                    [
                        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                        { text: "Refresh", onPress: () => resolve(true) },
                    ],
                    { cancelable: true, onDismiss: () => resolve(false) },
                );
            });
            if (!confirmed) {
                setRefreshing(false);
                return;
            }

            // Watchdog: we don't want the spinner to be held hostage if the
            // ASP round drags on or the SDK never surfaces completion (we've
            // observed rounds sitting in the Locked state for many minutes
            // while the server thinks about it). The underlying SDK call
            // can't be cancelled — Bark doesn't expose an AbortSignal —
            // but we DO want the UI to release. After the timeout we stop
            // waiting on the refresh promise and trust the 30s `useArkSync`
            // loop to catch completion: when `pendingInRoundSats` drops to
            // 0 and the Locked VTXO turns Spendable, the capsules view
            // rerenders on its own. We attach a passive `.catch` so an
            // eventual rejection from the detached promise doesn't become
            // an unhandled rejection.
            const WATCHDOG_MS = 90_000;
            type RefreshResult = Awaited<ReturnType<typeof refreshArkVtxosAndSync>>;
            const refreshPromise: Promise<RefreshResult> = refreshArkVtxosAndSync(ids);
            // Detach the rejection handler so the promise won't complain
            // if it settles after the watchdog fires.
            refreshPromise.catch((detachedErr) => {
                console.warn('[Ark refresh] detached promise eventually rejected:', detachedErr);
            });
            const timeoutSentinel = Symbol('refresh-watchdog');
            const raced = await Promise.race<RefreshResult | typeof timeoutSentinel>([
                refreshPromise,
                new Promise((resolve) =>
                    setTimeout(() => resolve(timeoutSentinel), WATCHDOG_MS),
                ),
            ]);
            if (raced === timeoutSentinel) {
                // Fall back to "it's in flight" UX. Clear the selection so
                // the user can't accidentally re-trigger the same IDs —
                // they're now marked pendingRound in the row data anyway.
                setSelectedIds([]);
                SimpleToast.show(
                    `Refresh still in progress — this can take a minute on busy rounds. ` +
                    `Your capsule will appear here when it finalises.`,
                    SimpleToast.LONG,
                );
            } else {
                setSelectedIds([]);
                SimpleToast.show(
                    raced.roundId
                        ? `Refreshed ${ids.length} capsule(s) in round ${raced.roundId.slice(0, 8)}…`
                        : `Refresh completed for ${ids.length} capsule(s)`,
                    SimpleToast.LONG,
                );
            }
        } catch (err: any) {
            // BarkError.Internal is the SDK's opaque catch-all when the ASP
            // rejects the round submission. The most common cause we've
            // observed is a VTXO below the ASP's (undocumented, server-side)
            // minimum round-participant size — typically the smallest
            // Pubkey/Spendable VTXO refusing to refresh while larger ones
            // succeed. Translate it into something actionable instead of
            // surfacing the raw enum name.
            const msg: string = err?.message ?? '';
            const totalSats = rows
                .filter((r) => ids.includes(r.id))
                .reduce((acc, r) => acc + r.sats, 0);
            const isInternalLikelyDust =
                /BarkError\.Internal/i.test(msg) && totalSats > 0 && totalSats < 500;
            SimpleToast.show(
                isInternalLikelyDust
                    ? `Refresh rejected by Ark server. ${totalSats}-sat capsule is likely below the round's minimum size — consolidate it via a self-send before refreshing.`
                    : `Refresh failed: ${msg || 'unknown error'}`,
                SimpleToast.LONG,
            );
        } finally {
            setRefreshing(false);
        }
    };

    const renderActionButton = (label: string, onPress: () => void) => (
        <GradientView
            onPress={onPress}
            style={{ shadowColor: "#040404", shadowOffset: { width: 4, height: 4 }, shadowOpacity: 0.8, shadowRadius: 8, elevation: 6, marginHorizontal: 8 }}
            linearGradientStyle={{ shadowColor: "#27272C", shadowOffset: { width: -4, height: -4 }, shadowOpacity: 0.48, shadowRadius: 6, elevation: 6 }}
            topShadowStyle={{ shadowOffset: { width: 2, height: 2 }, shadowRadius: 2, shadowColor: colors.ark.shadowTopNew, borderRadius: 22, width: widths * 0.36, height: 42, justifyContent: "center", alignItems: "center" }}
            bottomShadowStyle={{ shadowOffset: { width: -2, height: -2 }, shadowRadius: 2, shadowOpacity: 0.7, shadowColor: colors.ark.dark, borderRadius: 22, width: widths * 0.36, height: 42, justifyContent: "center", position: "absolute" }}
            linearGradientStyleMain={{ borderRadius: 22, height: 42, justifyContent: "center", alignItems: "center", width: widths * 0.36 }}
        >
            <Text bold center style={{ fontSize: 14, color: colors.ark.light }}>{label}</Text>
        </GradientView>
    );

    return (
        <View style={vaultStyles.flex}>
            {/* Explainer header — VTXO vocabulary + behavior in one short paragraph.
                Uses the same desc style Hot Vault uses for its "Select your UTXO
                capsules to send..." line, so the tab feels consistent. */}
            <Text bold style={[vaultStyles.desc, { marginRight: 20 }]}>
                Select your VTXO capsules to send or refresh. The ring around
                each capsule depletes as it ages (green → yellow → orange →
                red). Refresh before it runs out to keep your funds in Ark.
                To withdraw from Ark entirely, use the Withdraw button on
                the home screen.
            </Text>

            {/* Recoverability legend — three colour-coded states matching
                the per-row suffix below. Bark VTXOs aren't seed-derivable,
                so "recoverable" means "backed up to a .cbark file plus
                you have the seed". See VtxoRowData.recoverability for the
                full classification. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 20, marginBottom: 6 }}>
                <Text style={{ color: '#4ADE80', fontSize: 11, marginRight: 10 }}>
                    ✓ Backed up
                </Text>
                <Text style={{ color: '#FB923C', fontSize: 11, marginRight: 10 }}>
                    ⚠ Back up to recover
                </Text>
                <Text style={{ color: colors.ark.light, fontSize: 11 }}>
                    ⚠ In-flight
                </Text>
            </View>

            {/* Column header row — matches Hot Vault's layout */}
            <View style={vaultStyles.titleStyle}>
                <Text bold style={vaultStyles.coin}>Capsules</Text>
                <Text bold style={vaultStyles.size}>Size</Text>
                <Text bold style={vaultStyles.label}>Label</Text>
                <Text bold style={vaultStyles.select}>Select</Text>
            </View>
            <View style={vaultStyles.border} />

            <FlatList
                data={rows}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                    <VtxoRow
                        vtxo={item}
                        selected={selectedIds.includes(item.id)}
                        onPress={() => toggle(item.id)}
                        roundIntervalSecs={arkRoundIntervalSecs}
                    />
                )}
                ListEmptyComponent={() => (
                    <View style={{ alignItems: "center", marginTop: 40 }}>
                        <Text style={{ color: colors.gray.light, fontSize: 13 }}>
                            No VTXOs yet. Receive Bitcoin via Ark to populate.
                        </Text>
                    </View>
                )}
                style={{ marginTop: 10 }}
            />

            {/* Selection summary + action row. Two actions only: Send (consume
                selected VTXOs as a payment) and Refresh (re-board to extend
                expiry). No Emergency Exit here — that's the global Withdraw
                button's job, see the file docblock. */}
            <View style={vaultStyles.bottomViewNew}>
                <Text h2 center>Size of selected capsules:</Text>
                <View style={vaultStyles.priceView}>
                    <View
                        style={{
                            backgroundColor: colors.black.bg,
                            borderRadius: 21,
                            borderWidth: 1,
                            borderColor: selectedIds.length > 0 ? colors.ark.light : colors.gray.disable,
                            paddingHorizontal: 14,
                            height: 38,
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 162,
                        }}
                    >
                        <Text bold style={{ fontSize: 14, color: colors.white }}>
                            {totalBTC} BTC
                        </Text>
                    </View>
                    <Text h2 bold numberOfLines={1} style={{ marginStart: 10, width: 100 }}>
                        ~$ {totalUSD.toFixed(2)}
                    </Text>
                </View>
                <Text bold center style={vaultStyles.tips}>
                    Tip: Refresh capsules nearing expiry to keep your unilateral exit valid.
                </Text>
                <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginBottom: 12 }}>
                    {renderActionButton("Send", handleSend)}
                    {renderActionButton(
                        refreshing ? "Refreshing…" : "Refresh",
                        refreshing ? () => {} : handleRefresh,
                    )}
                </View>
                {refreshing && (
                    <View style={{ alignItems: "center", marginBottom: 8 }}>
                        <ActivityIndicator color={colors.ark.light} />
                    </View>
                )}
                {/* Pointer to the Emergency Exit path. Lives on the
                    Capsules tab because that's where the user is when
                    they're worrying about their Ark balance — the actual
                    exit lives in Settings to keep this surface focused
                    on per-capsule actions (refresh / send). */}
                <Text
                    style={{
                        fontSize: 11,
                        color: '#777',
                        textAlign: 'center',
                        marginTop: 8,
                        paddingHorizontal: 24,
                    }}
                >
                    Don't trust the Ark server? Settings → Emergency Exit will
                    sweep funds back on-chain without ASP cooperation.
                </Text>
            </View>
        </View>
    );
}
