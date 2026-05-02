import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Linking,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { CommonActions, useNavigation } from '@react-navigation/native';
import SimpleToast from 'react-native-simple-toast';

import { Input, ScreenLayout, Text } from '@Cypher/component-library';
import { Check, Edit } from '@Cypher/assets/images';
import { GradientCard, SwipeButton } from '@Cypher/components';
import { colors } from '@Cypher/style-guide';
import { isIOS } from '@Cypher/helpers';
import { formatNumber, getStrikeCurrency } from '@Cypher/helpers/coinosHelper';
import {
    classifyArkDestination,
    estimateArkSendFee,
    executeArkSend,
    type ArkDestination,
    type ArkSendFeeView,
} from '@Cypher/services/ark/send';
import { fetchArkBalance } from '@Cypher/services/ark/balance';

import TextViewV2 from '../../Invoice/TextView';
import reviewStyles from '../../ReviewPayment/styles';

/**
 * ArkWithdrawReviewScreen — Phase 3.
 *
 * Visual parity with Strike's `ReviewPayment` (`isWithdrawal && vaultTab`
 * branch): same `topView` / `middle` layout, same `TextViewV2` rows for
 * "You will withdraw / Sent from / To", same address card with QR + Edit
 * icons inside a colored bordered touchable, same yellow ⚠️ + checkbox
 * verification block for cold vaults, same `Input` inside `GradientCard`
 * for the note, same caution caption, same `SwipeButton` CTA at the bottom.
 *
 * What's different: the source rail is non-custodial Ark, so we drive
 * the fee + send through `estimateArkSendFee` / `executeArkSend` instead
 * of Strike's onChainTiers + Coinos APIs. The destination is always a
 * Bitcoin address (a hot or cold vault), classified internally as
 * `'onchain'`.
 *
 * Route params (passed from `HomeScreen/WithdrawList/onNext`):
 *   destinationKind:    'hot' | 'cold'
 *   destinationAddress: Bitcoin address string
 *   prefillSats:        threshold-aware default amount
 *   arkBalanceSats:     current Ark balance (cap on amount)
 *   reserveSats:        amount to leave behind for everyday Lightning sends
 *   thresholdSats:      user's withdrawal threshold (informational)
 *   matchedRate:        USD-per-sat (already pre-multiplied; sats * rate = USD)
 *   currency:           fiat currency code
 */

interface Props {
    route: {
        params?: {
            destinationKind?: 'hot' | 'cold';
            destinationAddress?: string;
            wallet?: any;
            prefillSats?: number;
            arkBalanceSats?: number;
            reserveSats?: number;
            thresholdSats?: number;
            matchedRate?: number;
            currency?: string;
        };
    };
}

export default function ArkWithdrawReviewScreen({ route }: Props) {
    const navigation: any = useNavigation();
    const params = route?.params ?? {};
    const destinationKind: 'hot' | 'cold' = params.destinationKind ?? 'hot';
    const destinationAddress: string = params.destinationAddress ?? '';
    const arkBalanceSats: number = Number(params.arkBalanceSats) || 0;
    const reserveSats: number = Number(params.reserveSats) || 0;
    const thresholdSats: number = Number(params.thresholdSats) || 0;
    const matchedRate: number = Number(params.matchedRate) || 0;
    const currency: string = params.currency ?? 'USD';

    // Spendable cap:
    //   - balance > reserve  → spendable = balance − reserve. The reserve
    //     is a floor for everyday Lightning sends; withdrawals shouldn't
    //     dip below it.
    //   - balance ≤ reserve  → spendable = full balance. The reserve only
    //     applies once you have enough to maintain it; a user with 10K
    //     balance and 100K reserve setting isn't bound by the reserve,
    //     they just have less than they aspire to keep.
    const spendableSats: number =
        arkBalanceSats > reserveSats
            ? arkBalanceSats - reserveSats
            : arkBalanceSats;

    const initialAmountSats: number = useMemo(() => {
        const prefill = Number(params.prefillSats) || 0;
        if (prefill > 0 && prefill <= spendableSats) return prefill;
        return spendableSats;
    }, [params.prefillSats, spendableSats]);

    const [amountSats, setAmountSats] = useState<number>(initialAmountSats);
    const [isEditAmount, setIsEditAmount] = useState<boolean>(false);
    const [draftAmount, setDraftAmount] = useState<string>(
        String(initialAmountSats || ''),
    );
    const [note, setNote] = useState<string>('');
    const [isCheck, setIsCheck] = useState<boolean>(false);

    const [fee, setFee] = useState<ArkSendFeeView | null>(null);
    const [feeError, setFeeError] = useState<string | null>(null);
    const [isEstimating, setIsEstimating] = useState<boolean>(false);
    const [isSendLoading, setIsSendLoading] = useState<boolean>(false);
    const [isDone, setIsDone] = useState<boolean>(false);
    const [resultId, setResultId] = useState<string | null>(null);

    const swipeButtonRef = useRef<any>(null);

    // The vaultTab flag drives accent color in Strike's review. We expose
    // the same boolean so the bordered "Vault Address: …" card and the
    // QR icon use the cold (blue) vs hot (green) tint from `colors`.
    const vaultTab = destinationKind === 'cold';

    const destination: ArkDestination = useMemo(
        () => classifyArkDestination(destinationAddress),
        [destinationAddress],
    );
    const destinationLooksValid: boolean =
        destination.kind === 'onchain' && destinationAddress.length > 0;

    // Re-estimate fee on every committed amount change. Skipping when
    // amount is 0 or the destination is malformed avoids spurious SDK
    // calls; the user gets a "Set an amount" message until both are valid.
    //
    // When the *initial* estimate comes back and the user is trying to
    // drain their full spendable balance (`amountSats === spendableSats`
    // and `amount + fee > balance`), auto-lower the amount by the fee so
    // the send actually fits. This is the classic "Send Max" UX: if a user
    // with a 10000-sat VTXO asks to send 10000, the SDK needs
    // 10000 + fee available and rejects with BarkError.Internal because
    // there's nothing to cover the fee. We catch that case here and quietly
    // adjust to (balance − fee) so the next render shows the achievable
    // amount with the fee preview correctly recomputed.
    useEffect(() => {
        let cancelled = false;
        if (!destinationLooksValid || amountSats <= 0) {
            setFee(null);
            setFeeError(null);
            return;
        }
        setIsEstimating(true);
        setFeeError(null);
        (async () => {
            try {
                const estimate = await estimateArkSendFee(destination, amountSats);
                if (cancelled) return;
                // Drain-mode auto-adjust: only fires when the user is
                // sending exactly their full spendable balance and the
                // gross would exceed it. We don't auto-adjust when
                // amountSats < spendableSats — that's a deliberate user
                // choice and we shouldn't silently move it.
                if (
                    amountSats === spendableSats &&
                    estimate.grossAmountSats > arkBalanceSats &&
                    estimate.feeSats > 0 &&
                    spendableSats > estimate.feeSats
                ) {
                    const adjusted = spendableSats - Number(estimate.feeSats);
                    setAmountSats(adjusted);
                    setDraftAmount(String(adjusted));
                    // Don't set the stale fee — the next render will
                    // re-estimate against the adjusted amount.
                    return;
                }
                setFee(estimate);
            } catch (err: any) {
                if (cancelled) return;
                setFee(null);
                setFeeError(
                    err?.message
                        ? `Fee estimate failed: ${err.message}`
                        : 'Fee estimate failed.',
                );
            } finally {
                if (!cancelled) setIsEstimating(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [destination.kind, destinationAddress, amountSats, spendableSats, arkBalanceSats]);

    // ---- Handlers --------------------------------------------------------

    const editAmountClickHandler = () => {
        if (isEditAmount) {
            const next = Number(draftAmount);
            if (Number.isFinite(next) && next > 0 && next <= spendableSats) {
                setAmountSats(next);
            } else {
                SimpleToast.show(
                    `Amount must be between 1 and ${formatNumber(spendableSats)} sats`,
                    SimpleToast.LONG,
                );
            }
            setIsEditAmount(false);
        } else {
            setDraftAmount(String(amountSats));
            setIsEditAmount(true);
        }
    };

    const handleViewOnExplorer = () => {
        if (!resultId) return;
        // #details fragment auto-expands the inputs/outputs section on
        // mempool.space so the user lands on the full transaction view
        // rather than the mobile-collapsed summary.
        const url = `https://mempool.space/tx/${resultId}#details`;
        Linking.openURL(url).catch(() => {});
    };

    const handleBackToHome = () => {
        navigation.dispatch(
            CommonActions.reset({
                index: 0,
                routes: [{ name: 'HomeScreen' }],
            }),
        );
    };

    // Match the Strike review's preflight checks. Order matches it too so
    // users coming from one rail to the other get the same sequence of
    // toasts. Toast strings are intentionally near-verbatim where
    // applicable so muscle memory carries over.
    const handleToggle = async (isToggled: boolean) => {
        if (!isToggled) return;
        if (!destinationLooksValid) {
            SimpleToast.show(
                'Destination address is not a valid Bitcoin address',
                SimpleToast.LONG,
            );
            swipeButtonRef.current?.reset();
            return;
        }
        if (amountSats <= 0) {
            SimpleToast.show('Set an amount greater than 0', SimpleToast.SHORT);
            swipeButtonRef.current?.reset();
            return;
        }
        if (amountSats > spendableSats) {
            SimpleToast.show(
                `Amount exceeds spendable balance (${formatNumber(spendableSats)} sats after reserve)`,
                SimpleToast.LONG,
            );
            swipeButtonRef.current?.reset();
            return;
        }
        if (!fee) {
            SimpleToast.show('Waiting for fee estimate…', SimpleToast.SHORT);
            swipeButtonRef.current?.reset();
            return;
        }
        // Preflight: the SDK needs `amount + fee` available to spend.
        // Surface this client-side with a useful message instead of
        // letting Bark return BarkError.Internal (its catch-all "couldn't
        // pay" enum). Auto-suggest the largest amount that fits so the
        // user has a one-tap fix.
        if (Number(fee.grossAmountSats) > arkBalanceSats) {
            const maxSendable = Math.max(0, arkBalanceSats - Number(fee.feeSats));
            SimpleToast.show(
                `Amount + fee (${formatNumber(Number(fee.grossAmountSats))} sats) exceeds your Ark balance. Try ${formatNumber(maxSendable)} sats to drain the wallet.`,
                SimpleToast.LONG,
            );
            swipeButtonRef.current?.reset();
            return;
        }
        // Same toast string Strike's ReviewPayment uses, so users who go
        // through both rails see consistent messaging.
        if (vaultTab && !isCheck) {
            SimpleToast.show(
                'Please verify the destination address',
                SimpleToast.SHORT,
            );
            swipeButtonRef.current?.reset();
            return;
        }
        setIsSendLoading(true);
        try {
            const result = await executeArkSend(
                destination,
                amountSats,
                note.trim() || undefined,
            );
            setResultId(result.id);
            setIsDone(true);
            try {
                await fetchArkBalance();
            } catch {
                // non-fatal — the broadcast already succeeded
            }
        } catch (err: any) {
            console.warn('[ArkWithdraw] send failed:', err);
            SimpleToast.show(
                `Withdraw failed: ${err?.message ?? 'unknown error'}`,
                SimpleToast.LONG,
            );
            swipeButtonRef.current?.reset();
        } finally {
            setIsSendLoading(false);
        }
    };

    // ---- Derived display values -----------------------------------------

    const amountFiat = (amountSats * matchedRate).toFixed(2);
    const feeFiat = fee ? (fee.feeSats * matchedRate).toFixed(2) : null;
    const feePct =
        fee && fee.grossAmountSats > 0
            ? Math.min(999, (fee.feeSats / fee.grossAmountSats) * 100)
            : null;

    // ---- Success state ---------------------------------------------------

    if (isDone) {
        return (
            <ScreenLayout
                showToolbar
                isBackButton={false}
                title="Withdrawal sent"
            >
                <View
                    style={{
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 24,
                    }}
                >
                    <View
                        style={{
                            width: 96,
                            height: 96,
                            borderRadius: 48,
                            backgroundColor: colors.ark.light,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: 24,
                        }}
                    >
                        <Icon name="check" type="font-awesome" color="#000" size={48} />
                    </View>
                    <Text bold h2 white center style={{ marginBottom: 12 }}>
                        Withdrawal broadcast
                    </Text>
                    <Text style={{ color: colors.gray.light, textAlign: 'center', lineHeight: 20 }}>
                        Your {destinationKind} vault will reflect the funds once the
                        transaction confirms on-chain.
                    </Text>

                    {resultId && (
                        <TouchableOpacity
                            onPress={handleViewOnExplorer}
                            style={{
                                marginTop: 28,
                                paddingHorizontal: 18,
                                paddingVertical: 12,
                                borderWidth: 1,
                                borderColor: colors.ark.light,
                                borderRadius: 22,
                            }}
                        >
                            <Text bold style={{ color: colors.ark.light }}>
                                View on mempool.space
                            </Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity
                        onPress={handleBackToHome}
                        style={{
                            marginTop: 16,
                            paddingHorizontal: 28,
                            paddingVertical: 14,
                            borderRadius: 24,
                            backgroundColor: colors.ark.light,
                        }}
                    >
                        <Text bold style={{ color: '#000', fontSize: 16 }}>
                            Back to home
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScreenLayout>
        );
    }

    // ---- Review state — visual structure matches ReviewPayment line-for-line --

    return (
        <ScreenLayout showToolbar isBackButton title="Review Withdrawal">
            <View style={reviewStyles.topView}>
                <View style={reviewStyles.middle}>
                    {/* Threshold-not-yet-reached notice. Same color/copy
                        as ReviewPayment's "You haven't reached your
                        withdrawal threshold yet." */}
                    {arkBalanceSats < thresholdSats && thresholdSats > 0 && (
                        <Text
                            style={{
                                color: colors.yellow2,
                                marginLeft: 15,
                                marginBottom: 25,
                            }}
                        >
                            You haven't reached your withdrawal threshold yet.
                        </Text>
                    )}

                    {/* Amount row + Edit Amount button. Same flex layout as
                        ReviewPayment: TextViewV2 left-aligned, button on
                        the right with the same border / radius / colors. */}
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            marginRight: 15,
                        }}
                    >
                        {isEditAmount ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginLeft: 15 }}>
                                <Text bold style={{ fontSize: 18, color: colors.white }}>
                                    Recipient will get:{' '}
                                </Text>
                                <TextInput
                                    value={draftAmount}
                                    onChangeText={setDraftAmount}
                                    keyboardType="number-pad"
                                    style={{
                                        flex: 1,
                                        color: colors.white,
                                        fontSize: 16,
                                        borderBottomWidth: 1,
                                        borderBottomColor: colors.ark.light,
                                        paddingVertical: 2,
                                        marginRight: 8,
                                    }}
                                    placeholder="sats"
                                    placeholderTextColor="#555"
                                />
                            </View>
                        ) : (
                            <TextViewV2
                                keytext="Recipient will get: "
                                text={`${formatNumber(amountSats)} sats ~ ${getStrikeCurrency(currency)}${amountFiat}`}
                                textStyle={reviewStyles.price}
                            />
                        )}
                        <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={editAmountClickHandler}
                            style={{
                                borderWidth: 3,
                                borderColor: colors.white,
                                borderRadius: 17,
                                paddingVertical: 8,
                                paddingHorizontal: 10,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 14,
                                    color: isEditAmount ? colors.green : colors.white,
                                }}
                            >
                                {isEditAmount ? 'Save' : 'Edit Amount'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Spendable hint — Ark-specific cue. The reserve note
                        only renders when the reserve actually constrains
                        what the user can withdraw (i.e. balance > reserve).
                        Below-reserve balances see just the spendable line
                        without the reserve aside, since the reserve isn't
                        biting. */}
                    <Text
                        style={{
                            color: colors.gray.light,
                            fontSize: 12,
                            marginLeft: 15,
                            marginTop: 4,
                            marginBottom: 12,
                        }}
                    >
                        Spendable: {formatNumber(spendableSats)} sats
                        {arkBalanceSats > reserveSats && reserveSats > 0
                            ? ` (${formatNumber(reserveSats)} sats reserve kept on Ark)`
                            : ''}
                    </Text>

                    <TextViewV2 keytext="Sent from: " text="Ark Vault" />

                    {/* Address card. Same shape as ReviewPayment's
                        `isWithdrawal && to.length > 0` branch: bordered
                        TouchableOpacity with monospace italic address +
                        QR + Edit icons. Border tint follows vaultTab
                        (cold = blueText, hot = greenShadow). */}
                    <View
                        style={{
                            marginBottom: 30,
                            marginStart: 15,
                            marginEnd: 10,
                        }}
                    >
                        <Text bold style={{ fontSize: 18 }}>
                            {'To: '}
                        </Text>
                        <View
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginTop: 10,
                                paddingVertical: 8,
                                paddingHorizontal: 25,
                                borderWidth: 2,
                                borderColor: vaultTab
                                    ? colors.blueText
                                    : colors.greenShadow,
                                borderRadius: 15,
                                width: '90%',
                            }}
                        >
                            <Text
                                italic
                                style={StyleSheet.flatten({
                                    flex: 1,
                                    fontSize: 12,
                                    marginTop: 3,
                                    fontFamily: 'monospace',
                                    color: vaultTab
                                        ? colors.blueText
                                        : colors.greenShadow,
                                })}
                            >
                                {'Vault Address: '}
                                {destinationAddress}
                            </Text>
                            <Image
                                source={Edit}
                                style={reviewStyles.editImage}
                                resizeMode="contain"
                            />
                        </View>
                        {!destinationLooksValid && (
                            <Text style={{ color: '#FF7A68', fontSize: 12, marginTop: 6 }}>
                                Destination doesn't look like a valid Bitcoin address.
                            </Text>
                        )}
                    </View>

                    {/* Cold-vault verify block — verbatim copy + checkbox
                        styling from ReviewPayment so the visual is
                        indistinguishable across rails. */}
                    {vaultTab && (
                        <>
                            <Text
                                style={[
                                    {
                                        marginHorizontal: 12,
                                        fontSize: 14,
                                        width: isIOS ? '90%' : '80%',
                                        marginTop: -10,
                                    },
                                ]}
                            >
                                ⚠️ DO NOT transfer to any of these addresses without
                                verifying their authenticity from your hardware device!{' '}
                            </Text>
                            <TouchableOpacity
                                activeOpacity={0.7}
                                onPress={() => setIsCheck(!isCheck)}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    marginTop: 20,
                                    marginBottom: 25,
                                    marginHorizontal: 12,
                                    alignSelf: 'flex-start',
                                }}
                            >
                                <View style={reviewStyles.checkView}>
                                    {isCheck && (
                                        <Image
                                            source={Check}
                                            style={reviewStyles.checkImage}
                                            resizeMode="contain"
                                        />
                                    )}
                                </View>
                                <Text
                                    style={{
                                        color: colors.white,
                                        marginLeft: 10,
                                        fontSize: 16,
                                    }}
                                    italic
                                >
                                    I verified this address
                                </Text>
                            </TouchableOpacity>
                        </>
                    )}

                    {/* Fee block — TextViewV2 rows in the same style as
                        ReviewPayment's "Coinos Fee" / "Total Fee" lines.
                        Bark SDK only returns a single combined `feeSats`,
                        so we label what's bundled in (on-chain network +
                        Ark service) instead of pretending we can split. */}
                    {isEstimating ? (
                        <View
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginStart: 25,
                                marginTop: 15,
                            }}
                        >
                            <ActivityIndicator size="small" color={colors.ark.light} />
                            <Text
                                style={{
                                    color: colors.gray.light,
                                    marginLeft: 8,
                                    fontSize: 13,
                                }}
                            >
                                Estimating fee…
                            </Text>
                        </View>
                    ) : feeError ? (
                        <Text
                            style={{
                                color: '#FF7A68',
                                marginLeft: 25,
                                marginTop: 10,
                                fontSize: 13,
                            }}
                        >
                            {feeError}
                        </Text>
                    ) : fee ? (
                        <>
                            <TextViewV2
                                keytext="Network + Ark Fee:  "
                                text={` ~   ${formatNumber(fee.feeSats)} sats (~${getStrikeCurrency(currency)}${feeFiat})`}
                            />
                            {feePct !== null && (
                                <TextViewV2
                                    keytext="Total Fee:  "
                                    text={` ~   ${formatNumber(fee.feeSats)} sats (~${
                                        feePct < 0.01
                                            ? '<0.01'
                                            : feePct.toFixed(feePct < 1 ? 2 : 1)
                                    }%)`}
                                />
                            )}
                            <TextViewV2
                                keytext="Total debited:  "
                                text={` ~   ${formatNumber(fee.grossAmountSats)} sats`}
                            />
                            {fee.vtxosSpent.length > 0 && (
                                <TextViewV2
                                    keytext="Capsules used:  "
                                    text={` ~   ${fee.vtxosSpent.length}`}
                                />
                            )}
                        </>
                    ) : null}
                </View>

                {/* Note input — same Input/GradientCard wrapping as
                    ReviewPayment. Width is 50% of screen, marginHorizontal
                    30, marginTop 10, matching `styles.main`. */}
                <GradientCard
                    style={reviewStyles.main}
                    linearStyle={reviewStyles.heigth}
                    colors_={
                        note
                            ? [colors.pink.extralight, colors.pink.default]
                            : [colors.gray.thin, colors.gray.thin2]
                    }
                >
                    <Input
                        onChange={setNote}
                        value={note}
                        textInputStyle={reviewStyles.heigth2}
                        label="Add note"
                    />
                </GradientCard>
            </View>

            {/* Caution caption — same copy + position as ReviewPayment. */}
            <Text
                style={{
                    color: '#FFFFFF',
                    fontSize: 15,
                    textAlign: 'center',
                    marginBottom: 10,
                }}
            >
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' }}>
                    Caution:
                </Text>{' '}
                Bitcoin transactions are irreversible
            </Text>

            {/* Slide-to-Withdraw — same SwipeButton component, same title
                copy as ReviewPayment when isWithdrawal is true. */}
            <View style={reviewStyles.container}>
                <SwipeButton
                    title="Slide to Withdraw"
                    ref={swipeButtonRef}
                    onToggle={handleToggle}
                    isLoading={isSendLoading}
                />
            </View>
        </ScreenLayout>
    );
}
