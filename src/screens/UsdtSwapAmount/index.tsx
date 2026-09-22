import BigNumber from "bignumber.js";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, TouchableOpacity, View } from "react-native";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { Cancel } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { getTronConversionTerms } from "@Cypher/api/flashnetAPIs";
import { getTronUsdtBalance } from "@Cypher/api/tronAPIs";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import { formatUsdtAmount, formatUsdtExact } from "@Cypher/services/tron/format";
import {
    applySwapAmountKey,
    checkSwapAmount,
    normalizeSwapAmount,
    type SwapAmountKey,
} from "@Cypher/services/tron/swapAmount";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import styles from "./styles";

const KEYS: SwapAmountKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/**
 * Swap USDT to bitcoin, step one: how much USDT.
 *
 * Reached from Swap on the USDT card. The amount is checked here against the
 * backend's minimum (BELOW_MINIMUM, the same refusal prepareUsdtConversion
 * gives) and the balance on chain, before a destination is asked for. Neither
 * check is the last word: the confirm screen's quote checks both again.
 *
 * No price is shown here. What arrives depends on where it goes, Lightning or
 * on chain, which is the next step, and the only figure worth showing is the
 * quote's, on the confirm screen.
 */
export default function UsdtSwapAmount() {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);
    const address = account?.address ?? null;

    const [amount, setAmount] = useState('');
    const [balance, setBalance] = useState<string | null>(null);
    const [balanceFailed, setBalanceFailed] = useState(false);
    const [minimum, setMinimum] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        // Never throws: falls back to the measured terms when the backend is slow.
        void getTronConversionTerms().then((terms) => {
            if (alive) setMinimum(terms.minimum);
        });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (!address) return undefined;
        let alive = true;
        setBalanceFailed(false);
        getTronUsdtBalance(address)
            .then((value) => {
                if (alive) setBalance(value);
            })
            .catch(() => {
                if (alive) setBalanceFailed(true);
            });
        return () => {
            alive = false;
        };
    }, [address]);

    const onKey = useCallback((key: SwapAmountKey) => setAmount((current) => applySwapAmountKey(current, key)), []);
    const onSwapAll = useCallback(() => {
        if (balance) setAmount(normalizeSwapAmount(balance));
    }, [balance]);

    const check = minimum === null ? null : checkSwapAmount(amount, { minimum, balance });
    const canContinue = !!account && check?.ok === true;

    const onContinue = () => {
        if (!canContinue) return;
        dispatchNavigate('UsdtSwapDestination', { amount: normalizeSwapAmount(amount) });
    };

    // One line under the amount: the minimum, or what is wrong with the amount.
    let hint = 'Fees come out of this amount. You see what arrives before you confirm.';
    let hintIsWarning = false;
    if (!account) {
        // Only reachable if the Hot Vault goes while this screen is open: the
        // card that leads here needs one to exist.
        hint = 'Your USDT comes from your Hot Vault, and this phone no longer has one.';
        hintIsWarning = true;
    } else if (minimum === null) {
        hint = 'Checking the smallest swap...';
    } else if (check && !check.ok) {
        const min = formatUsdtExact(minimum);
        if (check.code === 'EMPTY') {
            hint = `The smallest swap is ${min} USDT.`;
        } else if (check.code === 'BELOW_MINIMUM') {
            hintIsWarning = true;
            const short = balance !== null && new BigNumber(balance).isLessThan(minimum);
            hint = short
                ? `The smallest swap is ${min} USDT, and you have ${formatUsdtAmount(balance ?? '0')}. Receive more USDT first.`
                : `The smallest swap is ${min} USDT. Enter at least that much.`;
        } else {
            hintIsWarning = true;
            hint = `That is more than your ${formatUsdtAmount(check.balance)} USDT.`;
        }
    }
    const canSwapAll = balance !== null && new BigNumber(balance).isGreaterThan(0);

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Swap USDT to bitcoin">
            <View style={styles.main}>
                <View style={styles.amountBox}>
                    <Text bold style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
                        {amount || '0'}
                    </Text>
                    <Text bold style={styles.unit}>USDT</Text>
                </View>

                <View style={styles.balanceRow}>
                    {balance !== null ? (
                        <Text style={styles.balance}>{`Available: ${formatUsdtAmount(balance)} USDT`}</Text>
                    ) : balanceFailed ? (
                        <Text style={styles.balance}>Could not read your balance right now.</Text>
                    ) : account ? (
                        <ActivityIndicator size="small" color={colors.usdt.light} />
                    ) : null}
                    {canSwapAll && (
                        <TouchableOpacity style={styles.allButton} onPress={onSwapAll} accessibilityRole="button">
                            <Text bold style={styles.allButtonText}>Swap all</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <Text style={hintIsWarning ? [styles.hint, styles.hintWarning] : styles.hint}>{hint}</Text>

                <View style={styles.spacer} />

                <View style={styles.keypad}>
                    {KEYS.map((key) => (
                        <TouchableOpacity
                            key={key}
                            style={styles.key}
                            onPress={() => onKey(key)}
                            accessibilityRole="button"
                            accessibilityLabel={key === 'back' ? 'Delete' : key === '.' ? 'Decimal point' : key}
                        >
                            {key === 'back' ? (
                                <Image source={Cancel} />
                            ) : (
                                <Text style={styles.keyText}>{key}</Text>
                            )}
                        </TouchableOpacity>
                    ))}
                </View>

                <GradientButton
                    style={styles.continueButton}
                    title="Continue"
                    disabled={!canContinue}
                    onPress={onContinue}
                    colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                />
            </View>
        </ScreenLayout>
    );
}
