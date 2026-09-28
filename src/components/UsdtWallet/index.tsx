import BigNumber from "bignumber.js";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, TextInput, TouchableOpacity, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { getFlashnetPair } from "@Cypher/api/flashnetAPIs";
import { getTronUsdtBalance } from "@Cypher/api/tronAPIs";
import { asset } from "@Cypher/services/chainSwap/types";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import { USDT_ASSET_LABEL } from "@Cypher/services/tron/constants";
import { formatUsdtAmount, formatUsdtExact } from "@Cypher/services/tron/format";
import {
    type SwapDirection,
    convertAtRate,
    flipDirection,
    formatBitcoinAmount,
    formatRateLine,
    isBuyingBitcoin,
    normalizeTypedAmount,
    receiveAssetOf,
    sanitizeTypedAmount,
    sendAssetOf,
    typedDecimalsFor,
} from "@Cypher/services/tron/swapConvert";
import useAuthStore from "@Cypher/stores/authStore";
import useUsdtSendStore, { whenUsdtSendStoreReady } from "@Cypher/stores/usdtSendStore";
import useUsdtSwapStore, { whenUsdtSwapStoreReady } from "@Cypher/stores/usdtSwapStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import GradientView from "../GradientView";
import LinearBorderView from "../StrikeView/LinearBorderView";
import styles, { CARD_HEIGHT, CARD_WIDTH } from "./styles";

/** The illustrative figures on the preview card. Not the user's. */
const PREVIEW = { balance: '1000', amount: '250', rate: '0.00000899' } as const;

/** When to read the balance again, after a failure and after a success. */
const RETRY_AFTER_FAILURE_MS = 15_000;
const REFRESH_AFTER_SUCCESS_MS = 60_000;

/**
 * How long after the last keystroke to price the amount.
 *
 * The rate depends on the size, since the Tron deposit's cost is flat, so the
 * amount is sent to Flashnet rather than pricing at the route minimum. That is
 * two requests per reading, hence the wait: it prices what the user settled
 * on, not every digit on the way there.
 */
const PRICE_DEBOUNCE_MS = 600;

/** The pair the card prices. */
const USDT_TRON = asset('usdt', 'tron');
/**
 * On-chain bitcoin, as the indicative side of the rate.
 *
 * A swap's real route depends on where the user sends it, which they choose on
 * the review screen, and Lightning prices a little differently. The card's job
 * is the price of bitcoin; the quote on review is the figure that binds.
 */
const BTC_ONCHAIN = asset('btc', 'bitcoin');

type Props = {
    /**
     * Show the card as an illustration: sample figures, the buttons as shapes
     * only, nothing tappable, nothing read from the network. Used on the last
     * screen of Hot Vault creation, where the card is shown, not used.
     */
    preview?: boolean;
};

/**
 * One of the card's pill buttons. Without onPress it is a shape only.
 *
 * `small` is Receive and Send, which sit beside the balance; the default is
 * the full width Swap. `dimmed` greys the label rather than passing
 * GradientView's own `disabled`, which greys the whole gradient and made the
 * preview card's buttons read as broken (see the fix in 991baa8). The button
 * still takes the tap and does nothing, which is what an amount that cannot
 * be swapped should do.
 */
function ActionButton({
    label,
    onPress,
    small = false,
    spaced = false,
    dimmed = false,
}: {
    label: string;
    onPress?: () => void;
    small?: boolean;
    spaced?: boolean;
    dimmed?: boolean;
}) {
    const size = small ? (spaced ? [styles.smallSize, styles.smallSpaced] : styles.smallSize) : null;
    const shape = small ? styles.smallSize : null;
    return (
        <GradientView
            style={[styles.actionButton, size]}
            linearGradientStyle={[styles.actionGradient, shape]}
            topShadowStyle={[styles.topShadow, shape]}
            bottomShadowStyle={[styles.bottomShadow, shape]}
            linearGradientStyleMain={[styles.actionGradientMain, shape]}
            onPress={onPress}
        >
            <Text
                bold
                center
                style={
                    small
                        ? dimmed
                            ? [styles.smallLabel, styles.buttonLabelDisabled]
                            : styles.smallLabel
                        : dimmed
                          ? [styles.buttonLabel, styles.buttonLabelDisabled]
                          : styles.buttonLabel
                }
            >
                {label}
            </Text>
        </GradientView>
    );
}

/**
 * The USDT card, on Home and at the end of Hot Vault creation.
 *
 * It is a converter. The balance is at the top, then the amount to spend, a
 * flip button, and what that buys at Flashnet's rate, then the price. Flip
 * turns it around: buying bitcoin with USDT becomes selling bitcoin for USDT.
 * Swap carries those figures to the review screen, which books the quote and
 * asks where the bitcoin goes. The flip button and the Swap button are
 * different things: flip changes the direction, Swap leaves the card.
 *
 * USDT comes with the Hot Vault: the Tron account is derived from the vault's
 * phrase, so a user who has a vault already has an address and there is
 * nothing to unlock. Outside preview the card renders nothing without one, and
 * Home only adds the slide when the vault holds a phrase, so that case is a
 * vault deleted while the card is on screen.
 *
 * Nothing here logs. The balance is not secret, but the address it is read for
 * is derived from seed material and the surrounding code keeps that habit.
 */
export default function UsdtWallet({ preview = false }: Props) {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Memoised because the derivation behind it runs BIP39's PBKDF2 over 2048
    // rounds. Skipped entirely for the preview, which shows no real address.
    const account = useMemo(
        () => (preview ? null : resolveHotVaultTronAccount(wallets, walletID)),
        [preview, wallets, walletID],
    );
    const address = account?.address ?? null;

    const [balance, setBalance] = useState<string | null>(null);
    /** Why the last balance read failed, shown in place of the balance. */
    const [balanceError, setBalanceError] = useState<string | null>(null);
    /** Bumped by a tap on the failure, to read again now rather than wait. */
    const [reloadKey, setReloadKey] = useState(0);
    const [direction, setDirection] = useState<SwapDirection>('usdt_to_btc');
    const [typed, setTyped] = useState('');
    /** The amount Flashnet was last asked to price, behind the debounce. */
    const [priced, setPriced] = useState('');
    const [pair, setPair] = useState<{ rate: string; min: string } | null>(null);
    const [priceFailed, setPriceFailed] = useState(false);

    // Read the balance, then keep it fresh. A failed read keeps whatever is on
    // screen and tries again shortly, but it says so: swallowing the reason
    // left the card spinning forever with nothing to tell the user or us which
    // of TronGrid, the network or the address was at fault.
    useEffect(() => {
        if (preview || !address) return undefined;
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setBalance(null);
        setBalanceError(null);
        const read = async () => {
            let wait = RETRY_AFTER_FAILURE_MS;
            try {
                const value = await getTronUsdtBalance(address);
                if (!alive) return;
                setBalance(value);
                setBalanceError(null);
                wait = REFRESH_AFTER_SUCCESS_MS;
            } catch (error) {
                if (alive) {
                    const why = error instanceof Error && error.message ? error.message : 'Could not read your balance';
                    setBalanceError(why);
                }
            }
            if (alive) timer = setTimeout(read, wait);
        };
        void read();
        return () => {
            alive = false;
            if (timer) clearTimeout(timer);
        };
    }, [preview, address, reloadKey]);

    // Hold the amount still before pricing it.
    useEffect(() => {
        if (preview) return undefined;
        const timer = setTimeout(() => setPriced(typed), PRICE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [preview, typed]);

    // Price the pair the card is pointed at. An empty amount prices the route
    // itself, which still gives a rate to show before anything is entered.
    useEffect(() => {
        if (preview) return undefined;
        let alive = true;
        setPriceFailed(false);
        const buying = isBuyingBitcoin(direction);
        const amount = normalizeTypedAmount(priced);
        getFlashnetPair(
            buying ? USDT_TRON : BTC_ONCHAIN,
            buying ? BTC_ONCHAIN : USDT_TRON,
            amount || undefined,
        )
            .then((p) => {
                if (alive) setPair({ rate: p.rate, min: p.min });
            })
            .catch(() => {
                if (!alive) return;
                setPair(null);
                setPriceFailed(true);
            });
        return () => {
            alive = false;
        };
    }, [preview, direction, priced]);

    if (!preview && !address) {
        return null;
    }

    const balanceText = preview
        ? formatUsdtAmount(PREVIEW.balance)
        : balance === null
          ? null
          : formatUsdtAmount(balance);

    const amountIn = preview ? PREVIEW.amount : typed;
    const rate = preview ? PREVIEW.rate : (pair?.rate ?? null);
    const normalized = normalizeTypedAmount(amountIn);
    const converted = convertAtRate(normalized, rate, direction);

    const sendAsset = sendAssetOf(direction);
    const receiveAsset = receiveAssetOf(direction);
    const sendColor = sendAsset === 'USDT' ? colors.usdt.light : colors.bitcoin;
    const receiveColor = receiveAsset === 'USDT' ? colors.usdt.light : colors.bitcoin;

    const receiveText =
        converted === null
            ? '0'
            : receiveAsset === 'BTC'
              ? formatBitcoinAmount(converted)
              : formatUsdtAmount(converted);

    // The amount entered is checked against the route's floor and, when the
    // USDT is what is being spent, the wallet's balance. Neither is the last
    // word: the review screen's quote checks both again against the chain.
    const entered = new BigNumber(normalized);
    const hasAmount = entered.isFinite() && entered.isGreaterThan(0);
    const belowMinimum = hasAmount && !!pair && entered.isLessThan(pair.min);
    const overBalance =
        hasAmount && isBuyingBitcoin(direction) && balance !== null && entered.isGreaterThan(balance);

    let note = formatRateLine(rate, direction) ?? 'Getting the price...';
    let noteIsWarning = false;
    if (priceFailed) {
        note = 'Could not get a price right now.';
        noteIsWarning = true;
    } else if (belowMinimum && pair) {
        note =
            sendAsset === 'USDT'
                ? `The smallest swap is ${formatUsdtExact(pair.min)} USDT.`
                : `The smallest swap is ${formatBitcoinAmount(pair.min)} BTC.`;
        noteIsWarning = true;
    } else if (overBalance && balance !== null) {
        note = `That is more than your ${formatUsdtAmount(balance)} USDT.`;
        noteIsWarning = true;
    }

    const canSwap = !preview && hasAmount && converted !== null && !belowMinimum && !overBalance;

    // Undefined in preview: the buttons render as shapes that do nothing.
    const onGuide = preview ? undefined : () => dispatchNavigate('UsdtSwapsGuide');
    const onReceive = preview ? undefined : () => dispatchNavigate('UsdtReceive');
    const onFlip = preview
        ? undefined
        : () => {
              // The amount belongs to the asset it was typed for, so it does
              // not carry across: 250 USDT flipped would read as 250 BTC.
              setDirection((current) => flipDirection(current));
              setTyped('');
              setPriced('');
              setPair(null);
          };
    // A swap under way, or one that ended but has not been dismissed, is
    // shown again rather than a new one started: while its deposit could
    // still land, starting another could pay twice. Waits for the stored swap
    // to be read back, since that decides which it is.
    const onSwap = !canSwap
        ? undefined
        : () => {
              void whenUsdtSwapStoreReady().then(() => {
                  if (useUsdtSwapStore.getState().record) {
                      dispatchNavigate('UsdtSwapProgress');
                      return;
                  }
                  dispatchNavigate('UsdtSwapConfirm', {
                      direction,
                      sendAmount: normalized,
                      receiveAmount: converted,
                      rate,
                  });
              });
          };
    // A send under way, or one that ended but has not been dismissed, is shown
    // again rather than a new one started: while its transfer could still
    // land, starting another could pay twice.
    const onSend = preview
        ? undefined
        : () => {
              void whenUsdtSendStoreReady().then(() =>
                  dispatchNavigate(useUsdtSendStore.getState().record ? 'UsdtSendReview' : 'UsdtSend'),
              );
          };

    return (
        <View style={styles.container} pointerEvents={preview ? 'none' : 'auto'}>
            <View style={styles.rowContainer}>
                <LinearBorderView height={CARD_HEIGHT} width={CARD_WIDTH} style={styles.frame}>
                    <View style={styles.card}>
                        {/* Section one: what is in the wallet, and the two
                            ways to move it. */}
                        <View style={styles.labelRow}>
                            {/* Long press is the way into the success preview in
                                development. Delete with that screen. The shared
                                Text takes no press props, hence the wrapper. */}
                            <TouchableOpacity
                                onLongPress={
                                    __DEV__ && !preview ? () => dispatchNavigate('UsdtSuccessPreview') : undefined
                                }
                                delayLongPress={600}
                                activeOpacity={1}
                                accessibilityRole="text"
                            >
                                <Text bold style={styles.balanceLabel}>{USDT_ASSET_LABEL}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={onGuide}
                                disabled={!onGuide}
                                style={styles.helpButton}
                                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                accessibilityRole="button"
                                accessibilityLabel="How Bitcoin-USDT swaps work"
                            >
                                <Text bold style={styles.helpText}>?</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.balanceRow}>
                            <View style={styles.balanceBlock}>
                                {balanceText !== null ? (
                                    <Text bold style={styles.balanceAmount} numberOfLines={1} adjustsFontSizeToFit>
                                        {`${balanceText} USDT`}
                                    </Text>
                                ) : balanceError ? (
                                    <TouchableOpacity
                                        onPress={() => setReloadKey((k) => k + 1)}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${balanceError}. Tap to try again.`}
                                    >
                                        <Text style={styles.balanceProblem} numberOfLines={2}>
                                            {`${balanceError}. Tap to retry.`}
                                        </Text>
                                    </TouchableOpacity>
                                ) : (
                                    <ActivityIndicator size="small" color={colors.usdt.light} />
                                )}
                            </View>
                            <View style={styles.smallButtons}>
                                <ActionButton label="Receive" onPress={onReceive} small />
                                <ActionButton label="Send" onPress={onSend} small spaced />
                            </View>
                        </View>

                        <View style={styles.rule} />

                        {/* Section two: the converter and the one button that
                            leaves the card with it. */}
                        <View style={styles.fields}>
                            <View style={[styles.field, styles.fieldActive]}>
                                <TextInput
                                    style={styles.fieldInput}
                                    value={amountIn}
                                    onChangeText={(text) =>
                                        setTyped(sanitizeTypedAmount(text, typedDecimalsFor(direction)))
                                    }
                                    editable={!preview}
                                    keyboardType="decimal-pad"
                                    placeholder="0"
                                    placeholderTextColor="#666"
                                    accessibilityLabel={`Amount to swap, in ${sendAsset}`}
                                />
                                <Text bold style={[styles.fieldUnit, { color: sendColor }]}>{sendAsset}</Text>
                            </View>

                            <View style={styles.field}>
                                <Text
                                    bold
                                    style={
                                        converted === null
                                            ? [styles.fieldValue, styles.fieldValueQuiet]
                                            : styles.fieldValue
                                    }
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                >
                                    {receiveText}
                                </Text>
                                <Text bold style={[styles.fieldUnit, { color: receiveColor }]}>{receiveAsset}</Text>
                            </View>

                            <TouchableOpacity
                                style={styles.flipButton}
                                onPress={onFlip}
                                disabled={!onFlip}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityRole="button"
                                accessibilityLabel={
                                    isBuyingBitcoin(direction) ? 'Switch to selling bitcoin' : 'Switch to buying bitcoin'
                                }
                            >
                                <Ionicons name="swap-vertical" size={16} color={colors.usdt.light} />
                            </TouchableOpacity>
                        </View>

                        <Text style={noteIsWarning ? [styles.note, styles.noteWarning] : styles.note} numberOfLines={1}>
                            {note}
                        </Text>

                        <View style={styles.swapRow}>
                            <ActionButton label="Swap" onPress={onSwap} dimmed={!canSwap && !preview} />
                        </View>
                    </View>
                </LinearBorderView>
            </View>
        </View>
    );
}
