import React from 'react';
import {
    Image,
    Linking,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import dayjs from 'dayjs';

import { ScreenLayout, Text } from '@Cypher/component-library';
import { Bitcoin, Socked } from '@Cypher/assets/images';
import type {
    ArkMovementKind,
    ArkMovementStatus,
    ArkMovementView,
} from '@Cypher/services/ark';
import { colors } from '@Cypher/style-guide';

import TextView from '../../Invoice/TextView';
import styles from './styles';

/**
 * ArkTransactionDetailsScreen — per-movement detail view for the Ark history.
 *
 * Opened from an `ArkHistoryRow` tap. The full `ArkMovementView` is passed
 * via route params (all plain JS — no bigints, no promises, no handle
 * references), so this screen renders purely from params and doesn't need to
 * re-call the SDK. That keeps it fast and avoids race conditions with the
 * 30 s sync loop mutating history mid-render.
 *
 * Layout closely mirrors `src/screens/Invoice/index.tsx` (the Strike/CoinOS
 * details screen) so the interaction is consistent across wallet types:
 *   - Back button + title
 *   - Big signed-sats amount + fiat directly under it
 *   - `TextView` rows for each field (Status, Via, Date, Fee, …)
 *   - Optional "View in explorer" button for on-chain-anchored movements
 *
 * On-chain anchor detection (for the explorer button) is intentionally
 * conservative — the SDK's `metadataJson` shape varies by subsystem and we
 * don't want to link to a nonexistent txid. We only surface the button for
 * `kind === 'onchain' | 'board' | 'exit'` AND when we can pull a 64-hex
 * string out of metadata or the sentTo/receivedOn arrays. Lightning and
 * pure-Ark movements have no canonical on-chain ref, so no button.
 */

interface Props {
    route: {
        params?: {
            movement?: ArkMovementView;
            matchedRate?: number | string;
            currency?: string;
            explorerBase?: string; // optional override for mainnet vs signet
        };
    };
}

export default function ArkTransactionDetailsScreen({ route }: Props) {
    const movement = route?.params?.movement;
    const matchedRate = Number(route?.params?.matchedRate ?? 0);
    const explorerBase =
        route?.params?.explorerBase ?? 'https://mempool.space';

    // Guard: defensive — if someone navigates here without params (deep-link,
    // state restoration edge case), render an empty state rather than crash.
    if (!movement) {
        return (
            <ScreenLayout showToolbar isBackButton title="Transaction Details">
                <View style={styles.main}>
                    <Text white style={{ textAlign: 'center', marginTop: 40 }}>
                        Transaction not found.
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    const {
        amountSats,
        feeSats,
        status,
        kind,
        description,
        timestamp,
        sentTo,
        receivedOn,
        inputVtxoIds,
        outputVtxoIds,
        raw,
    } = movement;

    const absSats = Math.abs(amountSats);
    const sign = amountSats >= 0 ? '+' : '-';
    const amountColor = rowAmountColor(kind, status, amountSats);
    // matchedRate is already USD-per-sat (HomeScreen converts from
    // USD-per-BTC with `* btc(1)` before storing — see handleUser line 671
    // + 676-677). Don't multiply by btc(1) again here.
    const fiatAmount = absSats * matchedRate;
    const feeFiat = feeSats > 0 ? (feeSats * matchedRate).toFixed(2) : null;
    // Fee % of total debited. `effectiveBalanceSats` (== amountSats here)
    // already bakes the fee into the signed delta, so for sends |amountSats|
    // is the gross amount. Capped at 999% to keep tiny-amount edge cases
    // from breaking layout. Only meaningful when fee > 0 — receives have
    // no fee column anyway.
    const feePct =
        feeSats > 0 && absSats > 0
            ? Math.min(999, (feeSats / absSats) * 100)
            : null;

    // Try to extract an on-chain txid for the explorer button. Kept lenient
    // so we don't have to track every SDK metadata shape — any 64-hex string
    // in a plausible field will do. If nothing matches, no button.
    //
    // We *don't* gate on `kind` — the Bark SDK's `subsystemKind` /
    // `subsystemName` strings vary (and right now most movements come back
    // classified as `'other'` because the SDK's casing doesn't match our
    // heuristics in classifyKind). Presence of a 64-hex string in metadata
    // is a strong-enough signal on its own; false positives would require
    // the SDK to deliberately stash a 64-char hex non-txid somewhere, which
    // it doesn't. Lightning movements have a `paymentHash` that *is* 64 hex
    // — we accept that the explorer link will 404 for those rare cases
    // rather than hide the button for the common on-chain case.
    const onchainTxid = findOnchainTxid(movement);
    const canLinkExplorer = !!onchainTxid;

    const handleOpenExplorer = () => {
        if (!onchainTxid) return;
        // Append #details so mempool.space auto-expands the inputs/outputs
        // section and we land on the full transaction view rather than the
        // mobile-collapsed summary that hides everything behind a "see more
        // details" tap. On non-mempool.space explorers the fragment is
        // ignored, so this is safe as a default.
        const url = `${explorerBase}/tx/${onchainTxid}#details`;
        Linking.openURL(url).catch((err) =>
            console.warn('[Ark tx details] open explorer failed:', err),
        );
    };

    return (
        <ScreenLayout showToolbar isBackButton title="Transaction Details">
            <ScrollView
                style={styles.main}
                contentContainerStyle={{ paddingBottom: 40 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Amount block — matches Invoice screen styling. The kind
                    icon sits above the amount so the row reads "how it moved"
                    → "how much". */}
                <View style={styles.valueView}>
                    <Image
                        source={kind === 'lightning' ? Socked : Bitcoin}
                        style={styles.kindIcon}
                    />
                    <Text
                        semibold
                        style={StyleSheet.flatten([
                            styles.sats,
                            { color: amountColor },
                        ])}
                    >
                        {sign}
                        {absSats} sats
                    </Text>
                    <Text bold subHeader style={{ color: amountColor }}>
                        ${fiatAmount.toFixed(2)}
                    </Text>
                    <Text italic style={styles.description}>
                        {description}
                    </Text>
                </View>

                {/* Field list — same TextView component the Invoice screen
                    uses. Fields in the order a user most likely cares about:
                    status → rail → timing → fee → counterparty → internals. */}
                <TextView keytext="Status: " text={prettyStatus(status)} />
                <TextView keytext="Type: " text={prettyKind(kind)} />
                <TextView
                    keytext="Date: "
                    text={dayjs(timestamp).format('HH:mm:ss MM/DD/YYYY')}
                />
                {raw.completedAt && raw.completedAt !== raw.createdAt && (
                    <TextView
                        keytext="Completed: "
                        text={dayjs(raw.completedAt).format('HH:mm:ss MM/DD/YYYY')}
                    />
                )}
                {feeSats > 0 && (
                    <TextView
                        keytext="Fee: "
                        text={`${feeSats} sats${feeFiat ? `  ·  $${feeFiat}` : ''}`}
                    />
                )}
                {feePct !== null && (
                    <TextView
                        keytext="Fee % of total: "
                        text={
                            feePct < 0.01
                                ? '< 0.01%'
                                : `${feePct.toFixed(feePct < 1 ? 2 : 1)}%`
                        }
                    />
                )}

                {sentTo.length > 0 && (
                    <TextView
                        keytext={sentTo.length === 1 ? 'Sent to: ' : `Sent to (${sentTo.length}): `}
                        text={truncateMiddle(sentTo[0], 40)}
                    />
                )}
                {receivedOn.length > 0 && (
                    <TextView
                        keytext={receivedOn.length === 1 ? 'Received on: ' : `Received on (${receivedOn.length}): `}
                        text={truncateMiddle(receivedOn[0], 40)}
                    />
                )}

                {inputVtxoIds.length > 0 && (
                    <TextView
                        keytext="Input capsules: "
                        text={`${inputVtxoIds.length} consumed`}
                    />
                )}
                {outputVtxoIds.length > 0 && (
                    <TextView
                        keytext="Output capsules: "
                        text={`${outputVtxoIds.length} produced`}
                    />
                )}

                {/* Bitcoin txid — visible to the user so they can verify the
                    on-chain anchor matches what their counterparty / explorer
                    shows. Tapping the row jumps to mempool.space (the default
                    explorer; can be overridden via route params for signet /
                    alternative providers). The button below is kept for
                    discoverability — not everyone will think to tap a
                    truncated hex string. */}
                {canLinkExplorer && onchainTxid && (
                    <TouchableOpacity onPress={handleOpenExplorer}>
                        <TextView
                            keytext="Bitcoin TX ID: "
                            text={truncateMiddle(onchainTxid, 40)}
                        />
                    </TouchableOpacity>
                )}

                {canLinkExplorer && (
                    <TouchableOpacity
                        style={styles.button}
                        onPress={handleOpenExplorer}
                    >
                        <Text bold h4 style={styles.buttonText}>
                            View on mempool.space
                        </Text>
                    </TouchableOpacity>
                )}

                {/* Debug footer: raw subsystem + name. Tiny, muted — not
                    something the average user reads, but essential when
                    triaging "why did this row classify as X?" reports while
                    the Ark integration stabilises. Promote behind __DEV__
                    once the history flow is solid. */}
                <View style={styles.debugFooter}>
                    <Text style={styles.debugText}>
                        {raw.subsystemKind} · {raw.subsystemName} · id#{movement.id}
                    </Text>
                </View>
            </ScrollView>
        </ScreenLayout>
    );
}

// --- helpers ---

function prettyStatus(status: ArkMovementStatus): string {
    switch (status) {
        case 'successful': return 'Confirmed';
        case 'pending':    return 'Pending';
        case 'failed':     return 'Failed';
        case 'canceled':   return 'Canceled';
        default:           return 'Unknown';
    }
}

function prettyKind(kind: ArkMovementKind): string {
    switch (kind) {
        case 'lightning': return 'Lightning';
        case 'ark':       return 'Ark (capsule send)';
        case 'onchain':   return 'Bitcoin on-chain';
        case 'board':     return 'Board to Ark';
        case 'exit':      return 'Exit from Ark';
        case 'refresh':   return 'Capsule refresh';
        default:          return 'Movement';
    }
}

/**
 * Pick the headline amount color. Same logic as the history row so a row
 * tapped on green doesn't suddenly render red on the details screen.
 */
function rowAmountColor(
    kind: ArkMovementKind,
    status: ArkMovementStatus,
    amountSats: number,
): string {
    if (status === 'failed' || status === 'canceled') return colors.gray.light;
    if (status === 'pending') return colors.ark.light;
    return amountSats >= 0 ? '#4FBF67' : '#FF7A68';
}

/**
 * Ellipsify addresses/invoices so we don't wrap to five lines. Keeps the
 * start + end visible since those are usually what users verify.
 */
function truncateMiddle(s: string, max: number): string {
    if (s.length <= max) return s;
    const keep = Math.floor((max - 3) / 2);
    return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

/**
 * Best-effort txid extraction for the explorer link.
 *
 * We look in, in order:
 *   1. movement.metadata — walk top-level string values for a 64-hex.
 *   2. movement.sentTo / receivedOn — a board/exit movement sometimes puts
 *      the on-chain address here with no separate txid field, which is fine
 *      — we just won't surface the button in that case.
 *
 * A bech32 address is not a txid, so we only match the 64-char lowercase hex
 * shape used by Bitcoin txids. Better to silently skip the button than to
 * generate a 404 explorer URL.
 */
function findOnchainTxid(movement: ArkMovementView): string | null {
    const txidRe = /^[0-9a-f]{64}$/i;

    // metadataJson typically carries a `txid` or `chain_txid` / `boarding_txid`
    // field for on-chain-anchored movements. Walk one level deep; the blob is
    // small (kilobytes at most) so a linear scan is fine.
    const meta = movement.metadata;
    if (meta) {
        for (const v of Object.values(meta)) {
            if (typeof v === 'string' && txidRe.test(v)) return v;
            if (v && typeof v === 'object') {
                for (const w of Object.values(v as Record<string, unknown>)) {
                    if (typeof w === 'string' && txidRe.test(w)) return w;
                }
            }
        }
    }
    for (const s of [...movement.sentTo, ...movement.receivedOn]) {
        if (txidRe.test(s)) return s;
    }
    return null;
}
