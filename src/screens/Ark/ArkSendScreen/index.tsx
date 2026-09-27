import React, { useCallback, useEffect, useMemo, useState } from 'react';
import bolt11 from 'bolt11';
import {
    Clipboard,
    Keyboard,
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
import {
    classifyArkDestination,
    estimateArkSendFee,
    labelForDestinationKind,
    type ArkDestination,
} from '@Cypher/services/ark';
import { colors } from '@Cypher/style-guide';
import useAuthStore from '@Cypher/stores/authStore';
import LockedInRefreshNotice from '@Cypher/components/LockedInRefreshNotice';

/**
 * Decode the sat amount encoded in an amount-bearing BOLT11, or null if the
 * invoice is amount-less / unparseable. Used to auto-fill the send amount so
 * the user doesn't retype what the invoice already specifies.
 */
function decodeInvoiceSats(invoice: string): number | null {
    try {
        const decoded = bolt11.decode(invoice);
        if (decoded?.satoshis && decoded.satoshis > 0) return decoded.satoshis;
        if (decoded?.millisatoshis) {
            const msat = Number(decoded.millisatoshis);
            if (Number.isFinite(msat) && msat > 0) return Math.floor(msat / 1000);
        }
        return null;
    } catch {
        return null;
    }
}
// Repo-level helper (not under src/) — owns the iOS camera permission
// dance + the navigate-to-ScanQRCode callback contract used by every
// scan flow in the app (HotVault, ConnectColdStorage, …).
import { requestCameraAuthorization } from '../../../../helpers/scan-qr';

import styles from './styles';

/**
 * ArkSendScreen — destination + amount entry for the Ark wallet send flow.
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
 *   2. User enters an amount in sats via the shared CustomKeyboard (amount is
 *      auto-filled for an amount-encoded invoice).
 *   3. "Estimate fee" navigates to ArkSendReviewScreen, which constructs the
 *      transaction (fee estimate), lays out the full breakdown, and confirms
 *      with a single Send button.
 *   4. On success the review screen navigates to the shared
 *      `SendReceiveSuccessScreen` animation, so the Ark flow ends with the
 *      same UX as Strike/CoinOS.
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
    // Sats locked in an in-flight refresh round. Spendable again once the
    // round finalises or the user cancels it from the Capsules tab.
    const arkBalanceDetail = useAuthStore((s) => s.arkBalanceDetail);
    const pendingInRoundSats = Number(arkBalanceDetail?.pendingInRoundSats ?? 0);

    const [destinationRaw, setDestinationRaw] = useState<string>(
        route?.params?.initialDestination ?? '',
    );
    const [sats, setSats] = useState('');
    const [usd, setUSD] = useState('');
    const [isSats, setIsSats] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const destination: ArkDestination = useMemo(
        () => classifyArkDestination(destinationRaw),
        [destinationRaw],
    );

    // Auto-fill the amount for an amount-encoded Lightning invoice. The sats
    // are baked into the BOLT11, so the user shouldn't have to type them.
    // Amount-less invoices/offers leave the field to the user. Only overwrite
    // when the decoded value differs so we don't clobber the field on
    // unrelated re-renders.
    useEffect(() => {
        if (destination.kind !== 'ln-invoice') return;
        const decoded = decodeInvoiceSats(destination.value);
        if (decoded && decoded > 0) {
            const s = String(decoded);
            setSats((prev) => (prev === s ? prev : s));
            setIsSats(true);
        }
        // destination.value is stable per destinationRaw (memoized above).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [destination]);

    const onChangeDestination = useCallback((text: string) => {
        setDestinationRaw(text);
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
    // through setSATS.
    const handleSatsFromKeyboard = useCallback((next: string) => {
        setSats(next);
        if (errorMsg) setErrorMsg(null);
    }, [errorMsg]);

    const satsNumber = isSats ? Number(sats) : 0; // fee path uses sats only
    const destinationValid = destination.kind !== 'unknown';
    const amountValid = isSats && Number.isFinite(satsNumber) && satsNumber > 0;
    // Local pre-check: refuse to hand the SDK an amount we already know it
    // can't fund. The SDK would fail with `BarkError.Internal` and we'd have
    // no structured way to surface "0 sats available" to the user. The
    // review screen re-checks gross (amount + fee) once the fee is known.
    const amountWithinBalance = satsNumber <= spendableSats;
    const canProceed = destinationValid && amountValid && amountWithinBalance;

    // --- MAX reserve ----------------------------------------------------
    //
    // The keypad's MAX key fills the amount field, and the review screen then
    // refuses to send unless `amount + fee <= spendable`. Filling MAX with the
    // raw spendable balance therefore walks the user into a dead end: the fee
    // estimate resolves, and the Send button is disabled with no way forward
    // short of retyping a smaller number. MAX has to hand back the balance
    // MINUS a fee reserve.
    //
    // Same shape as SwapAmount's MAX reserve, including its seeding holdback.
    // Seeding the reserve at 0 there let MAX momentarily equal the full
    // balance while the estimate was still in flight, which failed the same
    // preflight. Seed at a safe holdback that only ever decreases to the real
    // reserve.
    //
    // Estimating at the FULL spendable balance is deliberate and conservative:
    // the Ark fee does not decrease with a larger amount, so the reserve taken
    // here is at least the fee that the slightly smaller MAX amount will
    // actually incur. Erring high leaves a few sats behind, erring low bounces
    // the send.
    const MAX_RESERVE_SEEDING_HOLDBACK = 500;
    const [maxFeeReserve, setMaxFeeReserve] = useState<number>(MAX_RESERVE_SEEDING_HOLDBACK);

    useEffect(() => {
        // No destination means no rail to quote against: Lightning, arkoor and
        // on-chain have different costs. Hold the seeded reserve until the
        // user gives us something to price.
        if (!destinationValid || spendableSats <= 0) {
            setMaxFeeReserve(MAX_RESERVE_SEEDING_HOLDBACK);
            return;
        }
        let cancelled = false;
        // Debounce: a pasted destination classifies in one go, but a typed one
        // can flip to valid on several successive keystrokes, and each estimate
        // is an ASP round trip.
        const timer = setTimeout(() => {
            (async () => {
                try {
                    const est = await estimateArkSendFee(destination, spendableSats);
                    if (!cancelled) {
                        setMaxFeeReserve(Math.max(0, Number(est?.feeSats || 0)));
                    }
                } catch {
                    // Best-effort. An unreachable ASP, a rate-limited esplora or
                    // an active exit all land here. Fall back to the holdback,
                    // never to 0, so a failed estimate cannot let MAX overshoot.
                    if (!cancelled) setMaxFeeReserve(MAX_RESERVE_SEEDING_HOLDBACK);
                }
            })();
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [destination, destinationValid, spendableSats]);

    // What MAX actually fills. Never negative: a balance below the reserve
    // means there is nothing sendable, and `handleMax` no-ops at 0.
    const maxSendableSats = Math.max(0, spendableSats - maxFeeReserve);

    /**
     * "Estimate fee" — hands off to the dedicated Review Payment screen,
     * which constructs the transaction (fee estimate), shows the full
     * breakdown (amount, fee, capsules used), and confirms with a single
     * Send button. All the fee / dust / execute logic lives there now so
     * the review step has its own screen instead of a cramped inline
     * preview + native alert.
     */
    const handleContinue = useCallback(() => {
        if (!canProceed) return;
        dispatchNavigate('ArkSendReviewScreen', {
            destinationRaw,
            amountSats: satsNumber,
            matchedRate,
            currency,
        });
    }, [canProceed, destinationRaw, satsNumber, matchedRate, currency]);

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
                       underlying state; GradientInput just mirrors it. --- */}
                <GradientInput
                    isSats={isSats}
                    walletInfo={{ matchedRate, currency }}
                    sats={sats}
                    setSats={setSats}
                    usd={usd}
                    colors_={[colors.ark.extralight, colors.ark.main]}
                />

                {/* --- Destination (below the amount). --- */}
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
                        // A destination is a single line, so the return key
                        // should dismiss the keyboard rather than insert a
                        // newline. `blurOnSubmit` overrides the multiline default
                        // (which keeps the keyboard up until you tap outside).
                        returnKeyType="done"
                        blurOnSubmit={true}
                        onSubmitEditing={() => Keyboard.dismiss()}
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

                {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

                {/* Proactive warning when the user enters an amount they
                    can't cover. The SDK returns an opaque BarkError.Internal
                    in this case; showing "0 sats spendable" up front is far
                    more actionable — usually it means a VTXO is stuck in
                    Locked (mid-round) and needs a recovery / wait, not that
                    the amount is wrong. */}
                {amountValid && !amountWithinBalance && (
                    pendingInRoundSats > 0 ? (
                        // Funds aren't missing, they're locked in a refresh.
                        // Point the user to Capsules to cancel it (see notice).
                        <LockedInRefreshNotice lockedSats={pendingInRoundSats} />
                    ) : (
                        <Text style={styles.error}>
                            Insufficient spendable balance: {spendableSats.toLocaleString()} sats available.
                        </Text>
                    )
                )}
            </ScrollView>

            {/* Shared sats/USD keyboard. Its primary button hands off to the
                Review Payment screen. */}
            <CustomKeyboard
                title="Estimate fee"
                onPress={handleContinue}
                disabled={!canProceed}
                setSATS={handleSatsFromKeyboard}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                matchedRate={matchedRate}
                currency={currency}
                prevSats={sats}
                colors_={[colors.ark.extralight, colors.ark.main]}
                titleColor={canProceed ? colors.black.default : colors.whiteText}
                maxBalance={maxSendableSats}
                // Nothing to fill means a dead key, which is the whole
                // complaint. Drop it and keep the grid slot empty.
                hideMax={maxSendableSats <= 0}
            />
        </ScreenLayout>
    );
}
