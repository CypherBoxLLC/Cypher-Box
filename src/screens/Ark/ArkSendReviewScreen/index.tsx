import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';

import { ScreenLayout, Text } from '@Cypher/component-library';
import { GradientButton } from '@Cypher/components';
import { dispatchNavigate } from '@Cypher/helpers';
import { getStrikeCurrency } from '@Cypher/helpers/coinosHelper';
import { btc } from '@Cypher/helpers/bitcoinUnits';
import {
    ARK_VTXO_DUST_SATS,
    classifyArkDestination,
    estimateArkSendFee,
    executeArkSend,
    labelForDestinationKind,
    type ArkDestination,
    type ArkSendFeeView,
} from '@Cypher/services/ark';
import { colors } from '@Cypher/style-guide';
import useAuthStore from '@Cypher/stores/authStore';

import TextViewV2 from '../../Invoice/TextView';
import reviewStyles from '../../ReviewPayment/styles';

/**
 * ArkSendReviewScreen — the dedicated "Review Payment" step for the Ark
 * Lightning / Ark / on-chain send flow.
 *
 * Replaces the old inline-preview + native `Alert` confirmation that lived
 * on ArkSendScreen. The user enters destination + amount there, taps
 * "Estimate fee", and lands here where the constructed transaction is laid
 * out in full (amount, fee, fee %, capsules used, destination) and confirmed
 * with a single tappable Send button — no slide-to-send.
 *
 * Mirrors ArkWithdrawReviewScreen: the fee is (re)estimated on this screen
 * via `estimateArkSendFee`, so the number shown is the one that will be
 * charged a moment later by `executeArkSend`. Estimating is a dry run; no
 * funds move until Send.
 *
 * Route params (from ArkSendScreen):
 *   destinationRaw: raw destination string (re-classified here)
 *   amountSats:     net sats to send (from the amount entry / invoice)
 *   matchedRate:    USD-per-BTC (sats * rate * 1e-8 = USD)
 *   currency:       fiat currency code
 */

interface Props {
    route: {
        params?: {
            destinationRaw?: string;
            amountSats?: number;
            matchedRate?: number | string;
            currency?: string;
        };
    };
}

export default function ArkSendReviewScreen({ route }: Props) {
    const destinationRaw = String(route?.params?.destinationRaw ?? '');
    const matchedRate = Number(route?.params?.matchedRate ?? 0);
    const currency = route?.params?.currency ?? 'USD';

    // Kept fresh by the 30s useArkSync tick; used to pre-empt the SDK's
    // opaque BarkError.Internal with a clear "not enough balance" message.
    const arkBalance = useAuthStore((s) => s.arkBalance);
    const spendableSats = Number(arkBalance ?? 0);

    const [amountSats, setAmountSats] = useState<number>(
        Number(route?.params?.amountSats ?? 0),
    );
    const [fee, setFee] = useState<ArkSendFeeView | null>(null);
    const [isEstimating, setIsEstimating] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // "Taking longer than expected" hint during a send. executeArkSend can
    // sit for minutes when the ASP / esplora is slow or a round is contending
    // for the inputs. We deliberately do NOT time the send out — it may still
    // land server-side, and claiming a money movement failed early is worse
    // than a long spinner. We just reassure after 10s so the bare "Sending…"
    // spinner doesn't read as a frozen app.
    const [slowSend, setSlowSend] = useState(false);
    useEffect(() => {
        if (!isSending) {
            setSlowSend(false);
            return;
        }
        const t = setTimeout(() => setSlowSend(true), 10000);
        return () => clearTimeout(t);
    }, [isSending]);

    const destination: ArkDestination = useMemo(
        () => classifyArkDestination(destinationRaw),
        [destinationRaw],
    );
    const destinationValid = destination.kind !== 'unknown';

    // Estimate on mount and whenever the amount changes (the dust-fix
    // "Send all" button rewrites amountSats). Same dry-run call the entry
    // screen used; no funds move here.
    useEffect(() => {
        let cancelled = false;
        if (!destinationValid || amountSats <= 0) {
            setFee(null);
            setIsEstimating(false);
            return;
        }
        setIsEstimating(true);
        setErrorMsg(null);
        (async () => {
            try {
                const estimate = await estimateArkSendFee(destination, amountSats);
                if (!cancelled) setFee(estimate);
            } catch (err: any) {
                if (cancelled) return;
                setFee(null);
                setErrorMsg(
                    `Fee estimate failed: ${err?.message ?? 'unknown error'}`,
                );
            } finally {
                if (!cancelled) setIsEstimating(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // destination.value is stable per destinationRaw (memoized above).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [destination.kind, destination.value, amountSats, destinationValid]);

    // Gross (amount + fee) must fit the wallet, else the SDK fails opaquely.
    const grossWithinBalance = fee
        ? fee.grossAmountSats <= spendableSats
        : amountSats <= spendableSats;

    // Dust-change guard (carried over from the entry screen): if the send
    // leaves a sub-dust capsule as change, warn and offer a one-tap send-all.
    const changeIfSent = fee ? spendableSats - fee.grossAmountSats : null;
    const wouldStrandDust =
        changeIfSent !== null &&
        changeIfSent > 0 &&
        changeIfSent < ARK_VTXO_DUST_SATS;
    const sendAllAmount =
        fee && wouldStrandDust ? spendableSats - fee.feeSats : null;

    const handleSendAll = useCallback(() => {
        if (sendAllAmount === null || sendAllAmount <= 0) return;
        setFee(null);
        setErrorMsg(null);
        setAmountSats(sendAllAmount); // triggers re-estimate via the effect
    }, [sendAllAmount]);

    const canSend =
        destinationValid && !!fee && grossWithinBalance && !isEstimating && !isSending;

    const runSend = useCallback(async () => {
        if (!canSend || !fee) return;
        setIsSending(true);
        setErrorMsg(null);
        try {
            const result = await executeArkSend(destination, amountSats);
            const netSats = result.netAmountSats;
            const fiat = (netSats * matchedRate * btc(1)).toFixed(2);
            dispatchNavigate('ArkSendSuccessScreen', {
                value: String(netSats),
                valueUsd: fiat,
                currency,
            });
        } catch (err: any) {
            console.error('[ArkSendReview] send failed:', err);
            setErrorMsg(
                `Send failed: ${err?.message ?? 'unknown error'}. Your funds were not moved.`,
            );
        } finally {
            setIsSending(false);
        }
    }, [canSend, fee, destination, amountSats, matchedRate]);

    // --- Fiat + fee display -------------------------------------------------
    const amountFiat = (amountSats * matchedRate * btc(1)).toFixed(2);
    const feeFiat = fee ? (fee.feeSats * matchedRate * btc(1)).toFixed(2) : null;
    const grossFiat = fee
        ? (fee.grossAmountSats * matchedRate * btc(1)).toFixed(2)
        : null;
    const feePct =
        fee && fee.grossAmountSats > 0
            ? Math.min(999, (fee.feeSats / fee.grossAmountSats) * 100)
            : null;
    // The SDK returns one combined fee; label what's bundled by rail.
    const feeBreakdownLabel =
        destination.kind === 'ln-invoice' ||
        destination.kind === 'ln-offer' ||
        destination.kind === 'ln-address'
            ? 'Fee (Lightning routing + Ark)'
            : destination.kind === 'onchain'
                ? 'Fee (on-chain network + Ark)'
                : destination.kind === 'ark'
                    ? 'Fee (Ark server)'
                    : 'Fee';

    const cur = getStrikeCurrency(currency);

    return (
        <ScreenLayout showToolbar isBackButton title="Review Payment">
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={reviewStyles.topView}>
                    <View style={reviewStyles.middle}>
                        {/* Amount to recipient */}
                        <TextViewV2
                            keytext="You'll send: "
                            text={`${amountSats.toLocaleString()} sats ~ ${cur}${amountFiat}`}
                            textStyle={reviewStyles.price}
                        />

                        <TextViewV2 keytext="Sent from: " text="Bark Vault" />

                        {/* Destination */}
                        <View style={{ marginStart: 15, marginEnd: 10, marginBottom: 24 }}>
                            <Text bold style={{ fontSize: 18 }}>
                                {'To: '}
                            </Text>
                            <Text style={{ color: colors.ark.light, fontSize: 13, marginTop: 4 }}>
                                {labelForDestinationKind(destination.kind)}
                            </Text>
                            <View
                                style={{
                                    marginTop: 8,
                                    paddingVertical: 8,
                                    paddingHorizontal: 16,
                                    borderWidth: 2,
                                    borderColor: colors.ark.light,
                                    borderRadius: 15,
                                    width: '92%',
                                }}
                            >
                                <Text
                                    italic
                                    style={{
                                        fontSize: 12,
                                        fontFamily: 'monospace',
                                        color: colors.ark.light,
                                    }}
                                >
                                    {destinationRaw}
                                </Text>
                            </View>
                            {!destinationValid && (
                                <Text style={{ color: '#FF7A68', fontSize: 12, marginTop: 6 }}>
                                    Destination is not a recognised address or invoice.
                                </Text>
                            )}
                        </View>

                        {/* Fee block */}
                        {isEstimating ? (
                            <View
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    marginStart: 25,
                                    marginTop: 4,
                                }}
                            >
                                <ActivityIndicator size="small" color={colors.ark.light} />
                                <Text
                                    style={{ color: colors.gray.light, marginLeft: 8, fontSize: 13 }}
                                >
                                    Estimating fee…
                                </Text>
                            </View>
                        ) : fee ? (
                            <>
                                <TextViewV2
                                    keytext={`${feeBreakdownLabel}: `}
                                    text={`${fee.feeSats.toLocaleString()} sats ~ ${cur}${feeFiat}${
                                        feePct !== null
                                            ? ` (${
                                                  feePct < 0.01
                                                      ? '<0.01'
                                                      : feePct.toFixed(feePct < 1 ? 2 : 1)
                                              }%)`
                                            : ''
                                    }`}
                                />
                                <TextViewV2
                                    keytext="Total debited: "
                                    text={`${fee.grossAmountSats.toLocaleString()} sats ~ ${cur}${grossFiat}`}
                                />
                                {fee.vtxosSpent.length > 0 && (
                                    <TextViewV2
                                        keytext="Capsules used: "
                                        text={`${fee.vtxosSpent.length}`}
                                    />
                                )}
                            </>
                        ) : null}
                    </View>
                </View>

                {/* Error / balance / dust states */}
                {errorMsg && (
                    <Text
                        style={{
                            color: '#FF7A68',
                            fontSize: 13,
                            marginHorizontal: 25,
                            marginTop: 8,
                        }}
                    >
                        {errorMsg}
                    </Text>
                )}

                {fee && !grossWithinBalance && (
                    <Text
                        style={{
                            color: '#FF7A68',
                            fontSize: 13,
                            marginHorizontal: 25,
                            marginTop: 8,
                        }}
                    >
                        Not enough balance to cover fees. Need{' '}
                        {fee.grossAmountSats.toLocaleString()} sats total (
                        {fee.feeSats.toLocaleString()} sats fee), but only{' '}
                        {spendableSats.toLocaleString()} sats available.
                    </Text>
                )}

                {wouldStrandDust && fee && sendAllAmount !== null && sendAllAmount > 0 && (
                    <View style={{ marginHorizontal: 25, marginTop: 10 }}>
                        <Text style={{ color: '#FF7A68', fontSize: 13, lineHeight: 18 }}>
                            This send leaves {changeIfSent} sats of change as a sub-dust
                            capsule (below the {ARK_VTXO_DUST_SATS}-sat limit). To keep it
                            spendable, use Send all, or consolidate it later from the
                            Capsules tab. Otherwise it expires and the ASP sweeps it.
                        </Text>
                        <TouchableOpacity
                            onPress={handleSendAll}
                            activeOpacity={0.7}
                            style={{
                                marginTop: 8,
                                paddingVertical: 10,
                                paddingHorizontal: 14,
                                borderRadius: 8,
                                borderWidth: 1,
                                borderColor: colors.ark.light,
                                alignItems: 'center',
                            }}
                        >
                            <Text bold style={{ color: colors.ark.light, fontSize: 13 }}>
                                Send all {sendAllAmount.toLocaleString()} sats instead (
                                {fee.feeSats} sat fee)
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>

            {/* Caution + Send. Plain tappable Send button (no slide). The Ark
                theme gradient is white, so the label is forced black for
                contrast. */}
            <Text
                style={{
                    color: colors.white,
                    fontSize: 15,
                    textAlign: 'center',
                    marginBottom: 10,
                    marginHorizontal: 30,
                }}
            >
                <Text style={{ color: colors.white, fontSize: 15, fontWeight: 'bold' }}>
                    Caution:
                </Text>{' '}
                Bitcoin transactions are irreversible
            </Text>
            {isSending && slowSend && (
                <Text
                    style={{
                        color: colors.gray.light,
                        fontSize: 13,
                        textAlign: 'center',
                        marginBottom: 10,
                        marginHorizontal: 30,
                    }}
                >
                    It's taking longer than expected...
                </Text>
            )}
            <View style={reviewStyles.container}>
                <GradientButton
                    style={reviewStyles.invoiceButton}
                    title={isSending ? 'Sending…' : 'Send'}
                    disabled={!canSend}
                    onPress={runSend}
                    colors_={[colors.ark.gradient1, colors.ark.gradient2]}
                    textStyle={{ color: canSend ? colors.black.default : colors.whiteText }}
                />
            </View>
        </ScreenLayout>
    );
}
