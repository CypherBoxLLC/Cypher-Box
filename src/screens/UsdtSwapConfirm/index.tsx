import BigNumber from "bignumber.js";
import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { dispatchReset, resetAndNavigate } from "@Cypher/helpers/navigation";
import { resolveHotVaultTronAccount, tronTransferSignerForWallet } from "@Cypher/services/tron/account";
import { type PreparedUsdtConversion, prepareUsdtConversion } from "@Cypher/services/tron/conversion";
import { formatUsdtExact } from "@Cypher/services/tron/format";
import {
    classifySwapDestination,
    describeSwapDestinationProblem,
    formatSats,
    labelForSwapDestination,
    planUsdtSwap,
} from "@Cypher/services/tron/swapDestination";
import { describeNotReady, describeQuoteError, type QuoteRefusal } from "@Cypher/services/tron/swapMessages";
import useAuthStore from "@Cypher/stores/authStore";
import { usdtSwapRunner, whenUsdtSwapStoreReady } from "@Cypher/stores/usdtSwapStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import Biometric from "../../../class/biometrics";
import styles from "./styles";

type ReadyConversion = Extract<PreparedUsdtConversion, { ready: true }>;

type QuoteState =
    | { readonly kind: 'quoting' }
    | { readonly kind: 'ready'; readonly prepared: ReadyConversion }
    | { readonly kind: 'refused'; readonly refusal: QuoteRefusal };

/** When to say a quote is slow: our backend can take most of a minute to wake. */
const SLOW_QUOTE_MS = 8_000;

interface Props {
    route: { params?: { amount?: string; destination?: string } };
}

const toSats = (btc: string) => new BigNumber(btc).shiftedBy(8).integerValue(BigNumber.ROUND_DOWN).toFixed(0);

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
    return (
        <View style={styles.row}>
            <Text bold style={styles.rowLabel}>{label}</Text>
            <Text bold={emphasis} style={emphasis ? [styles.rowValue, styles.rowValueEmphasis] : styles.rowValue}>
                {value}
            </Text>
        </View>
    );
}

type ReadyQuoteProps = {
    prepared: ReadyConversion;
    onchain: boolean;
    exactOut: boolean;
    destinationLabel: string;
    destinationValue: string;
    secondsLeft: number;
};

/** The quote, as the quote states it. */
function ReadyQuote({ prepared, onchain, exactOut, destinationLabel, destinationValue, secondsLeft }: ReadyQuoteProps) {
    const q = prepared.quote;
    const firm = q.settleAmountIsFirm !== false;
    const sats = formatSats(toSats(q.settleAmount));
    const floor = q.minSettleAmount ? formatSats(toSats(q.minSettleAmount)) : null;
    const settle = new BigNumber(q.settleAmount);
    const price = settle.isGreaterThan(0) ? new BigNumber(q.depositAmount).dividedBy(settle).toFormat(0) : null;

    const receiveNote = firm
        ? exactOut
            ? 'Exactly what the invoice asks for.'
            : 'Exactly this amount.'
        : `Flashnet sets the final amount when it swaps, so it can differ slightly.${floor ? ` At least ${floor} sats.` : ''}`;

    return (
        <View>
            <Row label="You send" value={`${formatUsdtExact(q.depositAmount)} USDT`} emphasis />
            {exactOut && <Text style={styles.rowNote}>Worked out from the invoice's amount.</Text>}

            <Row label="You receive" value={firm ? `${sats} sats` : `About ${sats} sats`} emphasis />
            <Text style={styles.rowNote}>{receiveNote}</Text>

            <Row label="Over" value={onchain ? 'The bitcoin network, on chain' : 'Lightning'} />

            <View style={styles.row}>
                <Text bold style={styles.rowLabel}>To</Text>
                <Text style={styles.destinationLabel}>{destinationLabel}</Text>
                <View style={styles.destinationBox}>
                    <Text style={styles.destinationValue}>{destinationValue}</Text>
                </View>
            </View>

            {price !== null && <Row label="Price" value={`1 bitcoin for ${price} USDT, fees included`} />}

            <Text style={secondsLeft > 0 ? styles.countdown : [styles.countdown, styles.countdownExpired]}>
                {secondsLeft > 0
                    ? `This price holds for ${secondsLeft} more second${secondsLeft === 1 ? '' : 's'}.`
                    : 'This price has expired. Get a new quote to continue.'}
            </Text>
        </View>
    );
}

/**
 * Swap USDT to bitcoin, step three: the quote, and the one tap that pays it.
 *
 * Opening the screen books a Flashnet quote through prepareUsdtConversion,
 * which first checks the wallet can pay now. Everything shown comes from that
 * quote: the exact USDT that will leave the wallet and the bitcoin it buys,
 * never an estimate. Flashnet prices exact_in payouts when it swaps, so there
 * the amount is marked approximate, with its floor when the quote carries one.
 *
 * A quote allocates a deposit address and holds for two minutes whether or
 * not it is used, so one is booked when the screen opens and again only when
 * the user asks, never on a re-render. The price is good until confirmBy, a
 * minute before the quote's own expiry, which leaves the deposit time to land.
 *
 * Swap now asks for biometrics where they are on, as a Hot Vault send does,
 * then hands the swap to the runner, which records it before signing. A
 * synchronous latch stops a second tap starting a second payment before the
 * first one's state has rendered.
 */
export default function UsdtSwapConfirm({ route }: Props) {
    const amount = route?.params?.amount ?? '';
    const destinationRaw = route?.params?.destination ?? '';
    const navigation = useNavigation<any>();
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    const hotVault = useMemo(
        () => (wallets || []).find((w: any) => typeof w?.getID === 'function' && w.getID() === walletID),
        [wallets, walletID],
    );
    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);

    // Read once: an invoice's time left is judged as the screen opens.
    const destination = useMemo(() => classifySwapDestination(destinationRaw), [destinationRaw]);
    const plan = useMemo(
        () => (destination.kind === 'invalid' ? null : planUsdtSwap(amount, destination)),
        [amount, destination],
    );
    const exactOut = plan?.mode === 'exact_out';

    const [quote, setQuote] = useState<QuoteState>({ kind: 'quoting' });
    const [slowQuote, setSlowQuote] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [starting, setStarting] = useState(false);
    const startingRef = useRef(false);
    // Each request's number: an answer to an older one, or one landing after
    // the screen closed, is dropped.
    const quoteRun = useRef(0);

    const requestQuote = useCallback(async () => {
        const run = ++quoteRun.current;
        if (destination.kind === 'invalid') {
            setQuote({
                kind: 'refused',
                refusal: { message: describeSwapDestinationProblem(destination.problem), action: 'change_destination' },
            });
            return;
        }
        if (!plan || !account) {
            setQuote({
                kind: 'refused',
                refusal: { message: 'Your USDT comes from your Hot Vault, and this phone no longer has one.', action: 'none' },
            });
            return;
        }
        setQuote({ kind: 'quoting' });
        try {
            const prepared = await prepareUsdtConversion({
                account,
                settle: plan.settle,
                settleAddress: plan.settleAddress,
                amount: plan.amount,
                mode: plan.mode,
            });
            if (run !== quoteRun.current) return;
            setNowMs(Date.now());
            setQuote(
                prepared.ready
                    ? { kind: 'ready', prepared }
                    : { kind: 'refused', refusal: describeNotReady(prepared, exactOut) },
            );
        } catch (error) {
            if (run !== quoteRun.current) return;
            setQuote({ kind: 'refused', refusal: describeQuoteError(error, exactOut) });
        }
    }, [destination, plan, account, exactOut]);

    // Book once, on opening. Not on the dependencies: the wallet list is
    // rebuilt as the app saves, and each rebuild would book another quote.
    const requestQuoteRef = useRef(requestQuote);
    requestQuoteRef.current = requestQuote;
    useEffect(() => {
        void requestQuoteRef.current();
        return () => {
            quoteRun.current += 1;
        };
    }, []);

    useEffect(() => {
        if (quote.kind !== 'quoting') {
            setSlowQuote(false);
            return undefined;
        }
        const timer = setTimeout(() => setSlowQuote(true), SLOW_QUOTE_MS);
        return () => clearTimeout(timer);
    }, [quote.kind]);

    useEffect(() => {
        if (quote.kind !== 'ready') return undefined;
        const timer = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [quote.kind]);

    const secondsLeft =
        quote.kind === 'ready' ? Math.max(0, Math.floor((quote.prepared.confirmBy.getTime() - nowMs) / 1000)) : 0;
    const expired = quote.kind === 'ready' && secondsLeft <= 0;

    const onSwap = async () => {
        if (startingRef.current || quote.kind !== 'ready' || expired || !account || !hotVault) return;
        startingRef.current = true;
        setStarting(true);
        // Set once there is a swap to show: this one, started here, or one
        // already under way. From then on this screen only leaves.
        let showProgress = false;
        try {
            const sign = tronTransferSignerForWallet(hotVault);
            if (!sign) {
                setQuote({
                    kind: 'refused',
                    refusal: {
                        message: 'This Hot Vault holds no recovery phrase on this phone, so it cannot sign the deposit.',
                        action: 'none',
                    },
                });
                return;
            }
            if (await Biometric.isBiometricUseCapableAndEnabled()) {
                if (!(await Biometric.unlockWithBiometrics())) return;
            }
            // The prompt can outlast the price.
            if (Date.now() >= quote.prepared.confirmBy.getTime()) {
                setNowMs(Date.now());
                return;
            }
            await whenUsdtSwapStoreReady();
            if (usdtSwapRunner.canStart()) {
                usdtSwapRunner.start({
                    prepared: quote.prepared,
                    account,
                    sign,
                    request: { usdtAmount: amount, destination: destinationRaw },
                });
            }
            // Either way there is now a swap under way, and that is what to show.
            showProgress = true;
        } catch {
            // Only reached before start() took the swap: nothing was signed.
            setQuote({
                kind: 'refused',
                refusal: { message: 'The swap could not start. Nothing was sent. Get a new quote to try again.', action: 'retry' },
            });
        } finally {
            if (!showProgress) {
                startingRef.current = false;
                setStarting(false);
            }
        }
        if (showProgress) {
            resetAndNavigate('HomeScreen', 'UsdtSwapProgress');
        }
    };

    const onRefusalAction = (refusal: QuoteRefusal) => {
        switch (refusal.action) {
            case 'retry':
                void requestQuote();
                return;
            case 'change_amount':
                navigation.navigate('UsdtSwapAmount');
                return;
            case 'change_destination':
                navigation.goBack();
                return;
            case 'none':
                dispatchReset('HomeScreen');
        }
    };

    const refusalButtonTitle = (refusal: QuoteRefusal) =>
        refusal.action === 'retry'
            ? 'Try again'
            : refusal.action === 'change_amount'
              ? 'Change amount'
              : refusal.action === 'change_destination'
                ? 'Change destination'
                : 'Home';

    const usdtColors = [colors.usdt.gradient1, colors.usdt.gradient2];

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Review swap">
            <ScrollView style={styles.main} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {quote.kind === 'quoting' && (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color={colors.usdt.light} />
                        <Text style={styles.quiet}>Getting a quote from Flashnet...</Text>
                        {slowQuote && (
                            <Text style={styles.quiet}>This can take up to a minute when our server is waking up.</Text>
                        )}
                    </View>
                )}

                {quote.kind === 'refused' && (
                    <View style={styles.center}>
                        <Text bold style={styles.refusalTitle}>No quote</Text>
                        <Text style={styles.refusal}>{quote.refusal.message}</Text>
                    </View>
                )}

                {quote.kind === 'ready' && plan && destination.kind !== 'invalid' && (
                    <ReadyQuote
                        prepared={quote.prepared}
                        onchain={plan.settle.network === 'bitcoin'}
                        exactOut={exactOut}
                        destinationLabel={labelForSwapDestination(destination)}
                        destinationValue={destination.value}
                        secondsLeft={secondsLeft}
                    />
                )}
            </ScrollView>

            <View style={styles.footer}>
                {quote.kind === 'ready' && (
                    <Text style={styles.caution}>
                        Check the destination. Once the bitcoin is sent, it cannot be recalled.
                    </Text>
                )}
                {quote.kind === 'ready' && !expired && (
                    <GradientButton
                        style={styles.button}
                        title={starting ? 'Starting...' : 'Swap now'}
                        disabled={starting}
                        onPress={onSwap}
                        colors_={usdtColors}
                    />
                )}
                {quote.kind === 'ready' && expired && (
                    <GradientButton
                        style={styles.button}
                        title="Get a new quote"
                        onPress={() => void requestQuote()}
                        colors_={usdtColors}
                    />
                )}
                {quote.kind === 'refused' && (
                    <GradientButton
                        style={styles.button}
                        title={refusalButtonTitle(quote.refusal)}
                        onPress={() => onRefusalAction(quote.refusal)}
                        colors_={usdtColors}
                    />
                )}
            </View>
        </ScreenLayout>
    );
}
