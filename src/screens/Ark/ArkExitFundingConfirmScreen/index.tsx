import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import SimpleToast from 'react-native-simple-toast';

import { Input, ScreenLayout, Text } from '@Cypher/component-library';
import { GradientCard, SwipeButton } from '@Cypher/components';
import { colors } from '@Cypher/style-guide';
import { formatNumber } from '@Cypher/helpers/coinosHelper';
import useAuthStore from '@Cypher/stores/authStore';
import {
    fundExitFeesFromCoinos,
    getArkOnchainAddress,
    planExitFunding,
} from '@Cypher/services/ark';
import {
    bitcoinSendFee,
    getTransactionHistory,
    sendBitcoinPayment,
} from '@Cypher/api/coinOSApis';
import { getFiatRate } from '../../../../models/fiatUnit';

/**
 * Preparing the deposit needs bark's on-chain (BDK) wallet, and spawning that
 * hits an esplora endpoint. `ensureArkOnchainHandle` has no timeout of its own,
 * so a provider that accepts the connection and then never answers hangs this
 * screen forever with no error. Bound it here rather than leave the user on a
 * spinner that can never resolve.
 */
const PREPARE_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(
                () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
                ms,
            ),
        ),
    ]);
}

/**
 * Confirm screen for topping up the exit-fee reserve from another wallet.
 *
 * Everything that decides an outcome lives in services/ark/exitFundingCoinos
 * and exitFundingPlan, both unit-tested. This screen only shows the numbers and
 * hands the work over, so the money path is not defined by a component.
 *
 * The figures here answer the two questions the old flow left open: what
 * actually LANDS (the miner fee comes off the top, so it is not what you typed)
 * and when it takes effect (an on-chain deposit is useless until it confirms).
 */

type Props = {
    route: {
        params?: {
            /** Funding source id from the picker. Only 'coinos' is wired. */
            sourceId?: string;
            sourceLabel?: string;
            shortfallSats?: number;
            availableSats?: number | null;
            /** Fiat per BTC, for the dollar figures. */
            rate?: number;
            currencySymbol?: string;
        };
    };
};

const SATS_PER_BTC = 100_000_000;

export default function ArkExitFundingConfirmScreen({ route }: Props) {
    const navigation = useNavigation<any>();
    const {
        sourceId = 'coinos',
        sourceLabel = 'CoinOS',
        shortfallSats = 0,
        availableSats = null,
        rate = 0,
        currencySymbol = '$',
    } = route?.params ?? {};

    const { arkExitFeeReserveSats, setArkExitFeeReserveSats } = useAuthStore();

    const [address, setAddress] = useState<string | null>(null);
    const [feeSats, setFeeSats] = useState<number | null>(null);
    // What the user wants to LAND on-chain. Seeded with the shortfall, because
    // that is the number that clears the gate, but editable: the exit accepts
    // partial funding and a user may only want to part-fund it now.
    const [amountText, setAmountText] = useState(
        shortfallSats > 0 ? String(Math.floor(shortfallSats)) : '',
    );
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    // Why preparation failed, if it did. Distinct from a plan that simply is
    // not fundable: this one means we never got far enough to compute a plan.
    const [prepError, setPrepError] = useState<string | null>(null);
    // Debounce handle for re-estimating the fee as the amount is typed.
    const feeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The caller does not pass a rate, so every fiat figure here and on the
    // success screen rendered as 0.00. Fetch it the same way the non-Strike
    // rails do in SwapAmount. Failure just leaves the fiat hints blank.
    const [fetchedRate, setFetchedRate] = useState(0);
    useEffect(() => {
        if (rate > 0) return;
        let cancelled = false;
        (async () => {
            try {
                const r = (await getFiatRate('USD')) || 0;
                if (!cancelled) setFetchedRate(r);
            } catch {
                // Leave fiat blank rather than showing a wrong number.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [rate]);
    const effectiveRate = rate > 0 ? rate : fetchedRate;
    // Latched once an outcome becomes unknown. Never cleared: the point is that
    // this screen must not offer to send again. Mirrors the Ark send review.
    const [indeterminate, setIndeterminate] = useState(false);
    const swipeRef = useRef<any>(null);
    // Stable per mount, so a retry of the SAME intended top-up carries the same
    // key rather than looking like a fresh request.
    const idempotencyKey = useRef(
        `cbx-fund-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const addr = await withTimeout(
                    getArkOnchainAddress(),
                    PREPARE_TIMEOUT_MS,
                    'Preparing the deposit address',
                );
                if (cancelled) return;
                setAddress(addr);
                try {
                    const raw = await withTimeout(
                        bitcoinSendFee(shortfallSats, addr, 0),
                        PREPARE_TIMEOUT_MS,
                        'Estimating the network fee',
                    );
                    const parsed =
                        typeof raw === 'string' && raw.trim().startsWith('{')
                            ? JSON.parse(raw)
                            : null;
                    if (!cancelled) setFeeSats(Number(parsed?.fee ?? 0) || 0);
                } catch {
                    // A missing estimate must not block funding; it only makes
                    // the preview less precise.
                    if (!cancelled) setFeeSats(0);
                }
            } catch (err: any) {
                if (!cancelled) {
                    const msg = err?.message ?? 'unknown error';
                    // Show it ON the screen, not only as a toast that vanishes.
                    // The deposit address comes from the on-chain wallet, so the
                    // usual cause is the chain source being unreachable, which
                    // the user can often fix by changing network.
                    setPrepError(msg);
                    SimpleToast.show(`Could not prepare the top-up: ${msg}`, SimpleToast.LONG);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [shortfallSats]);

    /** Digits only. An empty or zero field is "nothing to send", not an error
     *  to shout about while the user is still typing. */
    const amountSats = useMemo(() => {
        const digits = amountText.replace(/[^0-9]/g, '');
        const n = digits ? parseInt(digits, 10) : 0;
        return Number.isFinite(n) ? n : 0;
    }, [amountText]);

    const plan = useMemo(
        () =>
            planExitFunding({
                // The field is the target now. planExitFunding calls it a
                // shortfall because that is what seeds it, but it only ever
                // means "sats the user wants to land".
                shortfallSats: amountSats,
                availableSats,
                feeSats: feeSats ?? 0,
            }),
        [amountSats, availableSats, feeSats],
    );

    /** True once the field no longer covers the gap the exit reported. */
    const underSuggested = shortfallSats > 0 && amountSats > 0 && amountSats < shortfallSats;

    // The fee depends on the amount, so a fee quoted for the mount-time
    // shortfall goes stale the moment the field is edited, and "Leaves your
    // wallet" is built from it. Re-estimate on a debounce rather than per
    // keystroke: this is a network call to CoinOS.
    useEffect(() => {
        if (!address || amountSats <= 0) return;
        if (feeTimer.current) clearTimeout(feeTimer.current);
        let cancelled = false;
        feeTimer.current = setTimeout(() => {
            (async () => {
                try {
                    const raw = await withTimeout(
                        bitcoinSendFee(amountSats, address, 0),
                        PREPARE_TIMEOUT_MS,
                        'Estimating the network fee',
                    );
                    const parsed =
                        typeof raw === 'string' && raw.trim().startsWith('{')
                            ? JSON.parse(raw)
                            : null;
                    if (!cancelled) setFeeSats(Number(parsed?.fee ?? 0) || 0);
                } catch {
                    // Keep the last estimate. A failed re-quote makes the
                    // preview less precise; it must not blank the screen.
                }
            })();
        }, 500);
        return () => {
            cancelled = true;
            if (feeTimer.current) clearTimeout(feeTimer.current);
        };
    }, [amountSats, address]);

    // Reasons the swipe can never succeed, as opposed to "not yet". Ordered so
    // the most specific wins: an indeterminate send outranks a bad plan.
    const blockedReason: string | null = loading
        ? null
        : indeterminate
          ? `This top-up may already have been sent. Check your ${sourceLabel} history before trying again.`
          : prepError
            ? 'Cannot continue until the deposit address is available.'
            : sourceId !== 'coinos'
              ? `Funding from ${sourceLabel} is not available yet.`
              : amountSats <= 0
                ? 'Enter an amount to send.'
                : !plan.ok
                  ? plan.reason
                  : null;

    const fiat = (sats: number) =>
        effectiveRate > 0
            ? `${currencySymbol}${((sats / SATS_PER_BTC) * effectiveRate).toFixed(2)}`
            : '';

    const feePct =
        plan.ok && plan.sendSats > 0 && feeSats
            ? ((feeSats / plan.sendSats) * 100).toFixed(feeSats / plan.sendSats < 0.01 ? 2 : 1)
            : null;

    const onConfirm = async () => {
        if (!plan.ok || sending || indeterminate) return;
        setSending(true);
        try {
            const res = await fundExitFeesFromCoinos(
                {
                    shortfallSats: amountSats,
                    availableSats,
                    currentReserveSats: arkExitFeeReserveSats ?? 0,
                    idempotencyKey: idempotencyKey.current,
                },
                {
                    getOnchainAddress: getArkOnchainAddress,
                    getRecentPayments: () => getTransactionHistory(0, 20),
                    estimateFeeSats: async (addr, amt) => {
                        const raw = await bitcoinSendFee(amt, addr, 0);
                        const parsed =
                            typeof raw === 'string' && raw.trim().startsWith('{')
                                ? JSON.parse(raw)
                                : null;
                        return Number(parsed?.fee ?? 0) || 0;
                    },
                    send: (addr, amt, key) => sendBitcoinPayment(amt, addr, 0, 'Exit fee reserve', key),
                    armReserve: setArkExitFeeReserveSats,
                },
            );

            if (res.ok) {
                navigation.replace('ArkSendSuccessScreen', {
                    title: 'Exit fees funded',
                    // These three were never passed, so the success screen fell
                    // back to its defaults and reported "0 sats" for a real
                    // deposit. It reads them; send them.
                    value: String(res.sentSats),
                    valueUsd:
                        effectiveRate > 0
                            ? ((res.sentSats / SATS_PER_BTC) * effectiveRate).toFixed(2)
                            : '0.00',
                    currency: currencySymbol === '$' ? 'USD' : currencySymbol,
                    // On-chain, not Lightning. The default rail label and the
                    // bolt both said otherwise.
                    isOnchain: true,
                    networkLabel: 'Bitcoin Network',
                    // The deposit is worthless until it confirms, and saying so
                    // here is what stops "nothing happened" a minute later. The
                    // amount is displayed above now, so it is not repeated.
                    note: res.partial
                        ? 'That is less than the full shortfall, so top up again if the exit still reports a gap. Emergency Exit unlocks once it confirms on-chain.'
                        : 'Emergency Exit unlocks once it confirms on-chain.',
                    txid: res.txid ?? undefined,
                });
                return;
            }

            if (res.indeterminate) {
                setIndeterminate(true);
            }
            SimpleToast.show(res.reason, SimpleToast.LONG);
            swipeRef.current?.reset?.();
        } finally {
            setSending(false);
        }
    };

    const Row = ({
        label,
        value,
        hint,
        wrap,
    }: {
        label: string;
        value: string;
        hint?: string;
        wrap?: boolean;
    }) => (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 }}>
            <Text style={{ fontSize: 14, color: '#BBB' }}>{label}</Text>
            <View style={{ alignItems: 'flex-end', flex: 1, paddingLeft: 12 }}>
                <Text bold style={{ fontSize: 14 }} numberOfLines={wrap ? 2 : 1}>
                    {value}
                </Text>
                {!!hint && <Text style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{hint}</Text>}
            </View>
        </View>
    );

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Fund exit fees">
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
                keyboardShouldPersistTaps="handled"
            >
                {loading ? (
                    <ActivityIndicator color={colors.pink.default} style={{ marginTop: 40 }} />
                ) : (
                    <>
                        {prepError && (
                            <View
                                style={{
                                    marginTop: 12,
                                    padding: 14,
                                    borderRadius: 12,
                                    borderWidth: 1,
                                    borderColor: '#FF8A80',
                                    backgroundColor: '#1a1a1a',
                                }}
                            >
                                <Text bold style={{ fontSize: 14, color: '#FF8A80', marginBottom: 6 }}>
                                    Could not prepare the top-up
                                </Text>
                                <Text style={{ fontSize: 12, color: '#DDD', lineHeight: 17 }}>
                                    {prepError}
                                </Text>
                                <Text style={{ fontSize: 12, color: '#888', lineHeight: 17, marginTop: 8 }}>
                                    The deposit address comes from the on-chain wallet, which needs a
                                    reachable chain source. Changing network often clears this. Go back
                                    and reopen this screen to retry.
                                </Text>
                            </View>
                        )}
                        {/* NOT GradientCard. That component hard-codes
                            height: 60 on both its wrapper and its gradient,
                            because it is the single-row input pill, and every
                            other caller overrides it via linearStyle. Used here
                            for a five-row details panel it clipped everything
                            below the first row: observed on device as a screen
                            showing only "From CoinOS", with the amount, the
                            network fee and the total silently invisible on a
                            money-moving confirmation. A details panel is the
                            plain bordered View the sibling Ark review screens
                            use. */}
                        {/* Amount. GradientCard's fixed 60px height is
                            CORRECT here: it is the single-field pill the rest
                            of the app uses for exactly this, which is why the
                            details panel below is a plain View instead. */}
                        <GradientCard
                            style={{ marginTop: 12 }}
                            colors_={
                                amountSats > 0
                                    ? [colors.pink.extralight, colors.pink.default]
                                    : [colors.gray.thin, colors.gray.thin2]
                            }
                        >
                            <Input
                                value={amountText}
                                onChange={(t: string) => setAmountText(t.replace(/[^0-9]/g, ''))}
                                keyboardType="number-pad"
                                label="Amount in sats"
                                maxLength={12}
                            />
                        </GradientCard>

                        {shortfallSats > 0 && (
                            <Text
                                style={{
                                    fontSize: 12,
                                    color: underSuggested ? '#FFD54F' : '#888',
                                    marginTop: 8,
                                    lineHeight: 17,
                                }}
                            >
                                {underSuggested
                                    ? `Suggested ${formatNumber(shortfallSats)} sats. Less than that still helps: the exit runs as far as these fees allow.`
                                    : `Suggested ${formatNumber(shortfallSats)} sats, which is what the exit is short by.`}
                            </Text>
                        )}

                        <View
                            style={{
                                marginTop: 12,
                                borderRadius: 20,
                                borderWidth: 1,
                                borderColor: '#333',
                                backgroundColor: '#1a1a1a',
                            }}
                        >
                            <View style={{ padding: 16 }}>
                                <Row label="From" value={sourceLabel} />
                                <Row label="To" value="Bark on-chain wallet" />
                                <Row
                                    wrap
                                    label="Address"
                                    value={address ?? 'Preparing...'}
                                    hint={address ? 'Deposit lands here and stays on-chain' : undefined}
                                />
                                {plan.ok ? (
                                    <>
                                        <Row
                                            label="Amount"
                                            value={`${formatNumber(plan.sendSats)} sats`}
                                            hint={fiat(plan.sendSats) || undefined}
                                        />
                                        <Row
                                            label="Network fee"
                                            value={`${formatNumber(feeSats ?? 0)} sats`}
                                            hint={
                                                feePct
                                                    ? `${feePct}%${fiat(feeSats ?? 0) ? ` · ${fiat(feeSats ?? 0)}` : ''}`
                                                    : fiat(feeSats ?? 0) || undefined
                                            }
                                        />
                                        <Row
                                            label="Leaves your wallet"
                                            value={`${formatNumber(plan.totalCostSats)} sats`}
                                            hint={fiat(plan.totalCostSats) || undefined}
                                        />
                                    </>
                                ) : (
                                    <Text style={{ fontSize: 13, color: '#FFD54F', paddingVertical: 12 }}>
                                        {plan.reason}
                                    </Text>
                                )}
                            </View>
                        </View>

                        {plan.ok && plan.partial && (
                            <Text style={{ fontSize: 12, color: '#FFD54F', marginTop: 12, lineHeight: 17 }}>
                                This does not cover the whole shortfall. It still helps: the exit
                                resumes as far as these fees allow.
                            </Text>
                        )}

                        <Text style={{ fontSize: 12, color: '#888', marginTop: 12, lineHeight: 17 }}>
                            These sats stay on-chain to pay miner fees and are not moved into Ark.
                            Emergency Exit unlocks once the deposit confirms.
                        </Text>

                    </>
                )}
            </ScrollView>

            <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                {blockedReason ? (
                    // SwipeButton only knows `isLoading`, and that renders a
                    // spinner captioned "Please wait". Feeding a permanent
                    // condition (no fundable plan, unsupported source, latched
                    // indeterminate) into it told the user we were working on
                    // something that was never going to happen: observed on
                    // device as an endless "Please wait" with no explanation.
                    // A blocked state is not a busy state, so say which it is.
                    <View
                        style={{
                            padding: 16,
                            borderRadius: 12,
                            backgroundColor: '#1a1a1a',
                            borderWidth: 1,
                            borderColor: '#333',
                        }}
                    >
                        <Text style={{ fontSize: 13, color: '#FFD54F', lineHeight: 18 }}>
                            {blockedReason}
                        </Text>
                    </View>
                ) : (
                    <SwipeButton
                        title="Slide to Fund"
                        ref={swipeRef}
                        onToggle={onConfirm}
                        isLoading={sending || loading}
                    />
                )}
            </View>
        </ScreenLayout>
    );
}
