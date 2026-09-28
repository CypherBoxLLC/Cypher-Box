import BigNumber from "bignumber.js";
import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { Cancel, QrCode } from "@Cypher/assets/images";
import { dispatchNavigate } from "@Cypher/helpers";
import { getTronUsdtBalance } from "@Cypher/api/tronAPIs";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import { USDT_ASSET_LABEL } from "@Cypher/services/tron/constants";
import { formatUsdtAmount } from "@Cypher/services/tron/format";
import {
    checkSendAmount,
    classifyTronSendDestination,
    describeSendDestinationProblem,
} from "@Cypher/services/tron/sendForm";
import { applySwapAmountKey, normalizeSwapAmount, type SwapAmountKey } from "@Cypher/services/tron/swapAmount";
import { shortDestination } from "@Cypher/services/tron/swapMessages";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
// The send flow is the swap flow's twin, step for step, so it wears the same
// geometry rather than a second copy of it that can drift.
import styles from "../UsdtSwapAmount/styles";
import { scan } from "./styles";

const KEYS: SwapAmountKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/**
 * Send USDT on Tron, step one: how much.
 *
 * Unlike a swap there is no venue minimum, so the only rules are that the
 * amount is above zero and within the balance. Neither is the last word: the
 * review screen reads the chain again before anything is signed.
 *
 * The network cost is not taken out of the amount, so what is entered here is
 * what arrives. That is worth saying on this screen, because it is the
 * opposite of the swap flow beside it.
 */
export default function UsdtSendAmount() {
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);
    const address = account?.address ?? null;

    const navigation = useNavigation<any>();
    const [amount, setAmount] = useState('');
    const [balance, setBalance] = useState<string | null>(null);
    const [balanceFailed, setBalanceFailed] = useState(false);
    /** A Tron address scanned here, carried to the next step already filled in. */
    const [scanned, setScanned] = useState<string | null>(null);

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
    const onSendAll = useCallback(() => {
        if (balance) setAmount(normalizeSwapAmount(balance));
    }, [balance]);

    // Scanning is offered from the first step as well as the second, because
    // the address is usually what the user has in front of them. It is not
    // acted on here: the scan fills the next step in, which is the one place
    // that decides whether an address can be sent to.
    const onScan = useCallback(() => {
        requestCameraAuthorization()
            .then(() => {
                navigation.navigate('ScanQRCodeRoot', {
                    screen: 'ScanQRCode',
                    params: {
                        showFileImportButton: false,
                        onBarScanned: (ret: any) => {
                            // The scanner is a modal stack: pop it so this
                            // screen is what is left. It hands a plain string
                            // back for a plain address and an object for the
                            // formats it decodes, so both are taken.
                            navigation.getParent()?.pop();
                            const value = (typeof ret === 'string' ? ret : ret?.data ?? '').trim();
                            if (!value) {
                                SimpleToast.show('No data in QR code', SimpleToast.SHORT);
                                return;
                            }
                            const destination = classifyTronSendDestination(value, address);
                            if (destination.kind !== 'tron') {
                                SimpleToast.show(describeSendDestinationProblem(destination.problem), SimpleToast.LONG);
                                return;
                            }
                            setScanned(destination.value);
                        },
                    },
                });
            })
            .catch(() => SimpleToast.show('Camera permission needed to scan', SimpleToast.SHORT));
    }, [navigation, address]);

    const check = checkSendAmount(amount, { balance });
    const canContinue = !!account && check.ok;

    const onContinue = () => {
        if (!canContinue) return;
        dispatchNavigate('UsdtSendDestination', {
            amount: normalizeSwapAmount(amount),
            ...(scanned ? { destination: scanned } : {}),
        });
    };

    let hint = 'The network cost is paid separately, so this is what arrives.';
    let hintIsWarning = false;
    if (!account) {
        // Only reachable if the Hot Vault goes while this screen is open: the
        // card that leads here needs one to exist.
        hint = 'Your USDT comes from your Hot Vault, and this phone no longer has one.';
        hintIsWarning = true;
    } else if (!check.ok && check.code === 'INSUFFICIENT_USDT') {
        hintIsWarning = true;
        hint = `That is more than your ${formatUsdtAmount(check.balance)} USDT.`;
    }

    const canSendAll = balance !== null && new BigNumber(balance).isGreaterThan(0);

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title={`Send ${USDT_ASSET_LABEL}`}>
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
                    {canSendAll && (
                        <TouchableOpacity style={styles.allButton} onPress={onSendAll} accessibilityRole="button">
                            <Text bold style={styles.allButtonText}>Send all</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <Text style={hintIsWarning ? [styles.hint, styles.hintWarning] : styles.hint}>{hint}</Text>

                <TouchableOpacity
                    style={scanned ? [scan.button, scan.buttonFilled] : scan.button}
                    onPress={onScan}
                    accessibilityRole="button"
                    accessibilityLabel={scanned ? 'Scanned address, tap to scan another' : 'Scan a QR code'}
                >
                    <Image source={QrCode} style={scan.icon} resizeMode="contain" />
                    <Text bold style={scan.label} numberOfLines={1}>
                        {scanned ? `To ${shortDestination(scanned)}` : 'Scan a QR code'}
                    </Text>
                </TouchableOpacity>

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
                            {key === 'back' ? <Image source={Cancel} /> : <Text style={styles.keyText}>{key}</Text>}
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
