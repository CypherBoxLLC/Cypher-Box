import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Clipboard,
    ScrollView,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import SimpleToast from 'react-native-simple-toast';

import { useNavigation } from '@react-navigation/native';

import { ScreenLayout, Text } from '@Cypher/component-library';
import { GradientInput, CustomKeyboard } from '@Cypher/components';
import { dispatchNavigate } from '@Cypher/helpers';
import { getStrikeCurrency } from '@Cypher/helpers/coinosHelper';
import {
    classifyArkDestination,
    estimateArkSendFee,
    executeArkSend,
    labelForDestinationKind,
    type ArkDestination,
    type ArkSendFeeView,
} from '@Cypher/services/ark';
import { colors } from '@Cypher/style-guide';
import useAuthStore from '@Cypher/stores/authStore';
// Repo-level helper (not under src/) — owns the iOS camera permission
// dance + the navigate-to-ScanQRCode callback contract used by every
// scan flow in the app (HotVault, ConnectColdStorage, …).
import { requestCameraAuthorization } from '../../../../helpers/scan-qr';

import styles from './styles';

/**
 * ArkSendScreen — dedicated send flow for the Ark wallet.
 *
 * Why a separate screen (instead of reusing Strike's `SendScreen`): Strike's
 * send targets a custodial Lightning balance with a fixed rail (LN-only) and
 * talks to CoinOS / Strike APIs. Ark is non-custodial, has four distinct
 * send rails (Lightning invoice / Lightning address / Lightning offer / Ark
 * address / on-chain), and calls into the Bark SDK. The destination picker
 * is simply different, so we fork rather than teach one screen two mutually
 * exclusive data flows.
 *
 * Flow:
 *   1. User pastes / types a destination. We classify it live via
 *      `classifyArkDestination` (cheap: prefix regex + one SDK validation
 *      call). A chip shows what we recognised — or "Unrecognised" if the
 *      string doesn't match any rail, which keeps the submit button disabled.
 *   2. User enters an amount in sats via the shared CustomKeyboard.
 *   3. The keyboard's action button serves a two-step role so the user
 *      doesn't see two competing CTAs: first press estimates the fee and
 *      surfaces a breakdown above the keyboard; second press triggers a
 *      native `Alert` confirmation and executes the send on OK.
 *   4. On success, navigate to the shared `SendReceiveSuccessScreen`
 *      animation so the Ark flow ends with the same UX as Strike/CoinOS.
 *
 * SDK caveat: the Bark SDK auto-selects VTXO inputs. We can't honour "spend
 * the oldest capsules first" from here — if the user wants to influence
 * selection they have to refresh the old VTXOs via the Capsules tab before
 * sending. Worth a comment in the spec, not a blocker.
 */

interface Props {
    route: {
        params?: {
            matchedRate?: number | string;
            currency?: string;
            /** Pre-fill when coming from a QR scan / deep link. Optional. */
            initialDestination?: string;
        };
    };
}

export default function ArkSendScreen({ route }: Props) {
    const matchedRate = Number(route?.params?.matchedRate ?? 0);
    const currency = route?.params?.currency ?? 'USD';

    // Read spendable directly from the store so we can pre-empt the SDK with
    // a clear "insufficient funds" message. The Bark SDK surfaces low-balance
    // as a generic `BarkError.Internal` with no structured reason, which is
    // useless in the UI. The store is kept fresh by the 30 s useArkSync tick.
    const arkBalance = useAuthStore((s) => s.arkBalance);
    const spendableSats = Number(arkBalance ?? 0);

    const [destinationRaw, setDestinationRaw] = useState<string>(
        route?.params?.initialDestination ?? '',
    );
    const [sats, setSats] = useState('');
    const [usd, setUSD] = useState('');
    const [isSats, setIsSats] = useState(true);

    const [fee, setFee] = useState<ArkSendFeeView | null>(null);
    const [isEstimating, setIsEstimating] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const destination: ArkDestination = useMemo(
        () => classifyArkDestination(destinationRaw),
        [destinationRaw],
    );

    // Any edit to destination or amount invalidates a prior fee estimate.
    // Clearing the fee here means the user can't submit a stale number after
    // tweaking the amount by one digit.
    const onChangeDestination = useCallback((text: string) => {
        setDestinationRaw(text);
        setFee(null);
        setErrorMsg(null);
    }, []);

    const handlePaste = useCallback(async () => {
        try {
            const pasted = await Clipboard.getString();
            if (!pasted) {
                SimpleToast.show('Clipboard empty', SimpleToast.SHORT);
                return;
            }
            onChangeDestination(pasted.trim());
        } catch (err) {
            console.warn('[ArkSend] paste failed:', err);
        }
    }, [onChangeDestination]);

    const navigation = useNavigation<any>();

    /**
     * Open the shared QR scanner, drop whatever it returns into the
     * destination input. We don't pre-filter scheme prefixes here — the
     * already-mounted `classifyArkDestination` handles every rail the
     * SDK accepts (`bc1…`, `bitcoin:…`, `lnbc…`, `lightning:…`,
     * `ark1…`, `lnurl…`, plain LN addresses). Anything unrecognised
     * lands as "Unrecognised" in the kind-pill, which keeps the submit
     * button disabled — same UX as a paste of garbage.
     *
     * `ret` shape comes from the BlueWallet ScanQRCode screen and can
     * be either a string or `{ data: string }` depending on the
     * camera path; the `ret.data ?? ret` shim mirrors the convention
     * used in HotStorageVault/Settings.tsx etc.
     */
    const handleScan = useCallback(() => {
        requestCameraAuthorization().then(() => {
            navigation.navigate('ScanQRCodeRoot', {
                screen: 'ScanQRCode',
                params: {
                    showFileImportButton: false,
                    onBarScanned: (ret: any) => {
                        // ScanQRCode is mounted as a modal stack — pop the
                        // root so we land back on this screen, not on
                        // ScanQRCode + this screen stacked.
                        navigation.getParent()?.pop();
                        const raw = typeof ret === 'string'
                            ? ret
                            : (ret?.data ?? '');
                        if (!raw) {
                            SimpleToast.show('No data in QR code', SimpleToast.SHORT);
                            return;
                        }
                        // Strip common URI-scheme prefixes the classifier
                        // also accepts, but trim whitespace + newlines that
                        // some QR encoders attach. Lower-casing is left to
                        // the classifier (Lightning is case-insensitive,
                        // Ark / on-chain bech32 must NOT be lower-cased
                        // until validation — let the SDK decide).
                        onChangeDestination(raw.trim());
                    },
                },
            });
        }).catch((err: any) => {
            console.warn('[ArkSend] camera authorization failed:', err?.message ?? err);
            SimpleToast.show('Camera permission needed to scan', SimpleToast.SHORT);
        });
    }, [navigation, onChangeDestination]);

    // CustomKeyboard owns the sats string state internally and pushes it up
    // through setSATS. When the amount changes after we've already estimated,
    // clear the stale fee — same reason as the destination reset above.
    const handleSatsFromKeyboard = useCallback((next: string) => {
        setSats(next);
        if (fee) setFee(null);
        if (errorMsg) setErrorMsg(null);
    }, [fee, errorMsg]);

    const satsNumber = isSats ? Number(sats) : 0; // fee path uses sats only
    const destinationValid = destination.kind !== 'unknown';
    const amountValid = isSats && Number.isFinite(satsNumber) && satsNumber > 0;
    // Local pre-check: refuse to hand the SDK an amount we already know it
    // can't fund. The SDK would fail with `BarkError.Internal` and we'd have
    // no structured way to surface "0 sats available" to the user.
    const amountWithinBalance = satsNumber <= spendableSats;
    // Once a fee is known, the binding constraint is gross (amount + fee) ≤ balance.
    // Without this, a user with exactly 1000 sats can "confirm" a 1000-sat send
    // that needs 1020 gross — the SDK then fails with an opaque BarkError.Internal.
    const grossWithinBalance = fee
        ? fee.grossAmountSats <= spendableSats
        : amountWithinBalance;
    const canEstimate =
        destinationValid && amountValid && amountWithinBalance && !isEstimating && !isSending;
    const canSend = canEstimate && !!fee && grossWithinBalance;

    const handleEstimate = useCallback(async () => {
        if (!canEstimate) return;
        setIsEstimating(true);
        setErrorMsg(null);
        try {
            const estimate = await estimateArkSendFee(destination, satsNumber);
            setFee(estimate);
        } catch (err: any) {
            console.warn('[ArkSend] fee estimate failed:', err);
            setErrorMsg(
                `Fee estimate failed: ${err?.message ?? 'unknown error'}`,
            );
        } finally {
            setIsEstimating(false);
        }
    }, [canEstimate, destination, satsNumber]);

    const runSend = useCallback(async () => {
        setIsSending(true);
        setErrorMsg(null);
        try {
            const result = await executeArkSend(destination, satsNumber);
            // Navigate to the shared success screen so the Ark flow ends
            // with the same animation the custodial wallets use. `value` is
            // the net sats that actually left the wallet; `valueUsd` is the
            // fiat equivalent computed against `matchedRate` (USD per sat).
            const netSats = result.netAmountSats;
            const fiat = (netSats * matchedRate).toFixed(2);
            dispatchNavigate('SendReceiveSuccessScreen', {
                isReceive: false,
                value: String(netSats),
                valueUsd: fiat,
            });
        } catch (err: any) {
            console.error('[ArkSend] send failed:', err);
            setErrorMsg(
                `Send failed: ${err?.message ?? 'unknown error'}. Your funds were not moved.`,
            );
        } finally {
            setIsSending(false);
        }
    }, [destination, satsNumber, matchedRate]);

    const handleConfirm = useCallback(() => {
        if (!canSend || !fee) return;
        // Native confirm — quote the fee numbers that were just estimated so
        // the user's last view of the cost is identical to what the send
        // will charge. (Fee can still drift slightly if VTXO state changes
        // between estimate and execute, but that's a sub-second window.)
        Alert.alert(
            'Confirm send',
            `${labelForDestinationKind(destination.kind)}\n\nAmount: ${satsNumber.toLocaleString()} sats` +
                `\nFee: ${fee.feeSats.toLocaleString()} sats` +
                `\nTotal: ${fee.grossAmountSats.toLocaleString()} sats`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Send',
                    style: 'default',
                    onPress: () => {
                        void runSend();
                    },
                },
            ],
        );
    }, [canSend, fee, destination.kind, satsNumber, runSend]);

    // The CustomKeyboard's primary action button serves both phases of the
    // flow. Before a fee has been estimated, it estimates; after, it opens
    // the confirm dialog. This keeps a single visible CTA on screen at all
    // times rather than stacking "Estimate" and "Confirm" next to each other
    // (which reads as "why are there two send buttons?").
    const keyboardTitle = fee ? 'Confirm send' : 'Estimate fee';
    const keyboardOnPress = fee ? handleConfirm : handleEstimate;
    const keyboardDisabled = fee ? !canSend : !canEstimate;

    // --- Destination pill styling --------------------------------------
    const pillIsEmpty = destinationRaw.trim().length === 0;
    const pillBorderColor = pillIsEmpty
        ? '#333'
        : destinationValid
            ? colors.ark.light
            : '#FF7A68';
    const pillTextColor = pillIsEmpty
        ? colors.gray.light
        : destinationValid
            ? colors.ark.light
            : '#FF7A68';
    const pillLabel = pillIsEmpty
        ? 'Paste an invoice, address, or Lightning address'
        : labelForDestinationKind(destination.kind);

    // Fiat preview numbers for the estimate box. `matchedRate` from
    // HomeScreen is USD-per-sat (it's pre-multiplied by btc(1) during store
    // hydration), so sats × rate = USD. Matches ArkHistoryRow.
    const netFiat = fee ? (fee.netAmountSats * matchedRate).toFixed(2) : null;
    const feeFiat = fee ? (fee.feeSats * matchedRate).toFixed(2) : null;
    const grossFiat = fee ? (fee.grossAmountSats * matchedRate).toFixed(2) : null;
    // Fee % is computed against the gross (total debited) so users see what
    // share of their outgoing funds the fee consumes. Toy amounts can spike
    // to >100% on Ark (server fee is ~flat) — capped display at 999% so the
    // line never breaks layout but still flags "this is a lot".
    const feePct =
        fee && fee.grossAmountSats > 0
            ? Math.min(999, (fee.feeSats / fee.grossAmountSats) * 100)
            : null;
    // The Bark SDK returns a single combined `feeSats`. There's no breakdown
    // of network (LN routing / on-chain miner) vs Ark server fee in the FFI,
    // so the most honest thing is to label what's bundled in based on the
    // destination kind. If the SDK ever exposes a breakdown, swap this for
    // two rows.
    const feeBreakdownLabel = fee
        ? destination.kind === 'ln-invoice' ||
          destination.kind === 'ln-offer' ||
          destination.kind === 'ln-address'
            ? 'Fee (Lightning routing + Ark)'
            : destination.kind === 'onchain'
                ? 'Fee (on-chain network + Ark)'
                : destination.kind === 'ark'
                    ? 'Fee (Ark server)'
                    : 'Fee'
        : 'Fee';

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Send from Ark">
            <ScrollView
                style={styles.main}
                contentContainerStyle={{ paddingBottom: 12 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* --- Amount display first per Bam (above destination so
                       the keyboard's primary affordance lines up with the
                       value the user is editing). CustomKeyboard owns the
                       underlying state; GradientInput just mirrors it.
                       Yellow `colors_` instead of the default pink. */}
                <GradientInput
                    isSats={isSats}
                    walletInfo={{ matchedRate, currency }}
                    sats={sats}
                    setSats={setSats}
                    usd={usd}
                    colors_={[colors.ark.extralight, colors.ark.main]}
                />

                {/* --- Destination (now below the amount). --- */}
                <Text bold style={styles.destLabel}>
                    Destination
                </Text>
                <View style={styles.destInputWrap}>
                    <TextInput
                        style={styles.destInput}
                        placeholder="bc1…, lnbc…, alice@host, ark1…"
                        placeholderTextColor="#666"
                        value={destinationRaw}
                        onChangeText={onChangeDestination}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        multiline
                    />
                    <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste}>
                        <Text style={styles.pasteBtnText}>PASTE</Text>
                    </TouchableOpacity>
                    {/* Scan button — sits flush with PASTE so users have
                        both clipboard and camera entry without leaving
                        the row. Whatever the camera reads goes through
                        the same `onChangeDestination` path, so the
                        kind-pill and validation behave identically to
                        a paste. */}
                    <TouchableOpacity style={styles.scanBtn} onPress={handleScan}>
                        <Text style={styles.scanBtnText}>SCAN</Text>
                    </TouchableOpacity>
                </View>
                <View style={[styles.kindPill, { borderColor: pillBorderColor }]}>
                    <Text style={[styles.kindPillText, { color: pillTextColor }]}>
                        {pillLabel}
                    </Text>
                </View>

                {/* --- Fee preview (only after estimate) --- */}
                {fee && (
                    <View style={styles.feePreviewBox}>
                        <View style={styles.feeRow}>
                            <Text style={styles.feeLabel}>You'll send</Text>
                            <Text style={styles.feeValue}>
                                {fee.netAmountSats.toLocaleString()} sats
                                {netFiat ? `  ·  ${getStrikeCurrency(currency)}${netFiat}` : ''}
                            </Text>
                        </View>
                        <View style={styles.feeRow}>
                            <Text style={styles.feeLabel}>{feeBreakdownLabel}</Text>
                            <Text style={styles.feeValue}>
                                {fee.feeSats.toLocaleString()} sats
                                {feeFiat ? `  ·  ${getStrikeCurrency(currency)}${feeFiat}` : ''}
                            </Text>
                        </View>
                        {feePct !== null && (
                            <View style={styles.feeRow}>
                                <Text style={styles.feeLabel}>Fee % of total</Text>
                                <Text style={styles.feeValue}>
                                    {feePct < 0.01
                                        ? '< 0.01%'
                                        : `${feePct.toFixed(feePct < 1 ? 2 : 1)}%`}
                                </Text>
                            </View>
                        )}
                        <View style={styles.feeRow}>
                            <Text style={styles.feeLabel}>Total debited</Text>
                            <Text style={styles.feeValue}>
                                {fee.grossAmountSats.toLocaleString()} sats
                                {grossFiat ? `  ·  ${getStrikeCurrency(currency)}${grossFiat}` : ''}
                            </Text>
                        </View>
                        {fee.vtxosSpent.length > 0 && (
                            <View style={styles.feeRow}>
                                <Text style={styles.feeLabel}>Capsules used</Text>
                                <Text style={styles.feeValue}>
                                    {fee.vtxosSpent.length}
                                </Text>
                            </View>
                        )}
                    </View>
                )}

                {/* --- Inline busy / error states ------------------------------ */}
                {(isEstimating || isSending) && (
                    <View style={{ alignItems: 'center', marginVertical: 8 }}>
                        <ActivityIndicator size="small" color={colors.ark.light} />
                        <Text style={{ color: colors.gray.light, fontSize: 12, marginTop: 4 }}>
                            {isEstimating ? 'Estimating fee…' : 'Sending…'}
                        </Text>
                    </View>
                )}

                {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

                {/* Proactive warning when the user enters an amount they
                    can't cover. The SDK returns an opaque BarkError.Internal
                    in this case; showing "0 sats spendable" up front is far
                    more actionable — usually it means a VTXO is stuck in
                    Locked (mid-round) and needs a recovery / wait, not that
                    the amount is wrong. */}
                {fee && !grossWithinBalance && (
                    <Text style={styles.error}>
                        Not enough balance to cover fees. Need {fee.grossAmountSats.toLocaleString()} sats total ({fee.feeSats.toLocaleString()} sats fee), but only {spendableSats.toLocaleString()} sats available. Try a smaller amount.
                    </Text>
                )}

                {amountValid && !amountWithinBalance && (
                    <Text style={styles.error}>
                        Insufficient spendable balance: {spendableSats.toLocaleString()} sats available.
                        {spendableSats === 0
                            ? ' Your only VTXOs may be Locked in a pending round — try again once the round finalises, or recover the wallet from the Capsules tab.'
                            : ''}
                    </Text>
                )}
            </ScrollView>

            {/* Shared sats/USD keyboard. Its primary button doubles as the
                estimate → confirm CTA for this flow (see keyboardTitle). */}
            <CustomKeyboard
                title={keyboardTitle}
                onPress={keyboardOnPress}
                disabled={keyboardDisabled}
                setSATS={handleSatsFromKeyboard}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                matchedRate={matchedRate}
                currency={currency}
                prevSats={sats}
                colors_={[colors.ark.extralight, colors.ark.main]}
            />
        </ScreenLayout>
    );
}
