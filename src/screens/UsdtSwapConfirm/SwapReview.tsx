import BigNumber from "bignumber.js";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { getTronConversionTerms, type TronConversionTerms } from "@Cypher/api/flashnetAPIs";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
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
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);
    const available = useAvailableSwapWallets();

    const [wallet, setWallet] = useState<SwapWallet | null>(null);
    const [terms, setTerms] = useState<TronConversionTerms | null>(null);

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
        const proportional = new BigNumber(sendAmount).multipliedBy(terms.rateFee);
        const service = new BigNumber(terms.flatFee).plus(proportional);
        const total = new BigNumber(terms.charge).plus(service);
        return {
            charge: terms.charge,
            service: service.decimalPlaces(2, BigNumber.ROUND_UP).toFixed(2),
            rateFeePercent: new BigNumber(terms.rateFee).multipliedBy(100).decimalPlaces(2).toFixed(),
            total: total.decimalPlaces(2, BigNumber.ROUND_UP).toFixed(2),
        };
    }, [buying, terms, sendAmount]);

    const rateLine = formatRateLine(rate, direction);
    const pickerTitle = buying ? 'DEPOSIT BITCOIN TO' : 'SELL BITCOIN FROM';

    const onContinue = () => {
        if (!wallet) return;
        SimpleToast.show(
            `Swapping ${buying ? 'to' : 'from'} ${WALLET_LABEL[wallet]} is not available yet`,
            SimpleToast.SHORT,
        );
    };

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Review swap">
            <ScrollView style={styles.main} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={review.amounts}>
                    <Amount label="YOU SEND" value={sendText} unit={sendAsset} sub={sendSub} />
                    <Text style={review.arrow}>{buying ? 'Buying bitcoin' : 'Selling bitcoin'}</Text>
                    <Amount label="YOU RECEIVE" value={receiveText} unit={receiveAsset} sub={receiveSub} />
                    {!!rateLine && <Text style={review.rateLine}>{rateLine}</Text>}
                </View>

                {fees ? (
                    <View style={review.section}>
                        <Text style={review.sectionTitle}>FEES</Text>
                        <FeeRow label="Tron network cost" value={`${formatUsdtExact(fees.charge)} USDT`} />
                        <FeeRow label={`Cypher Box fee, ${fees.rateFeePercent}% plus a flat part`} value={`${fees.service} USDT`} />
                        <FeeRow label="Total, taken from what you send" value={`${fees.total} USDT`} />
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
                        <Text style={review.sectionTitle}>TO YOUR USDT ADDRESS</Text>
                        <View style={review.addressBox}>
                            <Text style={review.addressValue}>
                                {account?.address ?? 'No Tron address on this phone.'}
                            </Text>
                        </View>
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                <Text style={styles.caution}>
                    These figures are indicative. You see the exact amounts in the quote before anything is sent.
                </Text>
                <GradientButton
                    style={styles.button}
                    title="Continue"
                    disabled={!wallet}
                    onPress={onContinue}
                    colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                />
            </View>
        </ScreenLayout>
    );
}
