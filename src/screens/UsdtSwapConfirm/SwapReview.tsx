import BigNumber from "bignumber.js";
import { useNavigation } from "@react-navigation/native";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { getTronConversionTerms, type TronConversionTerms } from "@Cypher/api/flashnetAPIs";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import { RECOMMENDED_SWAP_USDT, USDT_ASSET_LABEL } from "@Cypher/services/tron/constants";
import { prepareBitcoinSale } from "@Cypher/services/tron/sellConversion";
import { formatUsdtAmount, formatUsdtExact } from "@Cypher/services/tron/format";
import {
    type SwapDirection,
    formatBitcoinAmount,
    formatRateLine,
    isBuyingBitcoin,
    receiveAssetOf,
    satsFromBitcoin,
    sendAssetOf,
} from "@Cypher/services/tron/swapConvert";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { invoiceForSwapPayout, isLightningPayoutWallet } from "./lightningPayout";
import { addressForVaultPayout, findVaultWallet, isVaultPayoutWallet } from "./vaultPayout";
import WalletPicker, { WALLET_LABEL, type SwapWallet, useAvailableSwapWallets } from "./WalletPicker";
import styles, { review } from "./styles";

type Props = {
    readonly direction: SwapDirection;
    /** The asset being spent, as the card worked it out. Decimal string. */
    readonly sendAmount: string;
    /** The asset being received, at the card's rate. Decimal string. */
    readonly receiveAmount: string;
    /** The card's indicative rate, settle per deposit unit, or null. */
    readonly rate: string | null;
};

/** One line of the fee breakdown. */
function FeeRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={review.feeRow}>
            <Text style={review.feeLabel}>{label}</Text>
            <Text style={review.feeValue}>{value}</Text>
        </View>
    );
}

/** An amount and what it is, as the block at the top of the review shows it. */
function Amount({ label, value, unit, sub }: { label: string; value: string; unit: string; sub?: string }) {
    return (
        <View>
            <Text style={review.amountLabel}>{label}</Text>
            <Text bold style={review.amountValue} numberOfLines={1} adjustsFontSizeToFit>
                {`${value} ${unit}`}
            </Text>
            {!!sub && <Text style={review.amountSub}>{sub}</Text>}
        </View>
    );
}

/**
 * Review a swap started from the USDT card's converter.
 *
 * The card fixed the direction and the two amounts; this screen says what they
 * cost and asks which wallet the bitcoin side uses. Buying, that is where the
 * bitcoin is deposited. Selling, it is where the bitcoin is taken from, and the
 * USDT comes back to this wallet's own Tron address, which is shown rather than
 * asked for.
 *
 * The figures here are the card's, at Flashnet's indicative rate, and the fee
 * lines are the backend's published terms. Neither is a quote. Booking the
 * quote and paying it is QuoteConfirm's job, and wiring a chosen wallet
 * through to a payout address is the step after this one: Continue says so
 * rather than pretending to start a swap.
 */
export default function SwapReview({ direction, sendAmount, receiveAmount, rate }: Props) {
    const { walletID, coldStorageWalletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);
    const available = useAvailableSwapWallets();

    const navigation = useNavigation<any>();
    const [wallet, setWallet] = useState<SwapWallet | null>(null);
    const [terms, setTerms] = useState<TronConversionTerms | null>(null);
    /** Asking the chosen wallet for an invoice. A latch, so one tap asks once. */
    const [gettingInvoice, setGettingInvoice] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const askingRef = useRef(false);

    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);

    useEffect(() => {
        let alive = true;
        // Never throws: falls back to the measured terms when the backend is slow.
        void getTronConversionTerms().then((t) => {
            if (alive) setTerms(t);
        });
        return () => {
            alive = false;
        };
    }, []);

    const buying = isBuyingBitcoin(direction);
    const sendAsset = sendAssetOf(direction);
    const receiveAsset = receiveAssetOf(direction);

    const sendText = sendAsset === 'USDT' ? formatUsdtExact(sendAmount) : formatBitcoinAmount(sendAmount);
    const receiveText = receiveAsset === 'USDT' ? formatUsdtAmount(receiveAmount) : formatBitcoinAmount(receiveAmount);
    const receiveSub = receiveAsset === 'BTC' ? `${satsFromBitcoin(receiveAmount)} sats` : undefined;
    const sendSub = sendAsset === 'BTC' ? `${satsFromBitcoin(sendAmount)} sats` : undefined;

    // The published terms price a USDT deposit on Tron, which is the buying
    // direction. Selling deposits bitcoin instead, so those figures do not
    // apply and the rate is all this screen can honestly attribute.
    const fees = useMemo(() => {
        if (!buying || !terms) return null;
        const sent = new BigNumber(sendAmount);
        const proportional = sent.multipliedBy(terms.rateFee);
        const service = new BigNumber(terms.flatFee).plus(proportional);
        const total = new BigNumber(terms.charge).plus(service);
        // Each fee as a share of what is being sent. The Tron cost is flat, so
        // its percentage is the figure that actually moves with the amount:
        // it is most of the cost on a small swap and nearly none on a large
        // one, and only a percentage shows that.
        const share = (part: BigNumber) =>
            sent.isGreaterThan(0) ? `${part.dividedBy(sent).multipliedBy(100).toFixed(2)}%` : null;
        const money = (part: BigNumber) => `${part.decimalPlaces(2, BigNumber.ROUND_UP).toFixed(2)} USDT`;
        const line = (part: BigNumber) => {
            const pct = share(part);
            return pct ? `${pct}, ${money(part)}` : money(part);
        };
        return {
            charge: line(new BigNumber(terms.charge)),
            service: line(service),
            total: line(total),
            rateFeePercent: new BigNumber(terms.rateFee).multipliedBy(100).decimalPlaces(2).toFixed(),
        };
    }, [buying, terms, sendAmount]);

    const rateLine = formatRateLine(rate, direction);
    // Allowed, just poor value. Never a reason to block: the floor that
    // refuses is the backend's, and this only explains the tradeoff.
    const smallSwap = buying && new BigNumber(sendAmount).isLessThan(RECOMMENDED_SWAP_USDT);
    const pickerTitle = buying ? 'DEPOSIT BITCOIN TO' : 'SELL BITCOIN FROM';

    const onContinue = async () => {
        if (!wallet || askingRef.current) return;
        if (!buying) {
            // Only the vaults can sell. A refund goes back to the wallet the
            // bitcoin left, and the Lightning rails have no durable address to
            // send one to, so there is nothing to quote with.
            if (!isVaultPayoutWallet(wallet)) {
                setProblem(`Selling bitcoin from ${WALLET_LABEL[wallet]} is not available yet.`);
                return;
            }
            if (!account) {
                setProblem('Your USDT arrives in your Hot Vault, and this phone no longer has one.');
                return;
            }
            askingRef.current = true;
            setGettingInvoice(true);
            setProblem(null);
            try {
                const vaultIds = { hot: walletID, cold: coldStorageWalletID };
                const vaultWallet = findVaultWallet(wallet, wallets || [], vaultIds);
                if (!vaultWallet) {
                    setProblem(`This phone no longer has a ${WALLET_LABEL[wallet]}.`);
                    return;
                }
                // The refund has to land back in the vault the coins left.
                const refundAddress = await addressForVaultPayout(wallet, wallets || [], vaultIds);
                const prepared = await prepareBitcoinSale({
                    amountBtc: sendAmount,
                    settleAddress: account.address,
                    refundAddress,
                });
                const depositSats = new BigNumber(prepared.depositAmount)
                    .shiftedBy(8)
                    .integerValue(BigNumber.ROUND_CEIL)
                    .toNumber();
                // Into the vault's own send, which is the only thing that
                // spends coins: it takes the capsule selection, prices the
                // miner fee, routes change and broadcasts. The amount is
                // carried as exact sats so nothing re-derives it from a rate.
                navigation.push('HotStorageVault', {
                    wallet: vaultWallet,
                    currency: 'USD',
                    matchedRate: new BigNumber(prepared.settleAmount).dividedBy(prepared.depositAmount).toFixed(2),
                    sale: {
                        depositAddress: prepared.depositAddress,
                        depositSats,
                        settleUsd: prepared.settleAmount,
                        usdPerBtc: new BigNumber(prepared.settleAmount).dividedBy(prepared.depositAmount).toFixed(2),
                    },
                });
            } catch (error) {
                setProblem(
                    error instanceof Error && error.message
                        ? error.message
                        : 'Could not price this sale. Try again.',
                );
            } finally {
                askingRef.current = false;
                setGettingInvoice(false);
            }
            return;
        }
        askingRef.current = true;
        setGettingInvoice(true);
        setProblem(null);
        try {
            // Each wallet answers with the one thing a swap needs to pay it.
            // Lightning gives an invoice for a named amount, so that swap is
            // priced backwards from it. A vault gives a receive address and no
            // amount, so the user's USDT stays the amount, priced exact_in.
            let destination: string;
            if (isLightningPayoutWallet(wallet)) {
                const sats = new BigNumber(receiveAmount).shiftedBy(8).integerValue(BigNumber.ROUND_DOWN).toNumber();
                destination = await invoiceForSwapPayout(wallet, sats);
            } else if (isVaultPayoutWallet(wallet)) {
                destination = await addressForVaultPayout(wallet, wallets || [], {
                    hot: walletID,
                    cold: coldStorageWalletID,
                });
            } else {
                setProblem(`Sending the bitcoin to your ${WALLET_LABEL[wallet]} is not available yet.`);
                return;
            }
            // The quote step takes it from here: it classifies the destination,
            // prices the swap and is the only path that books and pays. Pushed
            // rather than navigated, so this screen's own params are not
            // rewritten underneath it.
            navigation.push('UsdtSwapConfirm', { amount: sendAmount, destination });
        } catch (error) {
            setProblem(
                error instanceof Error && error.message
                    ? error.message
                    : `Could not get a destination from your ${WALLET_LABEL[wallet]}.`,
            );
        } finally {
            askingRef.current = false;
            setGettingInvoice(false);
        }
    };

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Review swap">
            <ScrollView style={styles.main} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={review.amounts}>
                    <Amount label="YOU SEND" value={sendText} unit={sendAsset === 'USDT' ? USDT_ASSET_LABEL : sendAsset} sub={sendSub} />
                    <Text style={review.arrow}>{buying ? 'Buying bitcoin' : 'Selling bitcoin'}</Text>
                    <Amount label="YOU RECEIVE" value={receiveText} unit={receiveAsset === 'USDT' ? USDT_ASSET_LABEL : receiveAsset} sub={receiveSub} />
                    {!!rateLine && <Text style={review.rateLine}>{rateLine}</Text>}
                </View>

                {fees ? (
                    <View style={review.section}>
                        <Text style={review.sectionTitle}>FEES</Text>
                        <FeeRow label="Tron network cost" value={fees.charge} />
                        <FeeRow label={`Cypher Box fee, ${fees.rateFeePercent}% plus a flat part`} value={fees.service} />
                        <FeeRow label="Total, taken from what you send" value={fees.total} />
                        {smallSwap && (
                            <Text style={review.rateLine}>
                                {`The Tron network cost is the same whatever you send, so it is a bigger share of a small swap. From ${formatUsdtExact(RECOMMENDED_SWAP_USDT)} USDT up it barely registers.`}
                            </Text>
                        )}
                    </View>
                ) : (
                    <View style={review.section}>
                        <Text style={review.sectionTitle}>FEES</Text>
                        <Text style={review.feeLabel}>
                            Fees are included in the rate above. The quote states them exactly before you pay.
                        </Text>
                    </View>
                )}

                {available.length > 0 ? (
                    <WalletPicker
                        title={pickerTitle}
                        available={available}
                        selected={wallet}
                        onSelect={setWallet}
                    />
                ) : (
                    <View style={review.section}>
                        <Text style={review.sectionTitle}>{pickerTitle}</Text>
                        <Text style={review.feeLabel}>
                            This phone has no bitcoin wallet to use yet. Create a vault or connect an account first.
                        </Text>
                    </View>
                )}

                {!buying && (
                    <View style={review.section}>
                        <Text style={review.sectionTitle}>TO YOUR USDT TRON ADDRESS</Text>
                        <View style={review.addressBox}>
                            <Text style={review.addressValue}>
                                {account?.address ?? 'No Tron address on this phone.'}
                            </Text>
                        </View>
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                {problem ? (
                    <Text style={[styles.caution, review.problem]}>{problem}</Text>
                ) : (
                    <Text style={styles.caution}>
                        These figures are indicative. You see the exact amounts in the quote before anything is sent.
                    </Text>
                )}
                {gettingInvoice ? (
                    <ActivityIndicator size="small" color={colors.usdt.light} />
                ) : (
                    <GradientButton
                        style={styles.button}
                        title="Continue"
                        disabled={!wallet}
                        onPress={() => void onContinue()}
                        colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                    />
                )}
            </View>
        </ScreenLayout>
    );
}
