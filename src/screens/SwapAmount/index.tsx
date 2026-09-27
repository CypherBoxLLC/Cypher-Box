import React, { useEffect, useState } from "react";
import { View, Image, ActivityIndicator, TouchableOpacity, Animated, Easing, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ScreenLayout, Text } from "@Cypher/component-library";
import LinearGradient from "react-native-linear-gradient";
import { CustomKeyboard, GradientInput , LightningSendSuccess } from "@Cypher/components";
import { dispatchNavigate, dispatchReset } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import useAuthStore from "@Cypher/stores/authStore";
import LockedInRefreshNotice from "@Cypher/components/LockedInRefreshNotice";
import SimpleToast from "react-native-simple-toast";
import { StyleSheet } from "react-native";
import {
    swap as runSwap,
    estimateSwapFee,
    getLightningSwapProvider,
    LightningSwapError,
    InvoiceCreationFailedError,
    PaymentFailedError,
    PaymentPendingError,
    type LightningSwapProvider,
    type LightningSwapProviderId,
} from "@Cypher/services/lightningSwap";
// From the defining module rather than the ark barrel, matching the direct
// imports ArkCapsules already uses for constants the barrel has in-flight
// edits around. Same value either way; this just avoids the churn.
import { ARK_REFRESH_MIN_SATS } from "@Cypher/services/ark/config";
import { recordServerSpentFromError } from "@Cypher/services/ark/vtxos";
import { notSpendableMessage } from "@Cypher/services/ark/vtxoSpendState";
import { getFiatRate } from "../../../models/fiatUnit";

// Warning-yellow gradient for the small-amount "Swap anyways" CTA + dust note.
// A sub-700-sat swap into Bark can leave un-refreshable dust that expires.
// COPY: Bam finalizes.
const WARN_YELLOW = ['#FFD54F', '#FFB300'];
const SMALL_RECEIVE_SATS = 700;

export default function SwapAmount() {
    const navigation = useNavigation();
    const route = useRoute();
    const { swapFrom, sendTo, fromAddress, toAddress, sourceBalance = 0, prefillSats, maxSats, purpose } = route.params as {
        swapFrom: LightningSwapProviderId;
        sendTo: LightningSwapProviderId;
        fromAddress?: string;
        toAddress?: string;
        sourceBalance?: number;
        /**
         * Amount to open the screen with, in sats.
         *
         * Set by callers that already know the number, currently the dust
         * top-up: the user is not choosing an amount there, they are covering a
         * specific shortfall, and making them work it out is asking them to do
         * arithmetic the app already did. Still editable; it is a starting
         * value, not a lock.
         */
        prefillSats?: number;
        /**
         * Hard ceiling on the amount, in sats.
         *
         * Set by the dust "move them to CoinOS" option. That path exists to
         * clear dust, and editing the amount up would pull healthy capsules out
         * of the vault instead, which is the opposite of what the user came for
         * and defeats the point of the option.
         *
         * Enforced by clamping rather than by making the field read-only: the
         * user can still type, still reduce it, and sees the value snap back if
         * they overshoot. Locking the keyboard outright would leave them
         * poking at a dead input with no explanation.
         */
        maxSats?: number;
        /**
         * Why this screen was opened, when the answer changes what to say.
         *
         * Passed explicitly rather than inferred from `prefillSats` or from the
         * rail pair. Inference was the tempting shortcut and it is wrong twice
         * over: another caller prefilling an amount would silently inherit
         * dust copy, and `swapFrom`/`sendTo` cannot tell a deliberate 319-sat
         * top-up apart from a user typing 319 by hand, which is exactly the
         * case the small-amount warning exists to catch.
         *
         * 'dust-topup'  covering a shortfall so a dust batch clears the
         *               refresh floor. Small is the POINT here, so the generic
         *               small-amount warning is suppressed.
         * 'dust-exit'   taking dust off Ark entirely.
         */
        purpose?: 'dust-topup' | 'dust-exit';
    };
    const { matchedRateStrike, strikeUser } = useAuthStore();
    // Ark sats locked in an in-flight refresh. When the source is Ark and the
    // user can't cover the swap because funds are locked, point them to
    // Capsules to cancel the refresh (see LockedInRefreshNotice) rather than
    // letting the swap fail with an opaque insufficient-balance error.
    const arkBalanceDetail = useAuthStore((s) => s.arkBalanceDetail);
    const pendingInRoundSats = Number(arkBalanceDetail?.pendingInRoundSats ?? 0);
    // Currency and rate are rail-specific. Strike carries the user's
    // configured fiat currency (e.g. EUR) and a Strike-side rate in that
    // currency. Every other rail uses USD and BlueWallet's USD/BTC rate
    // (same source HomeScreen reads). Using Strike's rate as the default
    // for non-Strike rails was the prior bug — fiat preview stayed blank
    // whenever Strike wasn't linked.
    const currency = swapFrom === 'strike' ? (strikeUser?.[1]?.currency || 'USD') : 'USD';
    const [usdRate, setUsdRate] = useState(0);
    useEffect(() => {
        if (swapFrom === 'strike') return;
        let cancelled = false;
        (async () => {
            try {
                const r = (await getFiatRate('USD')) || 0;
                if (!cancelled) setUsdRate(r);
            } catch {}
        })();
        return () => { cancelled = true; };
    }, [swapFrom]);
    const matchedRate = swapFrom === 'strike' ? matchedRateStrike : usdRate;

    // Resolve provider metadata from the registry once. Fallbacks are
    // defensive — the navigation should never get here without valid
    // ids, but a stale deep-link param shouldn't crash the screen.
    let fromProvider: LightningSwapProvider | null = null;
    let toProvider: LightningSwapProvider | null = null;
    try { fromProvider = getLightningSwapProvider(swapFrom); } catch { fromProvider = null; }
    try { toProvider = getLightningSwapProvider(sendTo); } catch { toProvider = null; }

    const [sats, setSats] = useState('');
    const [usd, setUsd] = useState('');
    const [isSats, setIsSats] = useState(true);
    const [loading, setLoading] = useState(false);
    // "Taking longer than expected" hint. The swap can sit in the processing
    // spinner for the full confirmation window (up to ~120s) — most often
    // when Strike's Lightning payment is slow to route to the destination
    // (Strike→Bark especially). Surface a reassurance after 10s so the user
    // isn't staring at a bare spinner wondering if it hung.
    const [slowHint, setSlowHint] = useState(false);
    useEffect(() => {
        if (!loading) {
            setSlowHint(false);
            return;
        }
        const t = setTimeout(() => setSlowHint(true), 10000);
        return () => clearTimeout(t);
    }, [loading]);
    const [success, setSuccess] = useState(false);
    // Seed the amount from `prefillSats` exactly once. Not a controlled sync:
    // re-applying it would fight the user every time they edited the field.
    const prefillApplied = React.useRef(false);
    // Clamp to `maxSats` whenever the typed value goes over. Runs on the sats
    // field only: fiat entry is mirrored into it by CustomKeyboard, so this
    // catches both.
    React.useEffect(() => {
        if (!maxSats || !Number.isFinite(maxSats) || maxSats <= 0) return;
        const typed = Number(sats);
        if (Number.isFinite(typed) && typed > maxSats) {
            setSats(String(maxSats));
        }
    }, [sats, maxSats]);
    React.useEffect(() => {
        if (prefillApplied.current) return;
        if (!prefillSats || !Number.isFinite(prefillSats) || prefillSats <= 0) return;
        prefillApplied.current = true;
        setIsSats(true);
        setSats(String(Math.ceil(prefillSats)));
    }, [prefillSats]);
    const [swappedSats, setSwappedSats] = useState('');
    const [swappedFiat, setSwappedFiat] = useState('');
    const [feeSats, setFeeSats] = useState<number | null>(null);
    const [feeNote, setFeeNote] = useState<string | null>(null);
    /**
     * Headroom reserved off the Max button so Ark (which charges a
     * routing fee on top of `amountSats`, not deducted from it) doesn't
     * fail with "BarkError.Internal" when the user taps Max. We seed
     * this once on mount with a trial estimate at the full sourceBalance
     * — providers that don't quote ahead of time return null and we
     * default to 0 (no reserve, same as before for Coinos/Strike).
     */
    // Conservative headroom held back on the Max button UNTIL the provider's
    // precise reserve finishes seeding (in the effect below). That seed is
    // async: it hits the ASP, and on Ark a chain-tip fetch that can stall for
    // seconds while esplora is rate-limited (429). Seeding this at 0 let Max
    // momentarily equal the full spendable balance, which then fails the send
    // preflight ("amount + routing fee > spendable"). Seeding it at a safe
    // holdback that only ever DECREASES to the real reserve closes that race.
    const MAX_RESERVE_SEEDING_HOLDBACK = 500;
    const [maxFeeReserve, setMaxFeeReserve] = useState<number>(MAX_RESERVE_SEEDING_HOLDBACK);

    // One-shot Max-button reserve at mount. Two-stage lookup:
    //   1. Provider's `maxFeeReserve` — explicit headroom buffer (Coinos
    //      uses this; the buffer isn't accurate enough to display as a
    //      fee but is a safe Max ceiling).
    //   2. Provider's `estimateFee` — only if `maxFeeReserve` isn't
    //      implemented. Ark gets here and reuses its precise quote as
    //      both display value and Max reserve.
    // Falls back to 0 (full balance is allowed) when neither exists —
    // current behavior for Strike.
    useEffect(() => {
        if (!swapFrom || !sourceBalance) return;
        let cancelled = false;
        (async () => {
            try {
                const provider = fromProvider;
                let reserve = 0;
                if (provider?.maxFeeReserve) {
                    reserve = Number(await provider.maxFeeReserve(Number(sourceBalance))) || 0;
                } else {
                    const est = await estimateSwapFee(swapFrom, Number(sourceBalance));
                    reserve = est ? Math.max(0, Number(est.feeSats || 0)) : 0;
                }
                if (!cancelled) setMaxFeeReserve(Math.max(0, reserve));
            } catch {
                // Reserve is best-effort. Fall back to the safe holdback (NOT
                // 0/full balance) so a failed seed can't let Max overshoot the
                // "amount + fee ≤ spendable" preflight either.
                if (!cancelled) setMaxFeeReserve(MAX_RESERVE_SEEDING_HOLDBACK);
            }
        })();
        return () => { cancelled = true; };
    }, [swapFrom, sourceBalance, fromProvider]);

    // Fee preview — only providers that quote ahead of time (Ark)
    // populate this. Custodial sources (Coinos, Strike) leave it null
    // and the success view falls back to "—". Debounce-by-cancellation
    // pattern: keep the latest amount's request, drop earlier ones.
    useEffect(() => {
        const amount = Number(sats);
        if (!swapFrom || !amount || amount <= 0) {
            setFeeSats(null);
            setFeeNote(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const est = await estimateSwapFee(swapFrom, amount);
                if (cancelled) return;
                if (est) {
                    setFeeSats(est.feeSats);
                    setFeeNote(est.note ?? null);
                } else {
                    setFeeSats(null);
                    setFeeNote(null);
                }
            } catch {
                if (!cancelled) {
                    setFeeSats(null);
                    setFeeNote(null);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [sats, swapFrom]);

    const handleSwap = async () => {
        const amount = Number(sats);
        if (!amount || amount <= 0) {
            SimpleToast.show('Please enter an amount', SimpleToast.SHORT);
            return;
        }

        // Resolve sats vs fiat from the keyboard's input mode. Display
        // values for the success screen come from these.
        const satsAmount = isSats ? amount : Number(usd);
        const fiatAmount = isSats ? Number(usd) : amount;

        setLoading(true);
        try {
            const result = await runSwap(swapFrom, sendTo, satsAmount, {
                memo: `Swap ${swapFrom} → ${sendTo}`,
            });
            // Engine returns the source provider's fee if surfaced
            // (Ark does, others don't). Override our preview with the
            // realised fee so the success view is accurate even when
            // the pre-swap estimate was a placeholder.
            if (typeof result.feeSats === 'number') {
                setFeeSats(result.feeSats);
            }
            setSwappedSats(String(satsAmount));
            setSwappedFiat(String(fiatAmount));
            setSuccess(true);
        } catch (error) {
            console.error('Swap error:', error);

            // PENDING is NOT a failure and must NOT invite a retry — a
            // retry re-reserves the source balance for a payment that may
            // still settle. Surface it as a blocking modal (not a toast)
            // so the user actually reads "do not retry, check the source
            // wallet" before tapping anything. See the 2026-05-31 incident
            // where retrying a PENDING Strike swap reserved it three times.
            if (error instanceof PaymentPendingError) {
                // Clear the "Processing swap..." view first so the screen
                // isn't visibly stuck behind the alert while React flushes
                // — under a busy JS thread that flush was landing seconds
                // after the alert appeared, reading as a spinner hang.
                setLoading(false);
                Alert.alert(
                    'Payment submitted, not yet confirmed',
                    error.message,
                    [
                        {
                            text: 'OK, I will check',
                            style: 'default',
                            // Close the swap flow entirely once the user
                            // acknowledges. Staying on SwapAmount with a
                            // stale amount pre-filled invites the retry
                            // this alert exists to prevent. Home shows
                            // the real balance state; if the destination
                            // eventually settles, the balance updates
                            // there naturally.
                            onPress: () => dispatchReset('HomeScreen'),
                        },
                    ],
                    { cancelable: false },
                );
                return;
            }

            // Tailored toast per failure stage so the user knows whether
            // the destination's invoice or the source's payment failed.
            const fallback = 'Swap failed. Please try again.';
            let message = fallback;
            if (error instanceof InvoiceCreationFailedError) {
                message = `${toProvider?.displayName ?? sendTo} couldn't create an invoice: ${(error.cause as Error)?.message ?? error.message}`;
            } else if (error instanceof PaymentFailedError) {
                // The Ark server is the only authority on whether a VTXO is
                // still spendable, and it only tells us when a spend fails, so
                // this catch is the one moment the correction is available.
                //
                // This used to match "unregistered" alone. A VTXO the server
                // reports as `spent` fell straight through and the raw gRPC
                // string was rendered to the user, while the phantom balance
                // survived every subsequent sync. See services/ark/vtxoSpendState.
                const notSpendable = await recordServerSpentFromError(error);
                if (notSpendable) {
                    const { title, body } = notSpendableMessage(notSpendable);
                    Alert.alert(title, body, [{ text: 'OK', style: 'default' }], { cancelable: true });
                    setLoading(false);
                    return;
                }
                // The Ark preflight's insufficient-balance message carries the
                // exact actionable numbers ("need X, only Y spendable, try
                // swapping Z"). A 2-second toast flashes it away before anyone
                // can read it; show it as a blocking alert instead.
                if (typeof cause?.message === 'string' && cause.message.startsWith('Not enough Ark balance')) {
                    Alert.alert(
                        'Not enough balance',
                        cause.message,
                        [{ text: 'OK', style: 'default' }],
                        { cancelable: true },
                    );
                    setLoading(false);
                    return;
                }
                message = `${fromProvider?.displayName ?? swapFrom} payment failed, ${cause?.message ?? error.message}`;
            } else if (error instanceof LightningSwapError) {
                message = error.message;
            } else if (error instanceof Error) {
                message = error.message || fallback;
            }
            SimpleToast.show(message, SimpleToast.SHORT);
        } finally {
            setLoading(false);
        }
    };

    // Expanding ring animations

    /**
     * Render a wallet badge in the from→to direction strip. Uses the
     * provider's icon when available, falls back to the displayName as
     * text — matches SwapSheet's tile fallback so Ark (no logo) doesn't
     * render a broken Image.
     */
    const renderProviderBadge = (
        provider: LightningSwapProvider | null,
        fallbackId: LightningSwapProviderId,
        styleVariant: 'inline' | 'success',
    ) => {
        const boxStyle = styleVariant === 'success' ? styles.successServiceBox : styles.serviceBox;
        const logoStyle = styleVariant === 'success' ? styles.successLogo : styles.logo;
        const labelStyle = styleVariant === 'success' ? styles.successTextBadge : styles.textBadge;
        return (
            <View style={boxStyle}>
                {provider?.icon ? (
                    <Image source={provider.icon} style={logoStyle} />
                ) : (
                    <Text bold style={labelStyle}>{provider?.displayName ?? fallbackId}</Text>
                )}
            </View>
        );
    };

    if (success) {
        return (
            <ScreenLayout showToolbar isBackButton={false}>
                <LightningSendSuccess
                    title="Swap Sent ⚡"
                    sats={swappedSats}
                    fiat={swappedFiat}
                    fiatSymbol={currency === 'EUR' ? '€' : '$'}
                    feeSats={feeSats}
                    feeNote={feeNote}
                    // A swap's destination is another of the user's own
                    // wallets, so an address would be meaningless here. Keep
                    // the from/to badges, which say the true thing.
                    detail={
                        <View style={styles.successDirection}>
                            {renderProviderBadge(fromProvider, swapFrom, 'success')}
                            <Text style={styles.successArrow}>→</Text>
                            {renderProviderBadge(toProvider, sendTo, 'success')}
                        </View>
                    }
                    onHome={() => navigation.popToTop()}
                />
            </ScreenLayout>
        );
    }

    // Small-amount warning for a swap INTO Bark: a sub-700-sat receive can
    // leave un-refreshable dust that expires. Sats mode types the sat amount;
    // fiat mode mirrors the sat equivalent into `usd`.
    const currentSats = Math.round(isSats ? Number(sats) : Number(usd)) || 0;
    // Strictly below, matching ArkInvoiceScreen. 700 is the number the warning
    // asks the user to reach, so warning at exactly 700 contradicted its own
    // advice.
    //
    // Suppressed entirely for the dust top-up. That flow computes the amount
    // itself, caps it under the refresh floor, and sent the user here
    // precisely to deposit a small sum. Warning them off it would contradict
    // the dialog that opened this screen, and the CTA it drives ("Swap
    // anyways") frames the intended action as a mistake being overridden.
    const isDustTopup = purpose === 'dust-topup';
    const smallBarkSwapWarn =
        !isDustTopup && sendTo === 'ark' && currentSats > 0 && currentSats < SMALL_RECEIVE_SATS;

    return (
        <ScreenLayout
            disableScroll
            showToolbar
            isBackButton
            title={
                isDustTopup ? 'Dust Top-up' : purpose === 'dust-exit' ? 'Move Dust Out' : 'Lightning Swap'
            }
        >
            <View style={styles.main}>
                <GradientInput isSats={isSats} walletInfo={{ matchedRate, currency }} sats={sats} setSats={setSats} usd={usd} />
                {swapFrom === 'ark' && pendingInRoundSats > 0 && (sourceBalance === 0 || (Number(sats) || 0) > sourceBalance) && (
                    <LockedInRefreshNotice lockedSats={pendingInRoundSats} />
                )}
                <View style={styles.directionRow}>
                    {renderProviderBadge(fromProvider, swapFrom, 'inline')}
                    <Text style={styles.arrow}>→</Text>
                    {renderProviderBadge(toProvider, sendTo, 'inline')}
                </View>
                {feeSats !== null && feeSats > 0 && (() => {
                    // Pre-swap fee preview. Shown when the source rail's
                    // estimateFee() returned a value (Ark via the Bark SDK).
                    // Custodial sources skip this row entirely so the layout
                    // doesn't reserve empty space.
                    // Fee % of total debited (sats + feeSats) — matches the
                    // ArkSendScreen Fee % row so the user gets the same
                    // signal across regular send and swap surfaces. Capped
                    // at 999% so tiny-amount swaps don't break layout.
                    const amountSats = Number(sats) || 0;
                    const gross = amountSats + feeSats;
                    const feePct = gross > 0 ? Math.min(999, (feeSats / gross) * 100) : null;
                    const pctStr = feePct === null
                        ? ''
                        : feePct < 0.01
                            ? ' (< 0.01%)'
                            : ` (${feePct.toFixed(feePct < 1 ? 2 : 1)}%)`;
                    return (
                        <Text style={styles.feePreview}>
                            Estimated network fee: {feeSats} sats{pctStr}{feeNote ? ` · ${feeNote}` : ''}
                        </Text>
                    );
                })()}
                {smallBarkSwapWarn && (
                    <Text style={{ textAlign: 'center', marginTop: 8, marginHorizontal: 8, fontSize: 12, color: '#FFD54F', lineHeight: 17 }}>
                        Small amounts can leave un-refreshable dust that expires. Swapping 700 sats or more keeps them refreshable.
                    </Text>
                )}
                {/* Replaces the warning above rather than sitting alongside it.
                    The screen otherwise gives no reason for the odd prefilled
                    number, and the ceiling is worth stating because the field
                    is editable and overshooting it silently defeats the sweep
                    the user is here to enable.
                    COPY: Bam finalizes. */}
                {isDustTopup && (
                    <Text style={{ textAlign: 'center', marginTop: 8, marginHorizontal: 8, fontSize: 12, color: '#ddd', lineHeight: 17 }}>
                        This is meant to be small. It has to stay under {ARK_REFRESH_MIN_SATS} sats to combine with
                        the dust you already have.
                    </Text>
                )}
            </View>
            {loading ? (
                <View style={styles.loadingView}>
                    <ActivityIndicator size="large" color={colors.pink.default} />
                    <Text style={styles.loadingText}>Processing swap...</Text>
                    {slowHint && (
                        <>
                            <Text style={{ color: colors.gray.light, fontSize: 13, marginTop: 10, textAlign: 'center', marginHorizontal: 20 }}>
                                It's taking longer than expected...
                            </Text>
                            {/* Slow swaps almost always LAND, minutes late (the
                                LN path to the Ark server settles slowly; verified
                                repeatedly on device). Don't trap the user staring
                                at a spinner: say the swap keeps going and offer
                                Home. The claim/movement watchers pick the result
                                up in the background and the balance updates. */}
                            <Text style={{ color: colors.gray.light, fontSize: 13, marginTop: 6, textAlign: 'center', marginHorizontal: 20 }}>
                                The swap will keep confirming in the background. It's safe to go Home, your balance will update when it lands.
                            </Text>
                            <TouchableOpacity onPress={() => dispatchReset('HomeScreen')} style={styles.homeButton}>
                                <LinearGradient
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 0 }}
                                    colors={[colors.pink.extralight, colors.pink.default]}
                                    style={styles.homeButtonGradient}
                                >
                                    <Text bold style={styles.homeText}>Home</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            ) : (
                <CustomKeyboard
                    title={smallBarkSwapWarn ? "Swap anyways" : "Swap"}
                    prevSats={sats}
                    onPress={handleSwap}
                    setSATS={setSats}
                    setUSD={setUsd}
                    setIsSATS={setIsSats}
                    disabled={!sats || Number(sats) <= 0 || loading}
                    matchedRate={matchedRate}
                    currency={currency}
                    colors_={[colors.pink.extralight, colors.pink.default]}
                    buttonColors_={smallBarkSwapWarn ? WARN_YELLOW : undefined}
                    // Effective max = balance minus reserved fee headroom.
                    // Coinos/Strike keep the full balance (their estimate
                    // returns null → reserve=0). Ark deducts the routing
                    // fee so the keyboard's Max button stays within the
                    // SDK's "amount + fee ≤ spendable" constraint.
                    maxBalance={Math.max(0, Number(sourceBalance) - maxFeeReserve)}
                />
            )}
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    main: {
        flex: 1,
    },
    directionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 60,
    },
    serviceBox: {
        backgroundColor: '#2A2A2A',
        borderRadius: 12,
        paddingHorizontal: 20,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logo: {
        height: 24,
        width: 90,
        resizeMode: 'contain',
    },
    textBadge: {
        // Same vertical region as the logo so icon and text providers
        // sit at identical heights in the directionRow.
        height: 24,
        lineHeight: 24,
        fontSize: 16,
        color: '#FFFFFF',
        textAlign: 'center',
        minWidth: 60,
    },
    feePreview: {
        marginTop: 18,
        textAlign: 'center',
        color: '#AAAAAA',
        fontSize: 13,
    },
    arrow: {
        fontSize: 24,
        marginHorizontal: 16,
        color: '#FFFFFF',
    },
    loadingView: {
        paddingVertical: 40,
        alignItems: 'center',
        justifyContent: 'center',
        // Lift the processing block so the slow-case message + Home button
        // below it stay clear of the keyboard area / fold.
        marginTop: -50,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: '#FFFFFF',
    },
    successContainer: {
        flex: 1,
        alignItems: 'center',
        marginHorizontal: 20,
    },
    successTitle: {
        fontSize: 40,
        lineHeight: 50,
        marginBottom: 30,
    },
    successValue: {
        fontSize: 42,
        lineHeight: 52,
    },
    successFiat: {
        fontSize: 30,
        lineHeight: 40,
        color: '#AAAAAA',
    },
    animationContainer: {
        width: 200,
        height: 200,
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 20,
    },
    ring: {
        position: 'absolute',
        width: 150,
        height: 150,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ringImage: {
        width: 150,
        height: 150,
    },
    boltImage: {
        width: 80,
        height: 85,
        zIndex: 10,
    },
    successDirection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 20,
    },
    successServiceBox: {
        backgroundColor: '#2A2A2A',
        borderRadius: 12,
        paddingHorizontal: 24,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    successLogo: {
        height: 30,
        width: 110,
        resizeMode: 'contain',
    },
    successTextBadge: {
        height: 30,
        lineHeight: 30,
        fontSize: 18,
        color: '#FFFFFF',
        textAlign: 'center',
        minWidth: 80,
    },
    successFee: {
        marginTop: 6,
        fontSize: 14,
        color: '#AAAAAA',
        textAlign: 'center',
    },
    successArrow: {
        fontSize: 28,
        marginHorizontal: 20,
        color: '#FFFFFF',
    },
    successNetwork: {
        fontSize: 22,
        lineHeight: 30,
        color: '#AAAAAA',
    },
    homeButton: {
        marginTop: 40,
        width: '80%',
    },
    homeButtonGradient: {
        borderRadius: 25,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    homeText: {
        fontSize: 18,
        color: '#FFFFFF',
    },
});
