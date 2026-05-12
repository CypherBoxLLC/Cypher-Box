import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Easing, FlatList, Image, ImageBackground, Text as RNText, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { Icon } from "react-native-elements";
import Svg, { Circle } from "react-native-svg";
import SimpleToast from "react-native-simple-toast";

import { Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import { Refresh, Tag, Yes } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { formatCapsuleAmount } from "@Cypher/helpers/bitcoinUnits";

import {
    ARK_REFRESH_MIN_SATS,
    ARK_VTXO_DUST_SATS,
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
    const BTCAmount = formatCapsuleAmount(vtxo.sats);

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
            {/* Outer row tap toggles selection. For expired-dust
                capsules the checkbox is suppressed (no refresh, no
                send), so the tap has nothing useful to toggle —
                disable it to avoid an invisible "selected" state
                that the user can't see or act on. */}
            <TouchableOpacity
                activeOpacity={vtxo.sats <= ARK_VTXO_DUST_SATS && vtxo.daysLeft <= 0 ? 1 : 0.7}
                style={rowStyles.container}
                onPress={vtxo.sats <= ARK_VTXO_DUST_SATS && vtxo.daysLeft <= 0 ? undefined : onPress}
            >
                {/* Trim the coin (ring) column's flex from 2.2 → 1.5 and
                    bump the size column from 1.8 → 2.8 so the time-left +
                    status row has room to fit on a single line. flexWrap
                    flipped to 'nowrap' + numberOfLines=1 on each Text so
                    they elide rather than wrap if anything overflows. */}
                <View style={[rowStyles.coin, { flex: 1.5 }]}>
                    <VtxoRing daysLeft={ringDaysLeft} />
                </View>
                <View style={[rowStyles.size, { flex: 2.8 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' }}>
                        <Text bold style={rowStyles.value}>{BTCAmount}</Text>
                        {/* Dust badge: capsules at or below the on-chain
                            dust limit can't be refreshed (ASP rejects)
                            and create stranded change if used in a send
                            (both outputs would also be dust). The pill
                            is the only persistent visual signal a user
                            has that this capsule is functionally dead;
                            no other affordance in the app warns them.
                            Pre-flight gates in handleRefresh + ArkSend
                            reject attempts that would touch these. */}
                        {/* Inline DUST pill only for LIVE dust — for
                            expired dust the pill lives in the action
                            column instead (replacing the refresh icon
                            + checkbox, since neither is reachable
                            anymore). Keeps the row's right edge
                            telling the user "this is dead" instead of
                            duplicating the badge in two places. */}
                        {vtxo.sats <= ARK_VTXO_DUST_SATS && vtxo.daysLeft > 0 && (
                            <View
                                style={{
                                    marginLeft: 6,
                                    paddingHorizontal: 5,
                                    paddingVertical: 1,
                                    borderRadius: 4,
                                    borderWidth: 1,
                                    borderColor: '#FF7A68',
                                }}
                            >
                                {/* RNText (not the @Cypher Text wrapper):
                                    the wrapper's styles.default sets
                                    color: white and our inline color
                                    loses the cascade under Fabric, so
                                    the pill rendered as white text on
                                    a red border. Going direct keeps
                                    the red. */}
                                <RNText style={{ fontSize: 9, color: '#FF7A68', fontWeight: '700' }}>
                                    DUST
                                </RNText>
                            </View>
                        )}
                    </View>
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
                {vtxo.sats <= ARK_VTXO_DUST_SATS && vtxo.daysLeft <= 0 ? (
                    // Expired-dust action area: no refresh icon, no
                    // checkbox — neither operation is reachable. The
                    // EXPIRED DUST badge expands to take the combined
                    // width of the icon + select columns (flex 2),
                    // so the entire right side of the row reads as a
                    // single inert "this is dead" indicator instead
                    // of two empty boxes where affordances used to
                    // live. Outer row tap is also disabled below.
                    <View
                        style={{
                            flex: 2,
                            marginRight: 8,
                            marginVertical: 6,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: '#888',
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingVertical: 6,
                            paddingHorizontal: 4,
                        }}
                    >
                        <RNText style={{ fontSize: 10, color: '#888', fontWeight: '700', textAlign: 'center' }}>
                            EXPIRED DUST
                        </RNText>
                    </View>
                ) : (
                    <>
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
                    </>
                )}
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
    const BTCAmount = formatCapsuleAmount(sats);

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
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const arkPendingLnReceives = useAuthStore((s) => s.arkPendingLnReceives);
    const chainTipHeight = useAuthStore((s) => s.arkChainTipHeight);
    const arkLastBackupAt = useAuthStore((s) => s.arkLastBackupAt);
    const arkRoundIntervalSecs = useAuthStore((s) => s.arkRoundIntervalSecs);
    // Read-only on this screen — the toggle lives on the Ark Settings
    // tab. Surfaced as a small on/off status above the explainer tagline
    // so users can confirm the feature is armed without leaving the
    // Capsules tab.
    const arkBgRefreshEnabled = useAuthStore((s) => s.arkBgRefreshEnabled);

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
        const mapped = arkVtxos.map((v) => {
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
        // Sort: expired-dust capsules to the bottom of the list. They're
        // functionally logs — past expiry, below the dust limit, no
        // refresh path, no economic exit path. Above-the-fold prominence
        // is wasted on them; users should see live capsules first and
        // scroll past the carcasses. Everything else preserves the
        // SDK's natural order.
        return mapped.sort((a, b) => {
            const aDead = a.sats <= ARK_VTXO_DUST_SATS && a.daysLeft <= 0;
            const bDead = b.sats <= ARK_VTXO_DUST_SATS && b.daysLeft <= 0;
            if (aDead !== bDead) return aDead ? 1 : -1;
            return 0;
        });
    }, [arkVtxos, chainTipHeight, arkLastBackupAt]);

    const toggle = (id: string) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
        );
    };

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

        // Pre-flight dust check: the ASP rejects refresh rounds for
        // inputs below `ARK_REFRESH_MIN_SATS` (empirically ~500). Catch
        // this client-side instead of letting the user wait through a
        // round attempt that's predestined to fail with an opaque
        // BarkError.Internal. The reactive error path below still
        // exists as a safety net for above-threshold rounds that fail
        // for other reasons.
        const totalIn = rows
            .filter((r) => ids.includes(r.id))
            .reduce((acc, r) => acc + r.sats, 0);
        if (totalIn > 0 && totalIn < ARK_REFRESH_MIN_SATS) {
            SimpleToast.show(
                `${totalIn}-sat capsule${ids.length === 1 ? '' : 's'} too small to refresh ` +
                `(server minimum ~${ARK_REFRESH_MIN_SATS}). ` +
                `Combine into a larger capsule first via a self-send.`,
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
            const refreshPromise: Promise<RefreshResult> = refreshArkVtxosAndSync(ids, totalIn);
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
     * Dust-aware consolidation set.
     *
     * Surfaces a one-tap path out of the dust trap: gather every dust
     * capsule (≤ ARK_VTXO_DUST_SATS) and, if their sum alone is below
     * the refresh minimum, top up with the smallest non-dust capsule(s)
     * needed to clear it. The result is a refresh that absorbs every
     * dust capsule into a single consolidated output above the dust
     * line — turning stranded "100 + 100 + 50" into one usable
     * "≈250 sats" capsule (when topped up enough to clear the round
     * threshold).
     *
     * Viability:
     *   - dust exists, dust ≥ refresh minimum    → consolidate dust only
     *   - dust exists, dust < refresh minimum,
     *     non-dust capsules can fill the gap    → consolidate dust + fillers
     *   - dust exists, no way to reach minimum  → not viable, banner explains
     *   - no dust                                → no banner
     *
     * `pendingRound` capsules are excluded from both sets — refreshing
     * a Locked VTXO is a no-op at best, double-submission at worst.
     */
    const dustConsolidate = React.useMemo(() => {
        // Only LIVE dust counts toward consolidation. Expired dust
        // (daysLeft ≤ 0) can't participate in a refresh round — the
        // ASP rejects it for being past its lifetime — so trying to
        // include it would just nuke the whole consolidation attempt.
        // Also exclude pendingRound capsules (already in flight, double-
        // submission would confuse the SDK).
        const dust = rows.filter(
            (r) => r.sats <= ARK_VTXO_DUST_SATS && !r.pendingRound && r.daysLeft > 0,
        );
        if (dust.length === 0) {
            return { dust, ids: [] as string[], total: 0, viable: false, shortfall: 0 };
        }
        const dustTotal = dust.reduce((a, r) => a + r.sats, 0);
        if (dustTotal >= ARK_REFRESH_MIN_SATS) {
            return {
                dust,
                ids: dust.map((r) => r.id),
                total: dustTotal,
                viable: true,
                shortfall: 0,
            };
        }
        const nonDust = rows
            .filter((r) => r.sats > ARK_VTXO_DUST_SATS && !r.pendingRound)
            .sort((a, b) => a.sats - b.sats);
        const fillers: typeof rows = [];
        let total = dustTotal;
        for (const v of nonDust) {
            fillers.push(v);
            total += v.sats;
            if (total >= ARK_REFRESH_MIN_SATS) break;
        }
        const viable = total >= ARK_REFRESH_MIN_SATS;
        return {
            dust,
            ids: viable ? [...dust.map((r) => r.id), ...fillers.map((r) => r.id)] : [],
            total,
            viable,
            shortfall: viable ? 0 : ARK_REFRESH_MIN_SATS - total,
        };
    }, [rows]);

    const handleConsolidateDust = () => {
        if (!dustConsolidate.viable || dustConsolidate.ids.length < 2) return;
        // Surface the selection so the user sees which capsules will
        // get rolled in (the row halos will light up). The refreshIds
        // call clears `selectedIds` on completion regardless.
        setSelectedIds(dustConsolidate.ids);
        void refreshIds(dustConsolidate.ids);
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
            {/* Header block: prominent Auto-refresh on/off status on the
                first row (left-aligned), then the explainer tagline +
                "Learn more" link + "?" entry point on the second row.
                The on/off line is read-only — the actual toggle lives on
                the Ark Settings tab. */}
            <View style={{ marginHorizontal: 20, marginTop: 14, marginBottom: 8, alignItems: 'flex-start' }}>
                <Text bold style={{ fontSize: 16, color: '#FFF', marginBottom: 6 }}>
                    Auto-refresh:{' '}
                    <Text
                        bold
                        style={{ color: arkBgRefreshEnabled ? colors.green : colors.redLight, fontSize: 16 }}
                    >
                        {arkBgRefreshEnabled ? 'on' : 'off'}
                    </Text>
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
                    <Text style={{ fontSize: 13, color: '#888', flex: 1 }}>
                        Keep your virtual capsules (VTXOs) refreshed.{' '}
                        <Text
                            bold
                            style={{ color: colors.ark?.light ?? colors.pink.default, textDecorationLine: 'underline' }}
                            onPress={() => dispatchNavigate('ArkCapsulesInfoScreen', {})}
                        >
                            Learn more
                        </Text>
                    </Text>
                    <TouchableOpacity
                        onPress={() => dispatchNavigate('ArkCapsulesInfoScreen', {})}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        style={{
                            marginLeft: 8,
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            borderWidth: 1,
                            borderColor: colors.ark?.light ?? colors.pink.default,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Text bold style={{ color: colors.ark?.light ?? colors.pink.default, fontSize: 13, lineHeight: 17 }}>
                            ?
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Dust-consolidate banner. Surfaces only when there's at
                least one dust capsule on the wallet. Two states:
                  - viable (we can build a refresh set above the
                    threshold): tappable button merges them in one
                    refresh round
                  - non-viable (not enough non-dust capsules to top up):
                    informational, explains how much more they need
                    to receive before consolidation works. The banner
                    is the only place users learn that dust is a
                    one-way trap unless they top up. */}
            {dustConsolidate.dust.length > 0 && (
                <View
                    style={{
                        marginHorizontal: 20,
                        marginTop: 6,
                        marginBottom: 6,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: '#FF7A68',
                        backgroundColor: '#1a0f0d',
                    }}
                >
                    <RNText style={{ fontSize: 13, color: '#FF7A68', fontWeight: '700', marginBottom: 4 }}>
                        {dustConsolidate.dust.length} dust capsule{dustConsolidate.dust.length === 1 ? '' : 's'} stranded
                    </RNText>
                    {dustConsolidate.viable ? (
                        <>
                            <RNText style={{ fontSize: 12, color: '#ddd', marginBottom: 8 }}>
                                Combine {dustConsolidate.ids.length} capsule{dustConsolidate.ids.length === 1 ? '' : 's'}
                                {' '}({dustConsolidate.total.toLocaleString()} sats) into one refresh round to absorb the dust.
                            </RNText>
                            <TouchableOpacity
                                onPress={handleConsolidateDust}
                                disabled={refreshing}
                                activeOpacity={0.7}
                                style={{
                                    paddingVertical: 8,
                                    paddingHorizontal: 12,
                                    borderRadius: 6,
                                    backgroundColor: refreshing ? '#444' : '#FF7A68',
                                    alignItems: 'center',
                                }}
                            >
                                <RNText style={{ fontSize: 12, color: '#1a0f0d', fontWeight: '700' }}>
                                    {refreshing ? 'Refreshing…' : 'Combine dust into one capsule'}
                                </RNText>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <RNText style={{ fontSize: 12, color: '#ddd' }}>
                            Total available is {dustConsolidate.total.toLocaleString()} sats — {dustConsolidate.shortfall.toLocaleString()} sats short of the {ARK_REFRESH_MIN_SATS}-sat refresh minimum. Receive at least that much more before the dust expires, or it will be lost to the ASP.
                        </RNText>
                    )}
                </View>
            )}

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
                style={{ marginTop: 10 }}
            />

            {/* Action row — Send (consume selected capsules as a payment)
                and Refresh (re-board to extend expiry). The previous
                "Size of selected capsules: X BTC / $Y" summary above the
                buttons was removed per UX feedback — the BTC/USD
                rollup wasn't decisional (Send routes to ArkSendScreen
                which has its own amount field; Refresh acts on the
                selected set regardless of total), and dropping it
                de-clutters the screen. No Emergency Exit here — that's
                the global Withdraw button's job, see the file docblock. */}
            <View style={vaultStyles.bottomViewNew}>
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
                {/* Only show the "tapping again won't speed it up" banner
                    once the user has actually tapped Refresh more than
                    once. The first tap is normal usage — surfacing the
                    scolding text immediately reads as the app yelling
                    at the user for a perfectly reasonable action. From
                    the second concurrent tap onward, the warning is
                    earned: they're stacking rounds and burning extra
                    fees, and the banner explains why that's bad. */}
                {queuedRoundsCount > 1 && (
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
                            {queuedRoundsCount} refresh rounds queued at Ark server
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
                {/* RNText (built-in) here, not the @Cypher Text wrapper:
                    the wrapper hardcodes adjustsFontSizeToFit, which
                    under Fabric shrinks this two-line pointer down to
                    near-illegible when the surrounding container is
                    tight. Built-in Text honors the declared 11pt. */}
                <RNText
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
                </RNText>
                {/* Background-refresh opt-in card + DEV buttons moved to
                    FlatList ListFooterComponent so they scroll with the
                    capsule list — keeps the list area uncompressed when
                    VTXO count is high. */}
            </View>
        </View>
    );
}
