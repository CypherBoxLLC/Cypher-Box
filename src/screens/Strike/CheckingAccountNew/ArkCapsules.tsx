import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Easing, FlatList, Image, ImageBackground, Switch, TextInput, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { Icon } from "react-native-elements";
import Svg, { Circle } from "react-native-svg";
import SimpleToast from "react-native-simple-toast";
import * as Keychain from "react-native-keychain";

import { Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import { Refresh, Tag, Yes } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { btc as btcHandle } from "@Cypher/helpers/coinosHelper";

import {
    AVG_BLOCK_MINUTES,
    blocksToDays,
    clearArkBgRefreshTelemetry,
    estimateArkRefreshFee,
    getDeviceManufacturer,
    isIgnoringBatteryOptimizations,
    openBatteryOptimizationSettings,
    readArkBgRefreshTelemetry,
    refreshArkVtxosAndSync,
    runBackgroundRefresh,
    setArkBackgroundRefreshEnabled,
    vendorGuidance,
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
    /** Tap on the per-row refresh icon — refresh just this one VTXO. */
    onRefreshIcon: () => void;
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
function VtxoRow({ vtxo, selected, onPress, onRefreshIcon, roundIntervalSecs }: VtxoRowProps) {
    const view = getExpiryView(vtxo.daysLeft);
    const BTCAmount = btcHandle(vtxo.sats) + " BTC";

    // Transient-state animation: while vtxo.pendingRound is true, the
    // refresh icon spins and the gradient card pulses opacity. Both
    // loops start when pendingRound flips on and stop the moment it
    // flips off — the underlying SDK marks pendingRound during a
    // refresh round and clears it on round-completion sync.
    const spinAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    // Animate when EITHER pendingRound (refresh round in-flight) OR the
    // VTXO is in 'in-flight' recoverability state (mid-send / mid-board /
    // mid-exit). Same pulse + spin so the user sees identical transient
    // visuals regardless of which kind of round produced the lock.
    const isTransient = vtxo.pendingRound || vtxo.recoverability === 'in-flight';
    useEffect(() => {
        if (!isTransient) {
            spinAnim.setValue(0);
            pulseAnim.setValue(1);
            return;
        }
        const spin = Animated.loop(
            Animated.timing(spinAnim, {
                toValue: 1,
                // Linear easing for the rotation — eased curves on a
                // looping spinner produce a visible "stop-start" at each
                // cycle boundary which reads as jerky. Linear gives the
                // smooth continuous turn users expect from a spinner.
                // Duration kept at the pulse cycle (1.6s) so a full turn
                // still completes per breath.
                duration: 1600,
                easing: Easing.linear,
                useNativeDriver: true,
            }),
        );
        const pulse = Animated.loop(
            Animated.sequence([
                // Deeper fade (1 → 0.2) for a more obvious breathing
                // pulse — the previous 0.45 was too subtle.
                Animated.timing(pulseAnim, {
                    toValue: 0.2,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        spin.start();
        pulse.start();
        return () => {
            spin.stop();
            pulse.stop();
        };
    }, [isTransient, spinAnim, pulseAnim]);

    const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    // Scale pulse on the icon, derived from the same pulseAnim driving the
    // card opacity so the icon "breathes" in sync. Tightened range from
    // 0.75 → 1.15 (40%) to 0.92 → 1.08 (16%) so the pulse reads as
    // breathing rather than zooming.
    const iconScale = pulseAnim.interpolate({ inputRange: [0.2, 1], outputRange: [0.92, 1.08] });

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
        // Fresh capsule shape — deep-grey → black diagonal gradient with
        // a real drop shadow so the row "sticks out" off the dark page.
        // No always-on border; the yellow borderview lights up only on
        // selection.
        // Inline overrides:
        //   - height bumped 124 → 100 (smaller than the original Hot
        //     Vault row, just slightly taller than the previous 88)
        //   - paddingTop reset to 0 + justifyContent center → vertically
        //     centers the inner TouchableOpacity content within the card
        // Whole row wrapped in Animated.View so the pulse opacity affects
        // the gradient AND the content (text, icon, checkbox) together —
        // before, opacity was only on the gradient sibling so the text
        // stayed fully opaque while the bg breathed, which read as nothing
        // changing.
        <Animated.View style={[
            rowStyles.main,
            { height: 100, paddingTop: 0, justifyContent: 'center', opacity: pulseAnim },
        ]}>
            <LinearGradient
                colors={['#3A3A3A', '#1C1C1C']}
                // Down-right at 30° from vertical — direction vector
                // (sin 30°, cos 30°) ≈ (0.5, 0.866).
                start={{ x: 0, y: 0 }}
                end={{ x: 0.5, y: 0.866 }}
                style={{
                    position: 'absolute',
                    top: 6,
                    bottom: 6,
                    left: 6,
                    right: 18,
                    borderRadius: 16,
                    shadowColor: '#000000',
                    shadowOffset: { width: 5, height: 9 },
                    shadowOpacity: 0.7,
                    shadowRadius: 10,
                    elevation: 10,
                }}
            />
            {/* Selection outline — sits 2pt OUTSIDE the gradient card on
                each side. Gradient inset is 6/6/6/18 → outline inset
                4/4/4/16 places its border 2pt beyond the gradient edge.
                18pt borderRadius matches the gradient's 16 + 2pt offset. */}
            {selected && (
                <View
                    style={{
                        position: 'absolute',
                        top: 4,
                        bottom: 4,
                        left: 4,
                        right: 16,
                        borderRadius: 18,
                        borderWidth: 2,
                        borderColor: colors.ark.light,
                    }}
                />
            )}
            <TouchableOpacity activeOpacity={0.7} style={rowStyles.container} onPress={onPress}>
                {/* Trim the coin (ring) column's flex from 2.2 → 1.5 and
                    bump the size column from 1.8 → 2.8 so the time-left +
                    status row has room to fit on a single line. flexWrap
                    flipped to 'nowrap' + numberOfLines=1 on each Text so
                    they elide rather than wrap if anything overflows. */}
                <View style={[rowStyles.coin, { flex: 1.5 }]}>
                    <VtxoRing daysLeft={ringDaysLeft} />
                </View>
                <View style={[rowStyles.size, { flex: 2.8 }]}>
                    <Text bold style={rowStyles.value}>{BTCAmount}</Text>
                    {/* When the VTXO is in-flight, stack the recoverability
                        label on its own row below — the "⚠ In-flight"
                        message is too important to compete with the days-
                        left text on the same line. Other recoverability
                        states keep the inline " - <text>" layout. */}
                    {vtxo.recoverability === 'in-flight' ? (
                        <>
                            <Text bold numberOfLines={1} style={{ color: labelColor, fontSize: 12, fontStyle: "italic" }}>
                                {labelText}
                            </Text>
                            <Text bold numberOfLines={1} style={{ color: recoverabilityColor, fontSize: 12 }}>
                                {recoverabilityText}
                            </Text>
                        </>
                    ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' }}>
                            <Text bold numberOfLines={1} style={{ color: labelColor, fontSize: 12, fontStyle: "italic" }}>
                                {labelText}
                            </Text>
                            <Text numberOfLines={1} style={{ color: colors.gray.light, fontSize: 12 }}>
                                {" - "}
                            </Text>
                            <Text bold numberOfLines={1} style={{ color: recoverabilityColor, fontSize: 12 }}>
                                {recoverabilityText}
                            </Text>
                        </View>
                    )}
                </View>
                {/* Refresh icon Touchable — independent of the row's
                    select-toggle Touchable wrapping the rest of the row.
                    delayPressIn=0 + hitSlop guarantee the inner press
                    registers BEFORE the outer (otherwise nested
                    TouchableOpacities can let the outer capture first
                    on Android). Generous hit area so users don't need
                    pixel-perfect aim. */}
                <TouchableOpacity
                    style={[rowStyles.label, { alignItems: 'flex-start' }]}
                    onPress={onRefreshIcon}
                    delayPressIn={0}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                    activeOpacity={0.6}
                >
                    {/* Feather refresh-cw — circular two-arrow icon. While
                        pendingRound is true, the spinAnim drives a 360°
                        rotate to telegraph the in-flight refresh. */}
                    <Animated.View style={{ transform: [{ rotate: spinDeg }, { scale: iconScale }] }}>
                        <Icon name="refresh-cw" type="feather" color="#FFFFFF" size={22} />
                    </Animated.View>
                </TouchableOpacity>
                <View style={rowStyles.select}>
                    <View style={rowStyles.checkbox}>
                        {selected && <Image source={Yes} />}
                    </View>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
}

/**
 * PendingLnReceiveRow — ghost capsule for a Lightning receive whose payment
 * has landed at the ASP but whose VTXO hasn't materialised yet.
 *
 * Why this exists: between counterparty-paid-the-invoice and
 * VTXO-appears-in-allVtxos there's a multi-minute gap (the claim has to ride
 * the next Ark round). The history row already flips to "successful" once
 * the preimage is revealed, but the spendable balance stays at 0 and the
 * Capsules tab is empty. Users assume nothing is happening. This row is
 * the visual reassurance: yes, the money is here, the VTXO is just a few
 * minutes away.
 *
 * Visually distinct from real capsules:
 *   - same gradient card shape so it slots into the list cleanly
 *   - ring is a yellow indeterminate spinner (no depletion fraction —
 *     there's nothing to deplete; this isn't a VTXO yet)
 *   - label is "Claiming via round… (~1–3 min)" — italic, yellow
 *   - no per-row refresh icon (nothing to refresh — the ASP is doing the
 *     work)
 *   - no selection checkbox (can't act on it; it'll resolve on its own)
 *   - the entire card pulses opacity, like in-flight VTXOs do, so the
 *     transient state reads at a glance
 *
 * Resolves automatically: when the next sync tick fetches an updated
 * `pendingLightningReceives()` and the entry is gone, the parent's
 * arkPendingLnReceives list shrinks and this row disappears. The
 * accompanying VTXO row should appear on the same tick.
 */
interface PendingLnReceiveRowProps {
    sats: number;
    paymentHash: string;
}

function PendingLnReceiveRow({ sats }: PendingLnReceiveRowProps) {
    const BTCAmount = btcHandle(sats) + " BTC";

    const spinAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        const spin = Animated.loop(
            Animated.timing(spinAnim, {
                toValue: 1,
                duration: 1600,
                easing: Easing.linear,
                useNativeDriver: true,
            }),
        );
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 0.4,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        spin.start();
        pulse.start();
        return () => {
            spin.stop();
            pulse.stop();
        };
    }, [spinAnim, pulseAnim]);

    const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

    return (
        <Animated.View style={[
            rowStyles.main,
            { height: 100, paddingTop: 0, justifyContent: 'center', opacity: pulseAnim },
        ]}>
            <LinearGradient
                colors={['#3A3A3A', '#1C1C1C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.5, y: 0.866 }}
                style={{
                    position: 'absolute',
                    top: 6,
                    bottom: 6,
                    left: 6,
                    right: 18,
                    borderRadius: 16,
                    shadowColor: '#000000',
                    shadowOffset: { width: 5, height: 9 },
                    shadowOpacity: 0.7,
                    shadowRadius: 10,
                    elevation: 10,
                }}
            />
            <View style={rowStyles.container}>
                <View style={[rowStyles.coin, { flex: 1.5 }]}>
                    {/* Indeterminate spinner — a single yellow arc rotating
                        forever. Reusing the VtxoRing geometry (38pt circle,
                        4pt stroke) so the pending row aligns with real
                        capsule rows visually. We draw a 25%-arc by setting
                        dashOffset to 75% of the circumference, then rotate
                        the whole SVG via Animated. */}
                    <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                        <Svg width={RING_SIZE} height={RING_SIZE}>
                            <Circle
                                cx={RING_SIZE / 2}
                                cy={RING_SIZE / 2}
                                r={RING_RADIUS}
                                stroke={colors.gray.disable}
                                strokeWidth={RING_STROKE}
                                fill="transparent"
                                opacity={0.4}
                            />
                            <Circle
                                cx={RING_SIZE / 2}
                                cy={RING_SIZE / 2}
                                r={RING_RADIUS}
                                stroke={colors.ark.light}
                                strokeWidth={RING_STROKE}
                                fill="transparent"
                                strokeDasharray={`${RING_CIRC * 0.25} ${RING_CIRC}`}
                                strokeLinecap="round"
                            />
                        </Svg>
                    </Animated.View>
                </View>
                <View style={[rowStyles.size, { flex: 2.8 }]}>
                    <Text bold style={rowStyles.value}>{BTCAmount}</Text>
                    <Text bold numberOfLines={1} style={{ color: colors.ark.light, fontSize: 12, fontStyle: "italic" }}>
                        Claiming via round…
                    </Text>
                    <Text numberOfLines={1} style={{ color: colors.gray.light, fontSize: 11 }}>
                        Lightning ~1–3 min
                    </Text>
                </View>
                {/* Bolt icon in the refresh column — visually distinguishes
                    a pending Lightning receive from a real capsule. No tap
                    handler: there's nothing the user can do here, the ASP
                    is committing the claim into the next round. */}
                <View style={[rowStyles.label, { alignItems: 'flex-start' }]}>
                    <Icon name="zap" type="feather" color={colors.ark.light} size={22} />
                </View>
                {/* Empty select slot — no checkbox, can't be selected for
                    Send/Refresh actions. We still reserve the column so the
                    row width matches the real capsule rows below. */}
                <View style={rowStyles.select} />
            </View>
        </Animated.View>
    );
}

interface ArkCapsulesProps {
    matchedRate: string;
    currency: any;
}

export default function ArkCapsules({ matchedRate, currency }: ArkCapsulesProps) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [togglingBgRefresh, setTogglingBgRefresh] = useState(false);
    const [runningBgRefresh, setRunningBgRefresh] = useState(false);
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const arkPendingLnReceives = useAuthStore((s) => s.arkPendingLnReceives);
    const chainTipHeight = useAuthStore((s) => s.arkChainTipHeight);
    const arkLastBackupAt = useAuthStore((s) => s.arkLastBackupAt);
    const arkRoundIntervalSecs = useAuthStore((s) => s.arkRoundIntervalSecs);
    const arkBgRefreshEnabled = useAuthStore((s) => s.arkBgRefreshEnabled);
    const arkBgRefreshMaxFeeSats = useAuthStore((s) => s.arkBgRefreshMaxFeeSats);
    const setArkBgRefreshMaxFeeSats = useAuthStore((s) => s.setArkBgRefreshMaxFeeSats);
    // Buffered local string so the user can clear / partially type without
    // the store committing intermediate values like "" or "5". Reconciled
    // with the store value on blur (commitFeeInput).
    const [feeInput, setFeeInput] = useState<string>(String(arkBgRefreshMaxFeeSats));

    // Sum of sats currently locked in pending refresh rounds. Same derivation
    // as ArkWallet/index.tsx (Locked-state VTXO sats), to avoid the SDK's
    // `arkBalanceDetail.pendingInRoundSats` over-counting bug where each
    // queued round contributes its expected output, so re-tapping refresh
    // 5 times against the same VTXO inflates the figure 5×.
    //
    // Used to disable the Refresh action button when a round is in flight,
    // so users don't accidentally queue duplicate rounds at the ASP and
    // think it speeds completion.
    const pendingRoundSats = useMemo(() => {
        return arkVtxos.reduce(
            (sum, v) => (v.state.toLowerCase() === 'locked' ? sum + v.sats : sum),
            0,
        );
    }, [arkVtxos]);

    // Track refresh attempts that have queued a round but haven't visibly
    // resolved yet. Each successful `refreshIds` call bumps this; it resets
    // once `pendingRoundSats` returns to 0 (round committed or timed out
    // server-side). Surfaces as the "(N rounds queued)" suffix in the
    // warning text below — gives the user visibility into "did my last tap
    // do anything?" so they don't spam-tap waiting for action.
    const queuedRoundsCountRef = useRef(0);
    const [queuedRoundsCount, setQueuedRoundsCount] = useState(0);
    useEffect(() => {
        if (pendingRoundSats === 0 && queuedRoundsCountRef.current !== 0) {
            queuedRoundsCountRef.current = 0;
            setQueuedRoundsCount(0);
        }
    }, [pendingRoundSats]);

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

    /**
     * Refresh a specific set of VTXO ids. Reused by the bottom Refresh
     * button (passes selectedIds) and the per-row icon (passes a single
     * vtxo.id). Same fee preview + watchdog + selection-clear semantics
     * either way.
     */
    const refreshIds = async (ids: string[]) => {
        if (refreshing) return;
        if (ids.length === 0) return;

        // Refusing to refresh a VTXO that's already Locked in a pending
        // round — the SDK will just block waiting on the same round, and
        // stacking calls makes it harder to reason about. The user should
        // wait for the existing round to finalise (or time out) first.
        const lockedSelected = rows.filter(
            (r) => ids.includes(r.id) && r.pendingRound,
        );
        if (lockedSelected.length > 0) {
            SimpleToast.show(
                `${lockedSelected.length} capsule(s) already in a pending round — wait for it to finalise before refreshing again`,
                SimpleToast.LONG,
            );
            return;
        }

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
            // Bump the queued-rounds counter as we hand off to the SDK.
            // The counter resets to 0 in the pendingRoundSats === 0 effect
            // above when the round either commits or times out server-side.
            queuedRoundsCountRef.current += 1;
            setQueuedRoundsCount(queuedRoundsCountRef.current);

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

    const handleRefresh = () => {
        if (selectedIds.length === 0) {
            SimpleToast.show("Select capsules to refresh", SimpleToast.SHORT);
            return;
        }
        void refreshIds([...selectedIds]);
    };

    /** Per-row icon — refresh just this single VTXO. The fee preview +
     *  confirmation dialog live inside `refreshIds` so the user still
     *  has to opt in before the round commits. */
    const handleRowRefresh = (vtxoId: string) => {
        void refreshIds([vtxoId]);
    };

    /**
     * DEV-only telemetry surface. Logs the rolling buffer to the JS console
     * (full detail) and shows an Alert with an outcome-by-outcome summary.
     *
     * A more polished in-app screen is straightforward to add when the
     * background-refresh feature ships beyond DEV — for now this keeps the
     * diagnostic surface tight while still making field debugging feasible.
     */
    const handleDumpBgRefreshLog = async () => {
        const entries = await readArkBgRefreshTelemetry();
        if (entries.length === 0) {
            Alert.alert("Bg refresh log", "Empty — no attempts recorded yet.");
            return;
        }
        const counts: Record<string, number> = {};
        for (const e of entries) counts[e.outcome] = (counts[e.outcome] ?? 0) + 1;
        const summary = Object.entries(counts)
            .map(([outcome, count]) => `${outcome}: ${count}`)
            .join("\n");
        console.log("[Ark bg refresh] full telemetry buffer:", entries);
        Alert.alert(
            `Bg refresh log (${entries.length} entries)`,
            `${summary}\n\nFull buffer dumped to JS console.`,
            [
                { text: "OK", style: "cancel" },
                {
                    text: "Clear log",
                    style: "destructive",
                    onPress: async () => {
                        await clearArkBgRefreshTelemetry();
                        SimpleToast.show("Telemetry cleared", SimpleToast.SHORT);
                    },
                },
            ],
        );
    };

    /**
     * DEV-only manual trigger. Runs the full background-refresh policy on
     * the foreground thread so you can verify the orchestrator end-to-end
     * (rate-limit gate, eligibility filter, fee gate, refresh round,
     * telemetry record, store state update) without waiting for native
     * scheduling to land in Phase 2.
     */
    const handleRunBgRefreshNow = async () => {
        if (runningBgRefresh) return;
        setRunningBgRefresh(true);
        try {
            const result = await runBackgroundRefresh('manual-test');
            const fee = result.feeSats === null ? '—' : `${result.feeSats}s`;
            SimpleToast.show(
                `${result.outcome} • ${result.vtxoCount} vtxo • fee ${fee} • ${result.elapsedMs}ms`,
                SimpleToast.LONG,
            );
            if (result.errorMsg) {
                console.warn('[Ark bg refresh manual] error:', result.errorMsg);
            }
        } catch (err: any) {
            // runBackgroundRefresh swallows everything internally — if we
            // land here it's a bug worth surfacing.
            console.warn('[Ark bg refresh manual] unexpected throw:', err);
            SimpleToast.show(
                `Unexpected error: ${err?.message ?? "unknown"}`,
                SimpleToast.LONG,
            );
        } finally {
            setRunningBgRefresh(false);
        }
    };

    /**
     * Commit the fee-gate input on blur. Discards any non-positive value
     * (resets the input to the last-committed store value) — a 0-or-negative
     * ceiling would mean "never auto-pay anything," which is functionally
     * equivalent to disabling the feature, and is more confusingly expressed
     * via the toggle. The minimum sane ceiling is 1 sat.
     */
    const commitFeeInput = () => {
        const parsed = parseInt(feeInput.replace(/[^\d]/g, ''), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            setFeeInput(String(arkBgRefreshMaxFeeSats));
            return;
        }
        setArkBgRefreshMaxFeeSats(parsed);
        setFeeInput(String(parsed));
    };

    /**
     * Toggle the opt-in background VTXO refresh feature.
     *
     * Enable path: read the seed from the biometry-locked primary keychain
     * entry (one prompt), then hand it to the service which writes a
     * background-readable copy under a separate keychain service. Subsequent
     * background wakes can read that copy without user presence.
     *
     * Disable path: deletes the background-readable copy and clears all
     * derived state. The primary biometric entry is untouched.
     */
    const handleToggleBgRefresh = async (next: boolean) => {
        if (togglingBgRefresh) return;
        setTogglingBgRefresh(true);
        try {
            if (next) {
                const creds = await Keychain.getGenericPassword({ service: "ark-seed-phrase" });
                if (!creds || !creds.password) {
                    SimpleToast.show(
                        "Can't enable — seed not in Keychain. Use Recover to type it in first.",
                        SimpleToast.LONG,
                    );
                    return;
                }
                await setArkBackgroundRefreshEnabled(true, creds.password);
                SimpleToast.show("Background refresh enabled", SimpleToast.SHORT);

                // Battery onboarding nudge. AlarmManager fires can be
                // deferred indefinitely under Doze + vendor battery
                // managers (Samsung One UI is the worst offender; see
                // commit ee6f24f's "User-side requirement on Samsung"
                // note). Probing here, on toggle-on, is the right
                // moment — the user just opted into the feature, so a
                // one-time setup walkthrough is expected. iOS resolves
                // true and skips this entirely.
                const ignoring = await isIgnoringBatteryOptimizations();
                if (!ignoring) {
                    const manufacturer = await getDeviceManufacturer();
                    const guidance = vendorGuidance(manufacturer);
                    // Compact native-Alert copy: short, honest framing
                    // of the consequence + minimal vendor-specific
                    // steps. Earlier draft warned about VTXO expiry,
                    // which overstates the stakes — manual refresh in
                    // foreground always works, so the actual loss case
                    // is "user forgot to open the app for weeks AND
                    // skipped this exemption". Toned down to the real
                    // tradeoff: auto-refresh becomes unreliable;
                    // manual still works.
                    const body = [
                        "Android sleeps apps to save battery. Without this, auto-refresh becomes unreliable — you'll need to open Cypher Box manually to keep your VTXO capsules current.",
                        "",
                        ...guidance.steps,
                    ].join("\n");
                    Alert.alert(
                        guidance.headline,
                        body,
                        [
                            { text: "Skip for now", style: "cancel" },
                            {
                                text: "Open Settings",
                                onPress: () => {
                                    openBatteryOptimizationSettings().catch((err) => {
                                        console.warn("[Ark bg refresh toggle] open settings failed:", err);
                                    });
                                },
                            },
                        ],
                        { cancelable: true },
                    );
                }
            } else {
                await setArkBackgroundRefreshEnabled(false);
                SimpleToast.show("Background refresh disabled", SimpleToast.SHORT);
            }
        } catch (err: any) {
            console.warn("[Ark bg refresh toggle] failed:", err);
            SimpleToast.show(
                `Toggle failed: ${err?.message ?? "unknown error"}`,
                SimpleToast.LONG,
            );
        } finally {
            setTogglingBgRefresh(false);
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
                <Text bold style={[vaultStyles.label, { fontSize: 14, textAlign: 'left' }]}>Refresh</Text>
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
                        onRefreshIcon={() => handleRowRefresh(item.id)}
                        roundIntervalSecs={arkRoundIntervalSecs}
                    />
                )}
                // Pending LN receives render ABOVE the VTXO list. They're
                // not real capsules (no VTXO yet, can't be selected, can't
                // be refreshed), so they don't belong in the FlatList data
                // array — that would mix two row shapes through one
                // renderItem. Header keeps them visually attached to the
                // capsule list (so users see them in the same place they'd
                // expect their balance) without polluting the row contract.
                ListHeaderComponent={
                    arkPendingLnReceives.length > 0 ? (
                        <>
                            {arkPendingLnReceives.map((r) => (
                                <PendingLnReceiveRow
                                    key={`pending-ln-${r.paymentHash}`}
                                    sats={r.amountSats}
                                    paymentHash={r.paymentHash}
                                />
                            ))}
                        </>
                    ) : null
                }
                ListEmptyComponent={() =>
                    // When there are no real VTXOs but there's a pending
                    // LN receive, suppress the "No VTXOs yet" message —
                    // the ghost capsule above is the right thing to show,
                    // and the empty-state copy would read as a bug ("history
                    // says I received it but the wallet says I have nothing").
                    arkPendingLnReceives.length > 0 ? null : (
                        <View style={{ alignItems: "center", marginTop: 40 }}>
                            <Text style={{ color: colors.gray.light, fontSize: 13 }}>
                                No VTXOs yet. Receive Bitcoin via Ark to populate.
                            </Text>
                        </View>
                    )
                }
                ListFooterComponent={() => (
                    <>
                        {/* Background-refresh opt-in.
                            Off by default. Copy and behaviour fixed by the spec —
                            flipping on writes a non-biometric copy of the seed to
                            a separate keychain entry; flipping off deletes it.
                            See src/services/ark/backgroundKeychain.ts for the
                            full posture trade-off.

                            Lives inside ListFooterComponent so it scrolls with the
                            capsule list — keeps the list area uncompressed when
                            VTXO count is high and lets users page down to settings. */}
                        <View
                            style={{
                                marginHorizontal: 24,
                                marginTop: 16,
                                paddingVertical: 10,
                                paddingHorizontal: 14,
                                borderRadius: 10,
                                backgroundColor: "#1a1a1a",
                            }}
                        >
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <Text
                                    bold
                                    style={{ fontSize: 14, color: colors.white, flex: 1, marginRight: 12 }}
                                >
                                    Refresh Ark capsules in background
                                </Text>
                                <Switch
                                    value={arkBgRefreshEnabled}
                                    onValueChange={handleToggleBgRefresh}
                                    disabled={togglingBgRefresh}
                                    trackColor={{ false: "#3a3a3a", true: colors.ark.light }}
                                    thumbColor={colors.white}
                                />
                            </View>
                            <Text style={{ fontSize: 12, color: "#888", marginTop: 6, lineHeight: 16 }}>
                                Cypher Box will refresh capsules approaching expiry without
                                opening the app. Requires keeping the wallet seed accessible
                                while your phone is unlocked. Off by default for safety.
                            </Text>
                            {arkBgRefreshEnabled && (
                                <View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        marginTop: 12,
                                        paddingTop: 10,
                                        borderTopWidth: 0.5,
                                        borderTopColor: "#333",
                                    }}
                                >
                                    <View style={{ flex: 1, marginRight: 12 }}>
                                        <Text bold style={{ fontSize: 13, color: colors.white }}>
                                            Auto-pay fee ceiling
                                        </Text>
                                        <Text style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                                            Round skipped if estimated fee exceeds this.
                                        </Text>
                                    </View>
                                    <View
                                        style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                            backgroundColor: "#0f0f0f",
                                            borderRadius: 6,
                                            paddingHorizontal: 8,
                                            minWidth: 90,
                                        }}
                                    >
                                        <TextInput
                                            value={feeInput}
                                            onChangeText={setFeeInput}
                                            onBlur={commitFeeInput}
                                            onEndEditing={commitFeeInput}
                                            keyboardType="number-pad"
                                            returnKeyType="done"
                                            maxLength={9}
                                            style={{
                                                color: colors.white,
                                                fontSize: 13,
                                                paddingVertical: 6,
                                                textAlign: "right",
                                                flex: 1,
                                            }}
                                        />
                                        <Text style={{ fontSize: 11, color: "#888", marginLeft: 4 }}>
                                            sats
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </View>
                        {/* DEV-only diagnostic buttons. Co-located with the bg-refresh
                            toggle since they're meaningless without it. */}
                        {__DEV__ && (
                            <TouchableOpacity
                                onPress={handleRunBgRefreshNow}
                                disabled={runningBgRefresh}
                                style={{ alignSelf: "center", marginTop: 4, paddingVertical: 6, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" }}
                            >
                                {runningBgRefresh && (
                                    <ActivityIndicator
                                        color={colors.ark.light}
                                        style={{ marginRight: 8 }}
                                    />
                                )}
                                <Text
                                    bold
                                    style={{
                                        fontSize: 12,
                                        color: runningBgRefresh ? colors.gray.disable : colors.ark.light,
                                        textDecorationLine: "underline",
                                    }}
                                >
                                    {runningBgRefresh ? "Running bg refresh…" : "Run background refresh now — DEV"}
                                </Text>
                            </TouchableOpacity>
                        )}
                        {__DEV__ && (
                            <TouchableOpacity
                                onPress={handleDumpBgRefreshLog}
                                style={{ alignSelf: "center", marginTop: 4, paddingVertical: 6, paddingHorizontal: 14 }}
                            >
                                <Text
                                    bold
                                    style={{
                                        fontSize: 12,
                                        color: colors.ark.light,
                                        textDecorationLine: "underline",
                                    }}
                                >
                                    Dump bg refresh log — DEV
                                </Text>
                            </TouchableOpacity>
                        )}
                    </>
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
                {/* In-flight indicator. Each refresh attempt queues a fresh
                    round at the ASP — they're independent submissions, not
                    a retry of the prior one. The user pressing Refresh
                    repeatedly while waiting doesn't speed anything up; it
                    just stacks duplicate rounds (each consuming a fee on
                    completion) and inflates the SDK's pending sats count
                    via its expected-output summing bug. Surface the
                    counter + a clear "tapping again won't speed it up"
                    nudge to discourage spam taps. */}
                {queuedRoundsCount > 0 && (
                    <View
                        style={{
                            marginHorizontal: 24,
                            marginBottom: 8,
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            backgroundColor: '#1a1a1a',
                            borderLeftWidth: 3,
                            borderLeftColor: colors.ark.light,
                        }}
                    >
                        <Text bold style={{ fontSize: 12, color: colors.ark.light }}>
                            {queuedRoundsCount === 1
                                ? '1 refresh round queued at Ark server'
                                : `${queuedRoundsCount} refresh rounds queued at Ark server`}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#999', marginTop: 4, lineHeight: 15 }}>
                            Tapping Refresh again won't speed it up — each tap
                            submits a new round and burns another fee on
                            completion. Wait for the round to finalise (typically
                            under a minute) or time out (~few hours) before
                            retrying.
                        </Text>
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
                {/* Background-refresh opt-in card + DEV buttons moved to
                    FlatList ListFooterComponent so they scroll with the
                    capsule list — keeps the list area uncompressed when
                    VTXO count is high. */}
            </View>
        </View>
    );
}
