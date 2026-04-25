import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, ImageBackground, TouchableOpacity, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import SimpleToast from "react-native-simple-toast";

import { Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import { Tag, Transaction, Yes } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { btc as btcHandle } from "@Cypher/helpers/coinosHelper";
import * as Keychain from "react-native-keychain";
import Share from "react-native-share";

import {
    AVG_BLOCK_MINUTES,
    blocksToDays,
    clearArkWalletHandle,
    createArkWallet,
    estimateArkRefreshFee,
    recoverArkWalletFromKeychain,
    refreshArkVtxosAndSync,
    writeArkBackupToTempFile,
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
     * non-destructive recovery is the encrypted .cbark backup file
     * produced by the Capsules tab's "Back up wallet state" action +
     * the original seed phrase.
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
}

/**
 * VtxoRow — one VTXO. Same Transaction background + 4-column layout as the
 * Hot Vault ListView. The only swap from Hot Vault is the visual in the
 * "coin" column (depletion ring instead of UTXO capsule mask), and the
 * selection halo color is yellow (Ark) instead of green (Vault).
 */
function VtxoRow({ vtxo, selected, onPress }: VtxoRowProps) {
    const view = getExpiryView(vtxo.daysLeft);
    const BTCAmount = btcHandle(vtxo.sats) + " BTC";

    // Pending-round VTXOs: flat yellow label, full ring (so the row doesn't
    // read as "almost expired" while it's actually sitting in a round).
    const labelColor = vtxo.pendingRound ? colors.ark.light : view.color;
    const labelText = vtxo.pendingRound
        ? "Refreshing…"
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
    const [recovering, setRecovering] = useState(false);
    const [backingUp, setBackingUp] = useState(false);
    const arkVtxos = useAuthStore((s) => s.arkVtxos);
    const chainTipHeight = useAuthStore((s) => s.arkChainTipHeight);
    const arkLastBackupAt = useAuthStore((s) => s.arkLastBackupAt);
    const setArkVtxos = useAuthStore((s) => s.setArkVtxos);
    const setArkBalance = useAuthStore((s) => s.setArkBalance);
    const setArkBalanceDetail = useAuthStore((s) => s.setArkBalanceDetail);
    const setArkChainTipHeight = useAuthStore((s) => s.setArkChainTipHeight);
    const setArkLastBackupAt = useAuthStore((s) => s.setArkLastBackupAt);

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
            SimpleToast.show(
                `Refresh failed: ${err?.message ?? "unknown error"}`,
                SimpleToast.LONG,
            );
        } finally {
            setRefreshing(false);
        }
    };

    /**
     * Seed-only recovery. Use when the wallet's local datadir is stuck
     * (unfinalised round, corrupted SQLite, test reset). Wipes the datadir
     * but keeps the Keychain mnemonic, then re-creates a fresh wallet at
     * the same keys.
     *
     * DESTRUCTIVE: Any Locked / pending-round VTXOs become unreachable from
     * the client. The ASP still tracks them; recovery via Second.tech support
     * is an open question. Gated __DEV__ only; prod needs Phase 2 backup
     * before this is safe to expose.
     */
    const handleRecover = () => {
        if (recovering || refreshing) return;
        Alert.alert(
            "Reset Ark wallet state?",
            "Wipes the local Ark database but keeps your seed. Any capsules stuck in a pending round (including any mid-refresh) will become unreachable from this app. Use only if the wallet is stuck.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reset state",
                    style: "destructive",
                    onPress: async () => {
                        setRecovering(true);
                        try {
                            const result = await recoverArkWalletFromKeychain();
                            console.log('[Ark recover] result:', result);
                            if (!result.ok) {
                                const causeMsg =
                                    (result.cause as any)?.message ??
                                    (typeof result.cause === 'string' ? result.cause : '');
                                console.log('[Ark recover] FAILED reason=', result.reason, 'cause=', result.cause);
                                SimpleToast.show(
                                    `Recovery failed: ${result.reason ?? "unknown"}${causeMsg ? ` — ${causeMsg}` : ''}`,
                                    SimpleToast.LONG,
                                );
                                return;
                            }
                            // Scrub stale store fields so the UI doesn't
                            // flash ghost VTXOs before the next sync tick
                            // repopulates from the fresh datadir.
                            setArkVtxos([]);
                            setArkBalance(0);
                            setArkBalanceDetail(null);
                            setArkChainTipHeight(null);
                            // Stale backup timestamp from the previous
                            // wallet would lie to the user about the new
                            // (empty) wallet's safety. Clear it.
                            setArkLastBackupAt(null);
                            setSelectedIds([]);
                            SimpleToast.show(
                                "Wallet state reset. Syncing fresh state…",
                                SimpleToast.LONG,
                            );
                        } catch (err: any) {
                            console.log('[Ark recover] handler threw:', err?.message ?? err, err);
                            SimpleToast.show(
                                `Recovery failed: ${err?.message ?? "unknown error"}`,
                                SimpleToast.LONG,
                            );
                        } finally {
                            setRecovering(false);
                        }
                    },
                },
            ],
        );
    };

    /**
     * Manual encrypted backup of the wallet datadir.
     *
     * Critical for non-destructive recovery. Bark VTXOs cannot be
     * reconstructed from the seed alone (no `list_by_pubkey` endpoint on
     * the ASP, and presigned forfeit / exit txs live in the local datadir).
     * This export is the only thing that lets a user reset / lose their
     * device / reinstall without losing funds.
     *
     * Sequence:
     *   1. Read seed from Keychain (biometric prompt; fail-fast if absent)
     *   2. Close the live wallet so SQLite checkpoints — the export reads
     *      raw files; an open wallet would have un-flushed WAL pages that
     *      don't replay on restore. We re-open with `createArkWallet` after.
     *   3. Build encrypted blob, write to a temp .cbark file
     *   4. Re-open the wallet so the user keeps using it (this UX path is
     *      a backup, not a logout — they shouldn't lose their session)
     *   5. Hand the file path to the iOS share sheet via `react-native-share`
     *
     * If anything between steps 2 and 4 throws, we MUST still re-open.
     * Hence the wallet re-init lives in a finally block — the user must
     * not be left handle-less because their backup failed.
     */
    const handleBackup = async () => {
        if (backingUp || refreshing || recovering) return;

        const creds = await Keychain.getGenericPassword({ service: "ark-seed-phrase" });
        if (!creds || !creds.password) {
            SimpleToast.show(
                "Can't back up — seed not in Keychain. Use the Recover screen to type it in first.",
                SimpleToast.LONG,
            );
            return;
        }
        const mnemonic = creds.password;

        setBackingUp(true);
        let reopenError: unknown = null;
        let backupResult: { path: string; sizeBytes: number; createdAt: number } | null = null;
        try {
            // Step 2: close wallet → SQLite WAL flushed via uniffiDestroy.
            clearArkWalletHandle();
            // Step 3: pack + encrypt + write temp file.
            backupResult = await writeArkBackupToTempFile(mnemonic);
        } catch (err: any) {
            console.warn('[Ark backup] export threw:', err?.message ?? err);
            SimpleToast.show(
                `Backup failed: ${err?.message ?? "unknown error"}`,
                SimpleToast.LONG,
            );
        } finally {
            // Step 4: re-open wallet no matter what happened above. We
            // pass forceRescan=false because the datadir on disk hasn't
            // been touched by the export (it's read-only) and a fresh
            // rescan would just delay the restored state.
            try {
                await createArkWallet(mnemonic, false);
            } catch (err) {
                reopenError = err;
                console.warn('[Ark backup] wallet re-open threw after export:', err);
            }
            setBackingUp(false);
        }

        if (reopenError) {
            // The backup file may have been created successfully even if the
            // re-open path errored — but the user's wallet handle is now dead.
            // Surface the more pressing issue (handle gone) rather than the
            // backup outcome. Easy recovery: app reload triggers boot sync.
            SimpleToast.show(
                "Backup saved, but wallet handle didn't re-open — reload the app to restore your session.",
                SimpleToast.LONG,
            );
        }

        if (!backupResult) return;

        // Step 5: share sheet. We let the user pick where the file goes —
        // iCloud Drive, Files app, AirDrop, email-to-self, whatever they
        // trust. Encrypted blob in user's hands; no plaintext seed leaves
        // the device.
        try {
            await Share.open({
                title: "Save your Ark wallet backup",
                message:
                    "Encrypted Ark wallet backup. Save this file somewhere safe (iCloud Drive recommended). To restore, you'll need both this file AND your 12-word seed phrase.",
                url: `file://${backupResult.path}`,
                type: "application/octet-stream",
                filename: backupResult.path.split("/").pop() ?? "ark-backup.cbark",
                failOnCancel: false,
                saveToFiles: true,
            });
            // Stamp the success timestamp ONLY after the share sheet
            // returned without error. iOS share sheets resolve only when
            // the user finishes (saves, AirDrops, cancels-without-throw),
            // so reaching here means the file went somewhere. We rely on
            // the user actually keeping it — but absent that, our
            // recoverability badges would be wildly optimistic anyway.
            setArkLastBackupAt(Date.now());
            SimpleToast.show(
                `Backup ready (${(backupResult.sizeBytes / 1024).toFixed(1)} KB) — save it somewhere safe.`,
                SimpleToast.LONG,
            );
        } catch (err: any) {
            // Share-cancelled isn't really an error from the user's POV but
            // we still produced the file — note the path so they can
            // recover it from the share sheet retry.
            console.warn('[Ark backup] share dialog threw:', err?.message ?? err);
            SimpleToast.show(
                `Backup saved at ${backupResult.path} — tap Back up again to retry sharing.`,
                SimpleToast.LONG,
            );
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
                {/* Back up wallet state — the only path to non-destructive
                    recovery, since Bark VTXOs cannot be re-derived from the
                    seed alone. Always-visible (not __DEV__) because users
                    NEED this to keep their funds safe before any reset. */}
                <TouchableOpacity
                    onPress={handleBackup}
                    disabled={backingUp || refreshing || recovering}
                    style={{ alignSelf: "center", marginTop: 8, paddingVertical: 6, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" }}
                >
                    {backingUp && (
                        <ActivityIndicator
                            color={colors.ark.light}
                            style={{ marginRight: 8 }}
                        />
                    )}
                    <Text
                        bold
                        style={{
                            fontSize: 13,
                            color: backingUp ? colors.gray.disable : colors.ark.light,
                            textDecorationLine: "underline",
                        }}
                    >
                        {backingUp ? "Building backup…" : "Back up wallet state"}
                    </Text>
                </TouchableOpacity>
                {__DEV__ && (
                    <TouchableOpacity
                        onPress={handleRecover}
                        disabled={recovering || refreshing}
                        style={{ alignSelf: "center", marginTop: 4, paddingVertical: 6, paddingHorizontal: 14 }}
                    >
                        <Text
                            bold
                            style={{
                                fontSize: 12,
                                color: recovering ? colors.gray.disable : colors.redLight,
                                textDecorationLine: "underline",
                            }}
                        >
                            {recovering ? "Resetting state…" : "Reset wallet state (keep seed) — DEV"}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}
