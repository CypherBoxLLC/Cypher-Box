import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    cancelArkPendingRound,
    estimateArkRefreshFee,
    fetchArkBalance,
    fetchArkPendingRoundStates,
    fetchArkVtxos,
    getArkCancelling,
    getArkWalletHandle,
    ArkRefreshInFlightError,
    refreshArkVtxosDelegatedAndSync,
    restoreArkWalletFromDisk,
    setArkCancelling,
    syncArkWallet,
    useArkCancelling,
} from "@Cypher/services/ark";
// Imported from the file path directly rather than the @Cypher/services/ark
// barrel to keep this change self-contained — the barrel has in-flight edits
// in a separate branch state and re-exporting through it would conflict.
import { cancelArkLightningReceive } from "@Cypher/services/ark/lightning";
import {
    fetchArkNextRequiredRefreshHeight,
    formatBlocksUntil,
} from "@Cypher/services/ark/expiry";
import { buildRefreshBatch } from "@Cypher/services/ark/refreshBatch";
import { buildDeferredVtxoIds } from "@Cypher/services/ark/refreshDeferral";
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

/**
 * Expired = past its expiry height and not mid-round. The funds can no
 * longer be refreshed, sent, or swept (the ASP can claim them at any
 * time), so expired rows render greyed and non-actionable. Locked rows
 * are excluded even when their daysLeft reads 0: a Locked VTXO's
 * expiryHeight is the PRE-refresh leaf's expiry, which legitimately lags
 * the chain tip while a recovery round is in flight — those keep the
 * transient "Refreshing" treatment instead.
 */
function isExpiredCapsule(r: {
    daysLeft: number;
    pendingRound: boolean;
    recoverability: 'backed-up' | 'needs-backup' | 'in-flight';
}): boolean {
    return r.daysLeft <= 0 && !r.pendingRound && r.recoverability !== 'in-flight';
}

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

/**
 * Day + hour precision for the per-row "time left" label, e.g. "1d 16h left"
 * or "16h left". A flat "1d" is misleading near expiry (1d and 1d-23h read the
 * same); showing the hours makes the countdown honest.
 */
function formatExpiryLeft(daysLeft: number): string {
    const totalHours = Math.max(0, Math.round(daysLeft * 24));
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
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
     * True when this VTXO is actively being unilaterally exited (bark exit
     * record in Processing/claimable state — see ArkVtxoView.exiting). bark
     * still reports it Spendable until the exit leaf confirms, but spending
     * or refreshing it would race the user's own exit, so the row renders
     * locked: no selection, no refresh, "Exiting on-chain" label.
     */
    exiting: boolean;
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
    /**
     * Fires when the user taps the per-row icon WHILE the capsule is
     * mid-refresh (isTransient). In that state the spinning refresh-cw
     * icon flips to a cancel-X; tapping cancels every ongoing round so
     * the funds become spendable again immediately.
     */
    onCancelIcon: () => void;
    /**
     * True while the user-initiated cancel is in flight (between tap and
     * post-cancel sync). Drives a "Cancelling" UI state — the per-row
     * label flips from "Refreshing…" to "Cancelling…" and the tappable
     * cancel-X is replaced with a non-tappable "Cancelling" text so the
     * user can't fire the cancel handler again while we wait for bark to
     * respond. Per-row state isn't needed (handleRowCancel cancels ALL
     * ongoing rounds at once), so this flips uniformly across all
     * transient rows.
     */
    isCancelling: boolean;
    /** Round cadence in seconds (from wallet.arkInfo()), null until fetched. */
    roundIntervalSecs: number | null;
    /**
     * Consecutive refresh failures (arkRefreshFailStreak). When > 0 and the
     * capsule is mid-refresh, the row shows "⚠️ N refresh attempt(s) failed"
     * instead of the "takes less than 3 hours" reassurance.
     */
    failedAttempts?: number;
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
 * Detailed remaining-time label for the refresh / in-flight state. While a
 * round runs the user is racing the capsule's (pre-refresh) expiry, so hours
 * matter, not just whole days. Examples: "2d 2h left", "5h left", "45m left",
 * "expiring" (≈0 or past). Returns null for arkoor / unknown expiry.
 */
function formatTimeLeftDetailed(daysLeft: number): string {
    if (!Number.isFinite(daysLeft) || daysLeft <= 0) return 'expiring';
    const totalHours = daysLeft * 24;
    if (totalHours >= 24) {
        const days = Math.floor(daysLeft);
        const hours = Math.round((daysLeft - days) * 24);
        // Carry: "1d 24h" reads wrong, roll it into the next day.
        if (hours >= 24) return `${days + 1}d left`;
        return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`;
    }
    if (totalHours >= 1) return `${Math.round(totalHours)}h left`;
    return `${Math.max(1, Math.round(totalHours * 60))}m left`;
}

/**
 * VtxoRow — one VTXO. Same Transaction background + 4-column layout as the
 * Hot Vault ListView. The only swap from Hot Vault is the visual in the
 * "coin" column (depletion ring instead of UTXO capsule mask), and the
 * selection halo color is yellow (Ark) instead of green (Vault).
 */
function VtxoRow({ vtxo, selected, onPress, onRefreshIcon, onCancelIcon, isCancelling, roundIntervalSecs, failedAttempts }: VtxoRowProps) {
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

    // Pending-round / in-flight VTXOs: flat yellow label. The ring keeps
    // showing the capsule's REAL expiry (see ringDaysLeft below) so the
    // user can see the deadline they're racing while the round runs. Both
    // states share the same two-line label since the user-visible
    // behaviour is identical (capsule is locked, unspendable until the
    // operation commits).
    const isTransientForLabel = vtxo.pendingRound || vtxo.recoverability === 'in-flight';
    // Expired rows render greyed and non-actionable: grey "Expired"
    // label, grey amount, no recoverability suffix (a backup can't
    // resurrect an expired VTXO), badge instead of refresh/select, and
    // tap opens an explainer instead of toggling selection.
    const isExpired = isExpiredCapsule(vtxo);
    // Actively-exiting row: locked treatment (no select / no refresh) with
    // its own label. Takes precedence over the expiry countdown; transient
    // (mid-round) can't co-occur with it (an exiting VTXO reads Spendable).
    const isExiting = vtxo.exiting;
    // isExiting OUTRANKS the transient (locked/in-flight) treatment: after
    // the exit's leaf tx confirms, bark reports the VTXO in a locked-ish
    // state, and the generic "Refreshing or In-flight" label would shadow
    // the exit story (observed live during the AwaitingDelta phase).
    const labelColor = isExiting
        ? colors.ark.light
        : isTransientForLabel
            ? colors.ark.light
            : isExpired
                ? '#888'
                : view.color;
    const labelText = isExiting
        ? 'Exiting on-chain\n(sweeps after the ~24h timelock)'
        : isTransientForLabel
            ? (isCancelling
                ? 'Cancelling\n(takes less than 3 hours)'
                : (failedAttempts && failedAttempts > 0
                    ? `Refreshing or In-flight\n⚠️ ${failedAttempts} refresh attempt${failedAttempts === 1 ? '' : 's'} failed`
                    : 'Refreshing or In-flight\n(takes less than 3 hours)'))
            : isExpired
                ? 'Expired'
                : vtxo.unknownExpiry
                    ? vtxo.kind
                    : formatExpiryLeft(vtxo.daysLeft);
    // Reflect real expiry even mid-round (arkoor daysLeft=Infinity still
    // reads full/green, no deadline). Matches the red countdown text.
    const ringDaysLeft = vtxo.daysLeft;

    // Explainer for expired capsules, the only "action" the row keeps.
    //
    // Deliberately does NOT claim the funds are unrecoverable. Second.tech
    // allows refreshes after the expiry height, during a grace window before
    // the ASP sweeps, so "lost forever" stated a certainty we cannot back and
    // told users to give up at the point they might still have acted. What we
    // can honestly say is that the server may sweep at any time and recovery
    // is not guaranteed.
    //
    // The same correction was applied to every other surface that carried the
    // "lost forever" / "cannot be recovered" framing: the header tagline
    // below, the useArkSync expiry alert, the Settings and
    // CheckingAccountCreated reminder copy, and ArkCapsulesInfoScreen. Keep
    // them in step if this wording changes again.
    const showExpiredExplainer = () => {
        Alert.alert(
            'Capsule expired',
            `This ${vtxo.sats.toLocaleString()}-sat capsule passed its expiry without a successful refresh.\n\n` +
            'After expiry the Second.tech server can sweep these funds at any time, so they may already be gone. ' +
            'Recovery is not guaranteed.\n\n' +
            "Refresh your other capsules before they expire so this doesn't happen to them.",
            [{ text: 'OK' }],
        );
    };

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
            recoverabilityText = "In-flight";
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
            {/* Outer row tap toggles selection. For ANY expired capsule
                (dust or not) the action area renders EXPIRED instead of
                a refresh icon / checkbox, so there's nothing useful to
                toggle — the tap opens the expiry explainer instead. */}
            <TouchableOpacity
                activeOpacity={0.7}
                style={rowStyles.container}
                onPress={isExpired ? showExpiredExplainer : onPress}
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
                        <Text bold style={isExpired ? [rowStyles.value, { color: '#888' }] : rowStyles.value}>{BTCAmount}</Text>
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
                        {vtxo.sats <= ARK_VTXO_DUST_SATS && !isExpired && (
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
                    {vtxo.recoverability === 'in-flight' || isExpired ? (
                        // The two-line italic label above already says
                        // "Refreshing or In-flight\n(takes less than an hour)"
                        // so we drop the separate recoverabilityText
                        // suffix on this branch — it'd just say
                        // "In-flight" again. Expired rows drop the suffix
                        // too: "Backed up" next to a dead capsule reads
                        // as "recoverable", which it is not.
                        //
                        // While a refresh round is in flight the capsule is
                        // still racing its (pre-refresh) expiry, so keep the
                        // countdown visible in the expiry-band colour (red
                        // when <7d) under the "Refreshing…" label. Hidden for
                        // arkoor / unknown-expiry rows (no meaningful deadline).
                        <View>
                            <Text bold numberOfLines={2} style={{ color: labelColor, fontSize: 12, fontStyle: "italic" }}>
                                {labelText}
                            </Text>
                            {isTransientForLabel && !isExpired && !vtxo.unknownExpiry && Number.isFinite(vtxo.daysLeft) && (
                                <Text bold numberOfLines={1} style={{ color: view.color, fontSize: 12 }}>
                                    {formatTimeLeftDetailed(vtxo.daysLeft)}
                                </Text>
                            )}
                        </View>
                    ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' }}>
                            <Text bold numberOfLines={2} style={{ color: labelColor, fontSize: 12, fontStyle: "italic" }}>
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
                {isExpired ? (
                    // Expired action area: no refresh icon, no checkbox —
                    // neither operation is reachable on a VTXO that's past
                    // its expiry height (ASP can sweep it at any time, and
                    // bark's refresh on an expired input hangs the round).
                    // The badge expands to the combined width of the icon
                    // + select columns (flex 2). Dust-vs-non-dust changes
                    // only the label text — visual treatment is identical.
                    // Outer row tap opens the expiry explainer for both.
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
                            {vtxo.sats <= ARK_VTXO_DUST_SATS ? 'EXPIRED DUST' : 'EXPIRED'}
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
                            onPress={isExiting ? undefined : isTransient ? onCancelIcon : onRefreshIcon}
                            delayPressIn={0}
                            hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                            activeOpacity={0.6}
                            // Disable the touchable while a cancel is in
                            // flight — both to prevent double-firing the
                            // cancel handler and to give the "Cancelling"
                            // text a visually-locked feel. Exiting rows have
                            // no action at all (the exit can't be cancelled).
                            disabled={(isTransient && isCancelling) || isExiting}
                        >
                            {/* Three visual states for the row's action slot:
                                  - idle (not transient): spinning refresh-cw,
                                    tap queues a single-capsule refresh round.
                                  - transient + NOT cancelling: red Feather "x",
                                    tap cancels every ongoing round so the
                                    user's funds unlock immediately.
                                  - transient + cancelling: "Cancelling" text
                                    standing in for the X, non-tappable, so
                                    the user can't spam-tap the cancel button
                                    while waiting for bark to settle. */}
                            {isExiting ? (
                                // No action while exiting — empty slot keeps
                                // the column widths stable. Checked BEFORE
                                // isTransient so an exiting VTXO in bark's
                                // locked-ish post-confirm state never shows
                                // the cancel X (exits can't be cancelled).
                                null
                            ) : isTransient ? (
                                isCancelling ? (
                                    <Text bold style={{ color: colors.redLight, fontSize: 12 }}>
                                        Cancelling
                                    </Text>
                                ) : (
                                    <Icon name="x" type="feather" color={colors.redLight} size={24} />
                                )
                            ) : (
                                <Animated.View style={{ transform: [{ rotate: spinDeg }, { scale: iconScale }] }}>
                                    <Icon name="refresh-cw" type="feather" color="#FFFFFF" size={22} />
                                </Animated.View>
                            )}
                        </TouchableOpacity>
                        <View style={rowStyles.select}>
                            {/* While a cancel is in flight the selection
                                checkbox vanishes — the user shouldn't be
                                queueing new refresh actions over a cancel
                                they're still waiting on. The outer slot
                                stays so row column widths don't shift. */}
                            {!isCancelling && !isExiting && (
                                <View style={rowStyles.checkbox}>
                                    {selected && <Image source={Yes} />}
                                </View>
                            )}
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
    /**
     * Tap handler. When provided, the row becomes tappable and surfaces a
     * "tap to cancel" affordance in the subtitle. When omitted, the row is
     * non-interactive (back-compat with any caller that doesn't want the
     * cancel surface). The handler should manage its own confirm UI — this
     * component just fires the tap.
     */
    onPress?: () => void;
}

function PendingLnReceiveRow({ sats, onPress }: PendingLnReceiveRowProps) {
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
            {/* Tappable content area. When onPress is set, the row reads as
                tappable and surfaces the cancel action. When omitted, the
                touchable degrades to a passive container (activeOpacity=1,
                disabled). The LinearGradient backdrop above is intentionally
                outside this touchable so the visual edges aren't part of the
                tap target — the row reads as "tap the card body to cancel",
                not "tap anywhere on the row". */}
            <TouchableOpacity
                style={rowStyles.container}
                activeOpacity={onPress ? 0.7 : 1}
                onPress={onPress}
                disabled={!onPress}
            >
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
                        {onPress ? "Lightning ~1–3 min · tap to cancel" : "Lightning ~1–3 min"}
                    </Text>
                </View>
                {/* Bolt icon in the refresh column — visually distinguishes
                    a pending Lightning receive from a real capsule. */}
                <View style={[rowStyles.label, { alignItems: 'flex-start' }]}>
                    <Icon name="zap" type="feather" color={colors.ark.light} size={22} />
                </View>
                {/* Empty select slot — no checkbox, can't be selected for
                    Send/Refresh actions. We still reserve the column so the
                    row width matches the real capsule rows below. */}
                <View style={rowStyles.select} />
            </TouchableOpacity>
        </Animated.View>
    );
}

interface ArkCapsulesProps {
    matchedRate: string;
    currency: any;
}

/**
 * Threshold (days-until-expiry) for the auto-refresh-on-notification-tap
 * path. Any VTXO at or below this many days gets included in the round
 * that fires when the user lands here from a tapped warning. Mirrors
 * BG_REFRESH_TUNABLES.batchDays in src/services/ark/backgroundRefresh.ts;
 * kept inline to avoid pulling the full bg-refresh module into the render
 * hot path. Update both if either changes.
 */
const TAP_REFRESH_IMMINENT_DAYS = 14;

// Countdown window for the refresh-wait reminder. Each in-flight round gets a
// 3h timer counting down from when it started (its first-seen timestamp).
const REFRESH_WAIT_WINDOW_MS = 3 * 60 * 60 * 1000;
// A stuck refresh becomes worth bailing on (swap the capsule to another
// wallet, retry later) well before the 12h `nearExpiry` gate, a failing
// round shouldn't be allowed to burn down a multi-day runway. The Capsules
// banner offers the swap-out path once a stuck capsule is within this many
// days of expiry.
const STUCK_SWAP_BANNER_DAYS = 3;
// Cap the stacked per-round countdown lines so spam-tapping (which queues
// duplicate rounds) can't grow the banner unbounded; the rest collapse to
// a "+N more" line.
const MAX_EXTRA_REFRESH_LINES = 3;

// Format a remaining-ms value as H:MM:SS (e.g. 2:59:59). Clamped at 0.
function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Green pulsing reminder shown while a refresh round is in flight. A round can
 * take up to a few hours to finalise (or time out) server-side, and the user
 * must be back in the app for the completion sync to land, so we nudge them to
 * return, with a live countdown per in-flight round.
 *
 * `roundStarts` is the set of round first-seen timestamps (ms) from
 * `arkPendingRoundFirstSeen`, one per in-flight round. Each gets a 3h
 * countdown; the soonest-to-elapse (oldest round) is shown inline in the
 * headline and the rest stack below as "Refresh 2 / 3 / ...". A line drops
 * when its round completes (pruned from the map upstream). If a round is still
 * present after its 3h window is up it hasn't completed, so the banner switches
 * to a "stuck" state with a Cancel action; cancelling clears the round, which
 * unmounts the banner via the caller's in-flight gate. Self-contained pulse +
 * 1s tick so only this component re-renders each second, not the capsule list.
 */
function RefreshWaitBanner({
    roundStarts,
    cancelling,
    onCancel,
}: {
    roundStarts: number[];
    cancelling: boolean;
    onCancel: () => void;
}) {
    const pulse = useRef(new Animated.Value(0.6)).current;
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0.6,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        loop.start();
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => {
            loop.stop();
            clearInterval(tick);
        };
    }, [pulse]);

    // A round still tracked after its 3h window has elapsed hasn't completed:
    // treat it as stuck. Otherwise render the per-round countdowns, soonest-to-
    // elapse first (the oldest round is the headline timer; the rest stack).
    const isStuck = roundStarts.some((start) => now - start >= REFRESH_WAIT_WINDOW_MS);
    const counting = roundStarts
        .map((start) => ({ start, remaining: start + REFRESH_WAIT_WINDOW_MS - now }))
        .filter((x) => x.remaining > 0)
        .sort((a, b) => a.remaining - b.remaining);
    const primary = counting[0];
    const extras = counting.slice(1);

    // Always amber: this is a "come back and check" warning whether the round
    // is still counting down or already stuck.
    const accent = '#FFD54F';
    const tint = 'rgba(255, 213, 79, 0.10)';

    return (
        <Animated.View
            style={{
                // Steady (no pulse) once stuck so the amber warning reads as a
                // fixed alert and the Cancel button stays easy to tap.
                opacity: isStuck ? 1 : pulse,
                marginHorizontal: 24,
                marginBottom: 12,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: tint,
                borderWidth: 1,
                borderColor: accent,
            }}
        >
            {isStuck ? (
                <>
                    <Text bold center style={{ fontSize: 12, color: accent, letterSpacing: 0.5, lineHeight: 17 }}>
                        This refresh is stuck. You can cancel the refresh and try again later.
                    </Text>
                    <TouchableOpacity
                        onPress={cancelling ? undefined : onCancel}
                        style={{ marginTop: 10, paddingVertical: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: accent }}
                    >
                        <Text bold style={{ fontSize: 12, color: accent }}>
                            {cancelling ? 'Cancelling…' : 'Cancel refresh'}
                        </Text>
                    </TouchableOpacity>
                </>
            ) : (
                <>
                    <Text bold center style={{ fontSize: 12, color: accent, letterSpacing: 0.5, lineHeight: 17 }}>
                        {`PLEASE COME BACK IN 3 HOURS TO MAKE SURE THE REFRESH HAS COMPLETED${primary ? ` (${formatCountdown(primary.remaining)})` : ''}`}
                    </Text>
                    {extras.slice(0, MAX_EXTRA_REFRESH_LINES).map((x, i) => (
                        <Text
                            key={x.start}
                            center
                            style={{ fontSize: 11, color: accent, marginTop: 4 }}
                        >
                            {`- Refresh ${i + 2}: ${formatCountdown(x.remaining)}`}
                        </Text>
                    ))}
                    {extras.length > MAX_EXTRA_REFRESH_LINES && (
                        <Text center style={{ fontSize: 11, color: accent, marginTop: 4 }}>
                            {`+${extras.length - MAX_EXTRA_REFRESH_LINES} more`}
                        </Text>
                    )}
                </>
            )}
        </Animated.View>
    );
}

export default function ArkCapsules({ matchedRate, currency }: ArkCapsulesProps) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    // True between cancel-tap and the round actually clearing (NOT just
    // until our cancel call returns). bark's cancel can return failure
    // due to a transient internal-lock timeout while the round itself
    // still settles ~1 min later via natural failure. Hoisted to a
    // module-level singleton (see services/ark/cancellingState.ts) so
    // the gate survives the V-capsules tab unmounting — otherwise
    // navigating to Home and back mid-cancel resets the flag and the
    // X button reappears, inviting users to spam-tap it.
    const cancelling = useArkCancelling();
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const arkRefreshingVtxoIds = useAuthStore((s) => s.arkRefreshingVtxoIds);
    const arkPendingLnReceives = useAuthStore((s) => s.arkPendingLnReceives);
    const setArkPendingLnReceives = useAuthStore((s) => s.setArkPendingLnReceives);
    const chainTipHeight = useAuthStore((s) => s.arkChainTipHeight);
    const arkLastBackupAt = useAuthStore((s) => s.arkLastBackupAt);
    const arkRoundIntervalSecs = useAuthStore((s) => s.arkRoundIntervalSecs);
    // Read-only on this screen — the toggle lives on the Ark Settings
    // tab. Surfaced as a small on/off status above the explainer tagline
    // so users can confirm the feature is armed without leaving the
    // Capsules tab.
    const arkBgRefreshEnabled = useAuthStore((s) => s.arkBgRefreshEnabled);
    // Subscribed purely as a re-render trigger for the "next refresh due"
    // status line below — the useArkSync loop bumps this at the end of every
    // successful tick, so we re-fetch the SDK's `getNextRequiredRefreshBlockheight`
    // alongside the rest of the wallet's read state without spinning up a
    // separate poll.
    const arkLastSyncedAt = useAuthStore((s) => s.arkLastSyncedAt);
    // One-shot flag set by the notification tap handler in
    // src/services/ark/scheduler.ts. Drives the auto-refresh effect below
    // so the user lands on this tab with refresh already running, without
    // having to find a button.
    const arkPendingTapRefresh = useAuthStore((s) => s.arkPendingTapRefresh);
    const setArkPendingTapRefresh = useAuthStore((s) => s.setArkPendingTapRefresh);
    const arkRefreshStuck = useAuthStore((s) => s.arkRefreshStuck);
    const setArkRefreshStuck = useAuthStore((s) => s.setArkRefreshStuck);
    // Per-round first-seen timestamps (round id -> ms), maintained by
    // useArkSync's stuck detection. Drives the per-round 3h countdowns in the
    // refresh-wait banner. Auto-prunes when a round completes.
    const arkPendingRoundFirstSeen = useAuthStore((s) => s.arkPendingRoundFirstSeen);
    // Subscribed (not getState) so the dust-consolidate banner re-derives when
    // a "Use immediately" grace is set/lapses and stops auto-sweeping that vtxo.
    const arkArkoorPromptState = useAuthStore((s) => s.arkArkoorPromptState);
    // Consecutive refresh failures, drives the per-row "N refresh attempts
    // failed" copy while a capsule is stuck mid-refresh.
    const arkRefreshFailStreak = useAuthStore((s) => s.arkRefreshFailStreak);

    // Recover a stuck refresh from the Capsules tab. Mirrors the home-card
    // handler in ArkWallet — but that banner is invisible to a user sitting
    // on THIS tab watching a capsule pulse "Refreshing…", which is exactly
    // when they need it. Cancels each wedged round to unlock its input VTXOs,
    // then clears the banner; the next sync re-detects if any round is still
    // stuck. Per-round failures are swallowed (cancelArkPendingRound already
    // logs the inner BarkError) so one bad round can't block the rest.
    const handleStuckRecovery = useCallback(async () => {
        const stuck = useAuthStore.getState().arkRefreshStuck;
        if (!stuck) return;
        for (const roundId of stuck.stuckRoundIds) {
            try {
                await cancelArkPendingRound(roundId);
            } catch {
                // logged inside cancelArkPendingRound
            }
        }
        setArkRefreshStuck(null);
        SimpleToast.show('Recovering stuck refresh…', SimpleToast.SHORT);
    }, [setArkRefreshStuck]);

    // Block-height the wallet's policy says we need to refresh by, or null
    // when nothing's in scope (no spendable VTXOs / all already refreshed
    // within margin). Held as blocks rather than days so the formatter can
    // pick the right unit (hours vs days) at render time. NOT in zustand —
    // local-only because no other surface needs it yet; if WalletsView /
    // ArkWallet want the same signal later, this lifts cleanly.
    const [nextRefreshBlocks, setNextRefreshBlocks] = useState<number | null>(null);
    useEffect(() => {
        // chainTipHeight may briefly be null on first mount before the
        // esplora fetch lands — skip until both signals are ready, the next
        // sync tick re-runs the effect when they are.
        if (chainTipHeight === null) return;
        let cancelled = false;
        (async () => {
            const targetHeight = await fetchArkNextRequiredRefreshHeight();
            if (cancelled) return;
            if (targetHeight === null) {
                setNextRefreshBlocks(null);
                return;
            }
            const blocks = targetHeight - chainTipHeight;
            setNextRefreshBlocks(blocks);
            if (__DEV__) {
                // Block number kept in console for triage — never surfaced
                // in user-facing copy. Paired with the time formatting so
                // logs read as "raw + interpreted" at a glance.
                console.log(
                    `[Ark expiry] next required refresh at block ${targetHeight} (${formatBlocksUntil(blocks)})`,
                );
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [arkLastSyncedAt, chainTipHeight]);

    // Sum of sats currently in a pending refresh round we submitted. Driven by
    // the client-tracked ids (authStore arkRefreshingVtxoIds) — same approach
    // as ArkWallet/index.tsx. bark 0.6.0 no longer marks a mid-refresh VTXO
    // `Locked` (it stays `Spendable`), so the old "sum Locked VTXOs" derivation
    // silently returned 0; and its `arkBalanceDetail.pendingInRoundSats` lags
    // the submission by seconds-to-minutes, so we don't use that either.
    //
    // Used to disable the Refresh action button while a round is in flight, so
    // users don't queue duplicate rounds at the ASP thinking it speeds things.
    const pendingRoundSats = useMemo(() => {
        if (arkRefreshingVtxoIds.length === 0) return 0;
        const set = new Set(arkRefreshingVtxoIds);
        return arkVtxos.reduce((sum, v) => (set.has(v.id) ? sum + v.sats : sum), 0);
    }, [arkVtxos, arkRefreshingVtxoIds]);

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
        const refreshingSet = new Set(arkRefreshingVtxoIds);
        const mapped = arkVtxos.map((v) => {
            const stateLower = v.state.toLowerCase();
            const kindLower = v.kind.toLowerCase();
            // bark 0.6.0: a mid-refresh VTXO stays `Spendable` (not `Locked`),
            // so drive the "Refreshing…" row treatment off the client-tracked
            // ids too (see authStore arkRefreshingVtxoIds).
            const pendingRound = stateLower === "locked" || refreshingSet.has(v.id);

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
                    exiting: v.exiting ?? false,
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
                exiting: v.exiting ?? false,
                recoverability,
            };
        });
        // Sort: expired capsules (dust or not) to the bottom of the list.
        // They're functionally logs — past expiry, no refresh path, no
        // send path, no exit path. Above-the-fold prominence is wasted
        // on them; users should see live capsules first and scroll past
        // the carcasses. Everything else preserves the SDK's natural
        // order.
        return mapped.sort((a, b) => {
            const aDead = isExpiredCapsule(a);
            const bDead = isExpiredCapsule(b);
            if (aDead !== bDead) return aDead ? 1 : -1;
            return 0;
        });
    }, [arkVtxos, chainTipHeight, arkLastBackupAt, arkRefreshingVtxoIds]);

    // Auto-refresh when the user landed here from a tapped expiry-warning
    // notification. The scheduler's tap handler set arkPendingTapRefresh
    // and dispatched the navigation; this effect picks it up on mount.
    //
    // Wait for `rows` to populate (zustand rehydrates arkVtxos before
    // React mounts, but on a fresh install or an Ark wallet that hasn't
    // synced yet, rows can briefly be empty). The effect re-runs when
    // rows changes, so we'll naturally pick it up once the sync tick
    // lands. Flag is cleared synchronously so a re-render mid-effect
    // can't double-fire the refresh.
    //
    // Three decision branches once the batch is built:
    //   1. Imminent VTXOs are Locked in a round → check whether the
    //      round is stuck. If yes, prompt user to cancel & retry; if no,
    //      inform and queue whatever IS spendable. The user tapped a
    //      warning notification — silently failing because of a stuck
    //      round is the worst possible outcome (memorialised in
    //      ark-arkoor-change-returns-unregistered + the open thread #3
    //      handover note).
    //   2. Imminent capsules total below the round minimum even with
    //      every filler → dust-stranded toast that names the shortfall.
    //   3. Otherwise → fire the batch with skipConfirm so the refresh
    //      starts immediately. Selection + fee preview don't add safety
    //      here: the user already opted in by tapping the warning.
    useEffect(() => {
        if (!arkPendingTapRefresh) return;
        if (rows.length === 0) return;
        setArkPendingTapRefresh(false);

        // Honour user-deferred VTXOs ("Use immediately" from the arkoor
        // receive popup), via the shared gate so the tap and bg paths agree
        // on what's off-limits (3h grace, unanswered popups, 90s race window).
        const promptState =
            useAuthStore.getState().arkArkoorPromptState ?? {};
        const deferredIds = buildDeferredVtxoIds(promptState);

        const batch = buildRefreshBatch({
            // Exiting capsules are out of scope for refresh batches — the
            // exit owns them (and one riding along would trip refreshIds'
            // exiting gate and block the whole batch).
            vtxos: rows.filter((r) => !r.exiting).map((r) => ({
                id: r.id,
                sats: r.sats,
                daysLeft: r.daysLeft,
                pendingRound: r.pendingRound,
                unknownExpiry: r.unknownExpiry,
            })),
            deferredIds,
            batchDays: TAP_REFRESH_IMMINENT_DAYS,
            minRefreshSats: ARK_REFRESH_MIN_SATS,
        });

        // Imminent (≤14d) VTXOs that are currently Locked. They're the
        // ones at acute risk: the helper skipped them from the batch
        // because a Locked input would just bounce the round, but
        // ignoring them entirely would leak the funds to expiry. Need
        // to distinguish "normal in-flight" from "stuck" before deciding
        // what to do.
        const lockedImminent = rows.filter(
            (r) =>
                r.pendingRound
                && !r.unknownExpiry
                && r.daysLeft > 0
                && r.daysLeft <= TAP_REFRESH_IMMINENT_DAYS,
        );

        if (lockedImminent.length > 0) {
            void handleStuckRoundOnTap(batch, lockedImminent);
            return;
        }

        if (batch.ids.length === 0 && batch.strandedDustCount > 0) {
            SimpleToast.show(
                `Your imminent capsule${batch.strandedDustCount === 1 ? '' : 's'} ` +
                `(${batch.strandedDustSats.toLocaleString()} sats) ` +
                `${batch.strandedDustCount === 1 ? 'is' : 'are'} below the ` +
                `${ARK_REFRESH_MIN_SATS}-sat refresh minimum. Spend ` +
                `${batch.strandedDustCount === 1 ? 'it' : 'them'} in a payment before ` +
                `${batch.strandedDustCount === 1 ? 'it expires' : 'they expire'}.`,
                SimpleToast.LONG,
            );
            return;
        }

        if (batch.ids.length === 0) {
            SimpleToast.show('No capsules need refreshing right now.', SimpleToast.SHORT);
            return;
        }

        if (__DEV__) {
            console.log(
                '[Ark tap-refresh] firing batch:',
                'ids=', batch.ids.length,
                'totalSats=', batch.totalSats,
                'triggerCount=', batch.triggerCount,
                'strandedDust=', batch.strandedDustCount,
                'skippedPending=', batch.skippedPendingCount,
                'skippedDeferred=', batch.skippedDeferredCount,
            );
        }

        void refreshIds(batch.ids, { skipConfirm: true });
        // refreshIds + handleStuckRoundOnTap are defined later in
        // component scope and stable for the lifetime of the screen.
        // The eslint rule is disabled per-line rather than at the file
        // level so other effects keep the lint guard.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [arkPendingTapRefresh, rows, setArkPendingTapRefresh]);

    const toggle = (id: string) => {
        // Exiting capsules can't be selected for send/refresh — the exit
        // owns them until it completes (see VtxoRowData.exiting).
        const row = rows.find((r) => r.id === id);
        if (row?.exiting) {
            SimpleToast.show(
                'This capsule is exiting on-chain and can no longer be spent or refreshed.',
                SimpleToast.SHORT,
            );
            return;
        }
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
     * button (passes selectedIds), the per-row icon (passes a single
     * vtxo.id), and the auto-refresh-on-tap effect above
     * (passes the imminent set + `skipConfirm: true`). Same fee
     * preview + watchdog + selection-clear semantics either way; only
     * the confirmation dialog is conditional.
     */
    const refreshIds = async (
        ids: string[],
        opts: { skipConfirm?: boolean } = {},
    ) => {
        if (refreshing) return;
        if (ids.length === 0) return;

        // Hard gate: the SDK throws "Ark wallet not open" if `getArkWalletHandle()`
        // is null. That happens on a cold launch when the user dismissed (or never
        // saw) the boot-time biometric prompt that `useArkRestoreOnBoot` fires.
        // The capsule rows render fine off zustand-persisted state, so the user
        // can reach Refresh before the handle is ready. Re-attempt the restore
        // here so we re-prompt biometric and recover transparently.
        if (!getArkWalletHandle()) {
            const result = await restoreArkWalletFromDisk();
            if (!result.restored && result.reason !== "already-open") {
                const detail =
                    result.reason === "no-keychain"
                        ? "Unlock prompt was declined. Restart the app and confirm the biometric prompt to unlock the Ark wallet."
                        : result.reason === "no-datadir"
                            ? "Ark wallet data is missing on this device. Use Recover from the home screen to restore it."
                            : "Could not open the Ark wallet right now. Try again in a few seconds.";
                SimpleToast.show(detail, SimpleToast.LONG);
                return;
            }
        }

        // Expired capsules can't ride in a round (the ASP rejects expired
        // inputs and the attempt would wedge). The row UI blocks selecting
        // them, but a capsule can flip to expired between selection and
        // tap, so gate here too.
        const expiredSelected = rows.filter(
            (r) => ids.includes(r.id) && isExpiredCapsule(r),
        );
        if (expiredSelected.length > 0) {
            SimpleToast.show(
                `${expiredSelected.length} capsule(s) already expired and can no longer be refreshed`,
                SimpleToast.LONG,
            );
            return;
        }

        // Actively-exiting capsules can't ride a round either — the exit
        // owns them now (see VtxoRowData.exiting).
        const exitingSelected = rows.filter(
            (r) => ids.includes(r.id) && r.exiting,
        );
        if (exitingSelected.length > 0) {
            SimpleToast.show(
                `${exitingSelected.length} capsule(s) are exiting on-chain and can no longer be refreshed`,
                SimpleToast.LONG,
            );
            return;
        }

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

        // Pre-flight PER-INPUT dust check. The ASP rejects the WHOLE round
        // with an opaque BarkError.Internal if ANY single input is below
        // `ARK_REFRESH_MIN_SATS` (empirically ~500), it's a per-input
        // floor, not an aggregate one, so a dust capsule can't ride along
        // on larger ones. Drop sub-floor capsules from the round (the user
        // spends them separately; coin-selection folds them into a normal
        // payment) rather than letting one dust input sink the refresh of
        // the healthy ones. The reactive error path below stays as a
        // safety net for above-floor rounds that fail for other reasons.
        const dustRows = rows.filter(
            (r) => ids.includes(r.id) && r.sats < ARK_REFRESH_MIN_SATS,
        );
        if (dustRows.length > 0) {
            const dustSats = dustRows.reduce((acc, r) => acc + r.sats, 0);
            const refreshable = ids.filter(
                (id) => !dustRows.some((d) => d.id === id),
            );
            if (refreshable.length === 0) {
                SimpleToast.show(
                    `${dustSats}-sat capsule${dustRows.length === 1 ? ' is' : 's are'} too small ` +
                    `to refresh (server minimum ~${ARK_REFRESH_MIN_SATS}). ` +
                    `Spend ${dustRows.length === 1 ? 'it' : 'them'} in a payment ` +
                    `before ${dustRows.length === 1 ? 'it expires' : 'they expire'}.`,
                    SimpleToast.LONG,
                );
                return;
            }
            SimpleToast.show(
                `Skipping ${dustRows.length} tiny capsule${dustRows.length === 1 ? '' : 's'} ` +
                `(${dustSats} sats, below the ~${ARK_REFRESH_MIN_SATS}-sat minimum). ` +
                `Spend ${dustRows.length === 1 ? 'it' : 'them'} in a payment. Refreshing the rest.`,
                SimpleToast.LONG,
            );
            ids = refreshable;
        }
        // Post-filter input total (drives the refreshArkVtxosDelegatedAndSync
        // amount arg + telemetry below).
        const totalIn = rows
            .filter((r) => ids.includes(r.id))
            .reduce((acc, r) => acc + r.sats, 0);

        setRefreshing(true);
        try {
            // G5: the store's vtxo list lags the ASP right after an arkoor
            // send, so `ids` (built from the last poll) can still include a
            // VTXO already spent server-side. Submitting a spent input makes
            // the ASP reject the whole round (and inflates the fail streak).
            // Resync and drop any id that is no longer a live, non-locked
            // capsule before we estimate/submit. Same resync the stuck-round
            // retry uses; a spent VTXO falls out of the store's spendable list,
            // so "still present and not locked" is the liveness test.
            try {
                await syncArkWallet();
                await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
            } catch (syncErr: any) {
                console.warn(
                    '[Ark refresh] pre-submit resync failed, proceeding with last-known set:',
                    syncErr?.message ?? syncErr,
                );
            }
            const liveIds = new Set(
                (useAuthStore.getState().arkVtxos ?? [])
                    .filter((v) => v.state.toLowerCase() !== 'locked')
                    .map((v) => v.id),
            );
            const droppedStale = ids.filter((id) => !liveIds.has(id));
            if (droppedStale.length > 0) {
                ids = ids.filter((id) => liveIds.has(id));
                console.log(
                    '[Ark refresh] dropped', droppedStale.length,
                    'stale/spent vtxo(s) after resync; refreshing', ids.length,
                );
            }
            if (ids.length === 0) {
                SimpleToast.show(
                    'Those capsules just changed state (spent or now in a round), so there is nothing left to refresh.',
                    SimpleToast.LONG,
                );
                setRefreshing(false);
                return;
            }
            const fee = await estimateArkRefreshFee(ids);
            // Present fee preview + confirmation before committing. The
            // delegation costs a round fee, so the user should opt in
            // explicitly rather than have it happen silently. The
            // notification-tap path skips this dialog: the user already
            // signalled intent by tapping the warning and the deep-link
            // would be pointless if we then asked them to tap Refresh
            // again. They still see the "Refreshing…" UI immediately.
            const confirmed = opts.skipConfirm
                ? true
                : await new Promise<boolean>((resolve) => {
                    Alert.alert(
                        "Refresh capsules?",
                        `Re-board ${ids.length} capsule(s) into a new Ark round for ~${fee.feeSats} sats. ` +
                        `This extends their expiry by another full lifetime. It finishes in the background ` +
                        `within the hour, so you can close the app once it's submitted.`,
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

            // Delegated refresh: hand the capsules to the ASP to re-board in
            // the next round. Returns as soon as the server ACCEPTS them
            // (seconds), not when the round finishes. The round then completes
            // server-side with no app presence needed, so the user can close
            // the app. The capsules carry the "Refreshing" row treatment
            // (Locked in round) until a later sync ingests the refreshed VTXO.
            // Bump the queued-rounds counter so the in-flight UI reflects the
            // pending round; it resets in the pendingRoundSats === 0 effect
            // above when the round commits server-side.
            queuedRoundsCountRef.current += 1;
            setQueuedRoundsCount(queuedRoundsCountRef.current);

            await refreshArkVtxosDelegatedAndSync(ids, totalIn);
            setSelectedIds([]);
            SimpleToast.show(
                `Refresh submitted for ${ids.length} capsule${ids.length === 1 ? '' : 's'}. ` +
                `They finish in the background within the hour, so you can close the app.`,
                SimpleToast.LONG,
            );
        } catch (err: any) {
            // Round already in flight: nothing was submitted, this isn't a
            // failure. Tell the user to let the running round finish.
            if (err instanceof ArkRefreshInFlightError) {
                SimpleToast.show(
                    'A refresh is already running. Wait for it to finish, then try again.',
                    SimpleToast.LONG,
                );
                return;
            }
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

    /**
     * Notification-tap path: an imminent VTXO is Locked in a refresh
     * round. Distinguish "normal in-flight" from "stuck" and decide what
     * to do without leaving the user staring at a screen that did nothing.
     *
     *   - No ongoing rounds (state has caught up between the row read and
     *     the SDK probe): kick the regular batch refresh against whatever
     *     IS spendable; if nothing is, a toast explains.
     *   - Ongoing rounds, not stuck: surface the in-flight state with a
     *     toast that names the value at risk + the upper-bound wait;
     *     still kick the regular batch refresh for the spendable
     *     remainder so it makes forward progress.
     *   - Ongoing rounds, STUCK (oldest first-seen > 2× round interval):
     *     prompt with Wait / Cancel & retry. The cancel path runs the
     *     same per-round cancel loop handleRowCancel uses, syncs, then
     *     re-fires refreshIds against the freshly-spendable set
     *     including what was previously Locked.
     */
    const handleStuckRoundOnTap = async (
        batch: ReturnType<typeof buildRefreshBatch>,
        lockedImminent: ReadonlyArray<VtxoRowData>,
    ) => {
        const lockedImminentSats = lockedImminent.reduce((a, r) => a + r.sats, 0);
        const lockedImminentCount = lockedImminent.length;

        let states: Awaited<ReturnType<typeof fetchArkPendingRoundStates>>;
        try {
            states = await fetchArkPendingRoundStates();
        } catch (err: any) {
            console.warn('[Ark tap-refresh] pendingRoundStates threw:', err?.message ?? err);
            states = [];
        }
        const ongoing = states.filter((s) => s.ongoing);

        if (ongoing.length === 0) {
            // Local row state is stale — no ongoing rounds at the SDK.
            // Next sync will flip Locked → Spendable. Try the batch we
            // have; if empty, tell the user to come back in a minute.
            if (batch.ids.length > 0) {
                void refreshIds(batch.ids, { skipConfirm: true });
            } else {
                SimpleToast.show(
                    'Your imminent capsules are still settling from a recent refresh. They should be spendable again within a minute.',
                    SimpleToast.LONG,
                );
            }
            return;
        }

        const intervalSecs = useAuthStore.getState().arkRoundIntervalSecs;
        const firstSeen = useAuthStore.getState().arkPendingRoundFirstSeen ?? {};
        // Mainnet rounds run once per hour; 2× that is the same threshold
        // useArkSync's "tap to recover" banner uses. When the SDK hasn't
        // reported a round-interval yet, fall back to 2h so a brand-new
        // install on a cold-start tap can still detect a stuck round.
        const stuckThresholdMs =
            intervalSecs != null ? 2 * intervalSecs * 1000 : 2 * 60 * 60 * 1000;
        const now = Date.now();
        const oldestAgeMs = ongoing.reduce((max, s) => {
            const seen = firstSeen[String(s.id)] ?? now;
            return Math.max(max, now - seen);
        }, 0);
        const stuck = oldestAgeMs > stuckThresholdMs;

        if (!stuck) {
            SimpleToast.show(
                `${lockedImminentCount} capsule${lockedImminentCount === 1 ? '' : 's'} ` +
                `(${lockedImminentSats.toLocaleString()} sats) ${lockedImminentCount === 1 ? 'is' : 'are'} ` +
                `already in an active refresh round. It should finalise within 3 hours.`,
                SimpleToast.LONG,
            );
            if (batch.ids.length > 0) {
                void refreshIds(batch.ids, { skipConfirm: true });
            }
            return;
        }

        // Stuck. Floor at 1 hour for the human-readable copy so we don't
        // say "in progress for 0 hours" on an edge case where age is
        // barely over the threshold.
        const ageHours = Math.max(1, Math.round(oldestAgeMs / (60 * 60 * 1000)));
        Alert.alert(
            'Refresh stuck',
            `A refresh has been in progress for about ${ageHours} hour${ageHours === 1 ? '' : 's'}. ` +
            `Cancel it and retry now to save your capsules from expiring?`,
            [
                { text: 'Wait', style: 'cancel' },
                {
                    text: 'Cancel & retry',
                    style: 'destructive',
                    onPress: () => {
                        void cancelOngoingRoundsAndRetry(
                            ongoing.map((s) => s.id),
                        );
                    },
                },
            ],
            { cancelable: true },
        );
    };

    /**
     * Cancel every ongoing round, sync, then re-fire a refresh against
     * the now-spendable set. Mirrors the cancel loop in handleRowCancel
     * (retry budget + backoff to dodge bark's internal lock contention)
     * so the two cancel paths behave the same. After sync we re-read
     * the store directly to project a fresh batch from the
     * just-unlocked VTXOs; falling back to closed-over `rows` here
     * would still see Locked state.
     */
    const cancelOngoingRoundsAndRetry = async (roundIds: number[]) => {
        if (getArkCancelling()) return;
        setArkCancelling(true);
        const RETRIES = 3;
        const BACKOFF_MS = 500;
        let succeeded = 0;
        for (const id of roundIds) {
            for (let attempt = 0; attempt < RETRIES; attempt++) {
                try {
                    await cancelArkPendingRound(id);
                    succeeded++;
                    break;
                } catch (err: any) {
                    if (attempt < RETRIES - 1) {
                        await new Promise((r) => setTimeout(r, BACKOFF_MS));
                    } else {
                        console.warn(
                            '[Ark tap-refresh] cancel gave up after',
                            RETRIES, 'attempts: roundId=', id,
                            'lastErr=', err?.message ?? err,
                        );
                    }
                }
            }
        }
        try {
            await syncArkWallet();
            await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
        } catch (syncErr: any) {
            console.warn(
                '[Ark tap-refresh] post-cancel sync failed:',
                syncErr?.message ?? syncErr,
            );
        }
        if (succeeded === 0) {
            SimpleToast.show(
                'Cancel held up server-side. The round will settle in about a minute, try the notification tap again after that.',
                SimpleToast.LONG,
            );
            return;
        }

        // Re-read fresh store state so we pick up VTXOs that just
        // unlocked. Reproject to row-shaped inputs (mirror of the
        // `rows` useMemo above) for the helper.
        const freshVtxos = useAuthStore.getState().arkVtxos;
        const freshTip = useAuthStore.getState().arkChainTipHeight;
        const freshPromptState =
            useAuthStore.getState().arkArkoorPromptState ?? {};
        const freshDeferredIds = buildDeferredVtxoIds(freshPromptState);
        // Exiting VTXOs excluded for the same reason as the tap-refresh
        // batch above: the exit owns them.
        const projected = freshVtxos.filter((v) => !v.exiting).map((v) => {
            const pending = v.state.toLowerCase() === 'locked';
            if (v.expiryHeight === 0 || freshTip === null) {
                return {
                    id: v.id,
                    sats: v.sats,
                    daysLeft: VTXO_MAX_DAYS,
                    pendingRound: pending,
                    unknownExpiry: true,
                };
            }
            const blocksLeft = Math.max(0, v.expiryHeight - freshTip);
            return {
                id: v.id,
                sats: v.sats,
                daysLeft: blocksToDays(Math.min(blocksLeft, VTXO_MAX_BLOCKS)),
                pendingRound: pending,
                unknownExpiry: false,
            };
        });
        const freshBatch = buildRefreshBatch({
            vtxos: projected,
            deferredIds: freshDeferredIds,
            batchDays: TAP_REFRESH_IMMINENT_DAYS,
            minRefreshSats: ARK_REFRESH_MIN_SATS,
        });

        if (freshBatch.ids.length === 0) {
            // All previously-imminent VTXOs were the locked ones AND
            // they didn't unlock yet (cancel ack'd, sync hasn't caught
            // up). Toast then bail; the next foreground sync will
            // refresh them on its own once they're spendable.
            SimpleToast.show(
                `Cancelled ${succeeded} stuck round${succeeded === 1 ? '' : 's'}. ` +
                `Your capsules should be spendable in a moment, then refresh will run on the next sync.`,
                SimpleToast.LONG,
            );
            return;
        }

        SimpleToast.show(
            `Cancelled ${succeeded} stuck round${succeeded === 1 ? '' : 's'}, retrying refresh now…`,
            SimpleToast.SHORT,
        );
        void refreshIds(freshBatch.ids, { skipConfirm: true });
    };

    /** Per-row icon — refresh just this single VTXO. The fee preview +
     *  confirmation dialog live inside `refreshIds` so the user still
     *  has to opt in before the round commits. */
    const handleRowRefresh = (vtxoId: string) => {
        void refreshIds([vtxoId]);
    };

    /**
     * Cancel a specific pending Lightning receive by payment hash.
     *
     * Two-stage UX:
     *   1. Confirm modal — plain copy because cancel is safe by construction
     *      (verified against bark 0.1.3 source: bark refuses the call if the
     *      preimage has been revealed or the receive has already settled, so
     *      the worst case from a stray confirm is an error toast, not a
     *      forfeit).
     *   2. On confirm: fire `cancelArkLightningReceive`, optimistically drop
     *      the row from zustand on success (the 30s sync will reconcile if
     *      something unexpected put it back), surface the SDK's guard-error
     *      reason on failure ("payment already in flight", "already settled",
     *      generic transient).
     */
    const handleCancelPendingLnReceive = useCallback(
        (paymentHash: string, sats: number) => {
            Alert.alert(
                "Cancel Lightning receive?",
                `Cancel pending Lightning receive of ${formatCapsuleAmount(sats)}? ` +
                `The sender (if any) will see the invoice as unpaid.`,
                [
                    { text: "Keep waiting", style: "cancel" },
                    {
                        text: "Cancel receive",
                        style: "destructive",
                        onPress: async () => {
                            const result = await cancelArkLightningReceive(paymentHash);
                            if (result.ok) {
                                // Optimistic update: read latest zustand state at
                                // tap time (not at handler-bind time) so we don't
                                // race with a parallel sync tick that just landed.
                                const current =
                                    useAuthStore.getState().arkPendingLnReceives;
                                setArkPendingLnReceives(
                                    current.filter((r) => r.paymentHash !== paymentHash),
                                );
                                SimpleToast.show(
                                    "Lightning receive cancelled.",
                                    SimpleToast.SHORT,
                                );
                            } else {
                                // Leave the row in place — for the two terminal
                                // guard errors the row reflecting "still pending"
                                // is misleading, but the next sync tick (≤30s)
                                // either drops it (already-finished case) or
                                // updates it (preimage-revealed → claim in
                                // flight). Toast carries the reason regardless.
                                SimpleToast.show(result.reason, SimpleToast.LONG);
                            }
                        },
                    },
                ],
                { cancelable: true },
            );
        },
        [setArkPendingLnReceives],
    );

    /**
     * Per-row icon (transient-state variant) — cancels every ongoing
     * refresh/send/board round so the user's locked VTXOs become
     * spendable again immediately. RoundState carries no VTXO mapping,
     * so we can't pinpoint a single round for a single capsule tap —
     * cancelling them all is the pragmatic UX (in practice the user
     * almost always has exactly one round in flight). Per Erik (Bark
     * team): cancellation may be refused if a round has already
     * finalised server-side; the next sync picks up the actual result.
     */
    const handleRowCancel = async () => {
        // Read from the module so we don't race against a stale render
        // value (e.g. two rapid taps within the same render cycle).
        if (getArkCancelling()) return;
        setArkCancelling(true);
        try {
            const states = await fetchArkPendingRoundStates();
            const ongoing = states.filter((s) => s.ongoing);
            if (ongoing.length === 0) {
                SimpleToast.show('No active refresh to cancel', SimpleToast.SHORT);
                return;
            }
            // Per-round cancel with retry. Bark's cancel can fail with
            // BarkError.Internal "Timed out waiting for lock on round
            // state N" — the round-progression logic is holding an
            // internal lock and our cancel call couldn't acquire it.
            // Lock contention is transient (the progression loop hands
            // it back between iterations), so a small retry budget with
            // 500ms backoff usually catches a free window. After 3
            // attempts we give up and lean on the natural-settlement
            // path (round fails out on its own ~1 min later and sync
            // reflects it). See refresh.ts cancelArkPendingRound for
            // the wrapper that surfaces the inner errorMessage.
            const RETRIES = 3;
            const BACKOFF_MS = 500;
            let succeeded = 0;
            for (const s of ongoing) {
                let lastErr: any = null;
                for (let attempt = 0; attempt < RETRIES; attempt++) {
                    try {
                        await cancelArkPendingRound(s.id);
                        succeeded++;
                        lastErr = null;
                        break;
                    } catch (err: any) {
                        lastErr = err;
                        if (attempt < RETRIES - 1) {
                            await new Promise((r) => setTimeout(r, BACKOFF_MS));
                        }
                    }
                }
                if (lastErr) {
                    console.warn(
                        '[Ark] cancel round gave up after',
                        RETRIES, 'attempts: roundId=', s.id,
                        'lastErr=', lastErr?.message ?? lastErr,
                    );
                }
            }
            // Drive a sync immediately so successful cancels show up
            // in zustand (Locked → Spendable). For rounds that didn't
            // cancel, we leave `cancelling=true` and poll for the
            // pendingRound to drop on its own — the round usually
            // fails out within a minute or two and sync picks it up.
            try {
                await syncArkWallet();
                await Promise.all([fetchArkBalance(), fetchArkVtxos()]);
            } catch (syncErr: any) {
                console.warn('[Ark] post-cancel sync failed:', syncErr?.message ?? syncErr);
            }
            if (succeeded === ongoing.length) {
                SimpleToast.show(
                    `Cancelled ${succeeded} refresh${succeeded === 1 ? '' : 'es'} — funds unlocked`,
                    SimpleToast.SHORT,
                );
            } else if (succeeded > 0) {
                SimpleToast.show(
                    `Cancelled ${succeeded} of ${ongoing.length} — the rest will settle in ~1 min`,
                    SimpleToast.LONG,
                );
            } else {
                SimpleToast.show(
                    'Cancel held up server-side — the round will settle in ~1 min',
                    SimpleToast.LONG,
                );
            }
        } catch (err: any) {
            console.warn('[Ark] fetch pending rounds for cancel failed:', err?.message ?? err);
            SimpleToast.show('Cancel failed — try again in a moment', SimpleToast.LONG);
            // Outer-catch (the fetch itself failed, not the per-round
            // cancels). No round was ever attempted; clear the UI gate
            // immediately so the X icon comes back and the user can
            // retry.
            setArkCancelling(false);
        }
        // NOTE: NOT clearing `cancelling` here on the success path —
        // the module-level singleton clears it when pendingRoundSats
        // drops to 0 (real round settlement) or when the 2-min safety
        // timeout fires (bark stuck). That keeps the "Cancelling"
        // label up until funds actually unlock, not just until our
        // async cancel call returns (which can be misleadingly fast
        // on internal lock timeouts).
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
    const strandedDust = React.useMemo(() => {
        // Live capsules below the per-input refresh floor. They can't join a
        // round (bark rejects the whole round on a sub-floor input) and can't
        // be economically exited, so they are a one-way trap unless spent.
        // Surface them so the user spends them (a normal payment folds them in
        // via coin-selection) before they expire. Excludes pendingRound
        // (mid-round) and already-expired rows.
        //
        // Round-based "consolidation" was removed: it batched sub-floor dust
        // with fillers on the false premise that the round minimum is an
        // aggregate, when it is per-input, so the round always failed.
        const dust = rows.filter(
            (r) => r.sats < ARK_REFRESH_MIN_SATS && !r.pendingRound && r.daysLeft > 0,
        );
        const total = dust.reduce((a, r) => a + r.sats, 0);
        return { dust, total };
    }, [rows]);

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

    // Refresh-in-flight signals for the action button + wait banner.
    // `roundInFlight` (any Locked VTXO) is the same signal that flips the
    // per-row refresh icon to a cancel-X, and it persists for the whole round
    // (up to a few hours), so it drives the "Cancel" label and the banner.
    // `refreshing` is the brief local submit phase before the round is Locked.
    const roundInFlight = pendingRoundSats > 0;
    const refreshInFlight = refreshing || roundInFlight;
    // Round start timestamps for the wait-banner countdowns. Values are the
    // first-seen ms per in-flight round; the banner turns each into a 3h
    // countdown and drops it when it elapses or its round completes.
    const roundStarts = Object.values(arkPendingRoundFirstSeen ?? {});

    // Soonest (pre-refresh) expiry among Locked capsules, the deadline a
    // stuck round is failing to extend. Drives the stuck banner's escalation
    // from "cancel & retry" to "swap it out and retry later" once inside
    // STUCK_SWAP_BANNER_DAYS. Only meaningful while a stuck round holds funds.
    const soonestStuckDaysLeft = arkRefreshStuck
        ? rows.reduce(
            (min, r) =>
                r.pendingRound && !r.unknownExpiry && Number.isFinite(r.daysLeft) && r.daysLeft < min
                    ? r.daysLeft
                    : min,
            Infinity,
        )
        : Infinity;
    // Offer the swap-out path when a stuck round's funds are near expiry: the
    // existing 12h `nearExpiry` gate OR our wider multi-day banner window.
    const stuckExpirySoon =
        !!arkRefreshStuck &&
        (arkRefreshStuck.nearExpiry || soonestStuckDaysLeft <= STUCK_SWAP_BANNER_DAYS);

    return (
        <View style={vaultStyles.flex}>
            {/* Header block: prominent Auto-refresh on/off status on the
                first row (left-aligned), then the explainer tagline +
                "Learn more" link + "?" entry point on the second row.
                The on/off line is read-only — the actual toggle lives on
                the Ark Settings tab. */}
            <View style={{ marginHorizontal: 20, marginTop: 14, marginBottom: 8, alignItems: 'flex-start' }}>
                <Text bold style={{ fontSize: 16, color: '#FFF', marginBottom: 6 }}>
                    Reminders:{' '}
                    <Text
                        bold
                        style={{ color: arkBgRefreshEnabled ? colors.green : colors.redLight, fontSize: 16 }}
                    >
                        {arkBgRefreshEnabled ? 'on' : 'off'}
                    </Text>
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
                    <Text style={{ fontSize: 13, color: '#888', flex: 1 }}>
                        Your lightning capsules (VTXOs) must be refreshed before they expire. Once expired, recovery is not guaranteed.{' '}
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

            {/* DEV-ONLY stuck-refresh test harness. Never renders in a release
                build (__DEV__ is false). Lets us exercise the swap-out UX
                without a real ASP-side wedge: "Simulate stuck" injects a
                near-expiry stuck state (empty roundIds so nothing real is
                cancelled) which lights up the home-card + Capsules banners and
                makes ArkStuckCapsuleScreen reachable; "Fire notification"
                fires the 12h swap-out push immediately to test its content +
                tap routing; "Clear" removes the simulated state. */}
            {/* Commented out for release. To re-enable on-device testing,
                uncomment this block AND re-add `notifyStuckSwapNow` to the
                @Cypher/services/ark import above. It is __DEV__-gated so it
                never renders in production either way.
            {__DEV__ && (
                <View style={{ marginHorizontal: 20, marginBottom: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#555', borderStyle: 'dashed' }}>
                    <Text bold style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>DEV: stuck-refresh test</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        <TouchableOpacity
                            onPress={() => setArkRefreshStuck({ stuckRoundIds: [], stuckSats: 12500, detectedAtTip: chainTipHeight ?? 0, nearExpiry: true })}
                            style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#333', marginRight: 8, marginBottom: 6 }}
                        >
                            <Text style={{ fontSize: 12, color: '#EEE' }}>Simulate stuck</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => notifyStuckSwapNow(12500)}
                            style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#333', marginRight: 8, marginBottom: 6 }}
                        >
                            <Text style={{ fontSize: 12, color: '#EEE' }}>Fire notification</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => setArkRefreshStuck(null)}
                            style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#333', marginBottom: 6 }}
                        >
                            <Text style={{ fontSize: 12, color: '#EEE' }}>Clear</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
            */}

            {/* Stuck-refresh recovery banner. The equivalent home-card banner
                (ArkWallet) is invisible to a user sitting on this tab watching
                a capsule pulse "Refreshing…" — which is exactly when they need
                it. Driven by the time-based stuck detection in useArkSync
                (flags rounds pending past 2× the round interval, ongoing or
                finalising). Tap cancels the wedged round(s) to unlock the
                VTXOs. */}
            {arkRefreshStuck && (
                <TouchableOpacity
                    // Near expiry (12h gate) OR stuck within STUCK_SWAP_BANNER_DAYS:
                    // a failing round is eating the runway, so this becomes the
                    // Capsules-tab entry into the "move your funds out" screen.
                    // Otherwise keep the in-place cancel-and-retry recovery.
                    onPress={stuckExpirySoon
                        ? () => dispatchNavigate('ArkStuckCapsuleScreen', {})
                        : handleStuckRecovery}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={stuckExpirySoon
                        ? 'Move your stuck funds out'
                        : 'Recover stuck refresh'}
                    style={{
                        marginHorizontal: 20,
                        marginBottom: 10,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.redLight,
                        backgroundColor: 'rgba(253,122,104,0.10)',
                    }}
                >
                    <Text bold style={{ color: colors.redLight, fontSize: 13, lineHeight: 18 }}>
                        {arkRefreshStuck.nearExpiry ? (
                            <>
                                Warning: Refresh stuck near expiry · {arkRefreshStuck.stuckSats.toLocaleString()} sats.{' '}
                                <Text bold style={{ color: colors.redLight, textDecorationLine: 'underline' }}>
                                    Tap to move funds out
                                </Text>
                            </>
                        ) : stuckExpirySoon ? (
                            <>
                                Refresh looks stuck and this capsule expires soon.{' '}
                                <Text bold style={{ color: colors.redLight, textDecorationLine: 'underline' }}>
                                    Tap to swap it to another wallet
                                </Text>
                            </>
                        ) : (
                            <>
                                Refresh stuck for {arkRefreshStuck.stuckSats.toLocaleString()} sats.{' '}
                                <Text bold style={{ color: colors.redLight, textDecorationLine: 'underline' }}>
                                    Tap to recover.
                                </Text>
                            </>
                        )}
                    </Text>
                    <Text style={{ color: '#B0B0B0', fontSize: 11, marginTop: 3, lineHeight: 15 }}>
                        {arkRefreshStuck.nearExpiry
                            ? 'Refresh process is stuck and some capsules are about to expire. Tap to move funds to another wallet before they expire.'
                            : stuckExpirySoon
                                ? `This refresh keeps failing and the capsule has ${formatTimeLeftDetailed(soonestStuckDaysLeft)}. Move it to another wallet and try the refresh again later.`
                                : 'This round is taking longer than expected. Recovering unlocks your capsules so you can try again. Your funds are safe.'}
                    </Text>
                </TouchableOpacity>
            )}

            {/* Stranded-dust notice. Surfaces when the wallet holds capsules
                below the per-input refresh floor: they can't be refreshed
                (bark rejects a round with any sub-floor input) and can't be
                economically exited, so the only way to keep their value is to
                spend them before they expire. This banner is the one place a
                user learns that. Round-based "consolidation" was removed: the
                round minimum is per-input, not aggregate, so it always failed. */}
            {strandedDust.dust.length > 0 && (
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
                        {strandedDust.dust.length} tiny capsule{strandedDust.dust.length === 1 ? '' : 's'} cannot be refreshed
                    </RNText>
                    <RNText style={{ fontSize: 12, color: '#ddd' }}>
                        Below the {ARK_REFRESH_MIN_SATS}-sat round minimum ({strandedDust.total.toLocaleString()} sats total). Spend {strandedDust.dust.length === 1 ? 'it' : 'them'} in a payment before {strandedDust.dust.length === 1 ? 'it expires' : 'they expire'}. A normal send folds {strandedDust.dust.length === 1 ? 'it' : 'them'} in.
                    </RNText>
                </View>
            )}

            {/* Column header row — matches Hot Vault's layout */}
            <View style={vaultStyles.titleStyle}>
                <Text bold style={vaultStyles.coin}>Capsules</Text>
                <Text bold style={vaultStyles.size}>Size</Text>
                {/* Column header for the per-row refresh/cancel icons. Flips to
                    "Cancel" while a round is in flight, matching the per-row
                    icons that switch from the refresh arrows to a cancel-X. */}
                <Text
                    bold
                    numberOfLines={1}
                    style={[vaultStyles.label, { fontSize: 18, textAlign: 'left', marginLeft: -8, flex: 1.35 }]}
                >
                    {roundInFlight ? 'Cancel' : 'Refresh'}
                </Text>
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
                        onCancelIcon={handleRowCancel}
                        isCancelling={cancelling}
                        roundIntervalSecs={arkRoundIntervalSecs}
                        failedAttempts={arkRefreshFailStreak}
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
                                    onPress={() =>
                                        handleCancelPendingLnReceive(
                                            r.paymentHash,
                                            r.amountSats,
                                        )
                                    }
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
                                No lightning capsules yet. Receive Bitcoin via Ark to populate.
                            </Text>
                        </View>
                    )
                }
                // Stuck on-chain (boarding) funds capsule + recover action,
                // rendered under the last VTXO so it scrolls with the list.
                style={{ marginTop: 10, flex: 1 }}
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
                {/* Green pulsing "come back in 3 hours" reminder while a
                    refresh round is in flight (or being submitted), with a
                    live 3h countdown per in-flight round. Flips to a stuck
                    state with a Cancel action once a round's 3h elapses. */}
                {refreshInFlight && (
                    <RefreshWaitBanner
                        roundStarts={roundStarts}
                        cancelling={cancelling}
                        onCancel={handleRowCancel}
                    />
                )}
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
