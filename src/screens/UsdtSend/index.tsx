import BigNumber from "bignumber.js";
import Clipboard from "@react-native-clipboard/clipboard";
import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Keyboard, TextInput, TouchableOpacity, View } from "react-native";
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
    parseTronPaymentRequest,
} from "@Cypher/services/tron/sendForm";
import { applySwapAmountKey, normalizeSwapAmount, type SwapAmountKey } from "@Cypher/services/tron/swapAmount";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import styles from "./styles";

const KEYS: SwapAmountKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/**
 * Send USDT on Tron: the whole thing, on one screen.
 *
 * This was three screens, an amount, a destination and a review, which is two
 * more than a transfer with no fee to choose deserves. Amount and address are
 * the only two things a user supplies, so they are asked for together, and the
 * review is the one screen after this.
 *
 * There is no fee control on purpose. The Tron network cost is paid by our
 * backend rather than out of the amount, so there is no rate to pick and
 * nothing to trade off. The screen says so instead of offering a slider that
 * changes nothing.
 *
 * Both fields are checked as they are filled in, and neither check is the last
 * word: the review screen reads the chain again before anything is signed.
 */
export default function UsdtSend() {
    const navigation = useNavigation<any>();
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);
    const address = account?.address ?? null;

    const [amount, setAmount] = useState('');
    const [raw, setRaw] = useState('');
    const [balance, setBalance] = useState<string | null>(null);
    const [balanceFailed, setBalanceFailed] = useState(false);

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

    const onPaste = useCallback(async () => {
        const pasted = await Clipboard.getString().catch(() => '');
        if (!pasted) {
            SimpleToast.show('Clipboard empty', SimpleToast.SHORT);
            return;
        }
        setRaw(pasted.trim());
    }, []);

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
                            const { destination: scanned, amount: asked } = parseTronPaymentRequest(value, address);
                            // The address goes in either way, so a refusal is
                            // read under the field rather than in a toast that
                            // leaves the user nothing to look at.
                            setRaw(scanned.value);
                            // A code that asked for an amount fills it in. Still
                            // editable: it is a request, not an instruction.
                            if (asked) setAmount(asked);
                        },
                    },
                });
            })
            .catch(() => SimpleToast.show('Camera permission needed to scan', SimpleToast.SHORT));
    }, [navigation, address]);

    const destination = useMemo(() => classifyTronSendDestination(raw, address), [raw, address]);
    const amountCheck = checkSendAmount(amount, { balance });
    const addressEmpty = raw.trim().length === 0;
    const canContinue = !!account && amountCheck.ok && destination.kind === 'tron';

    const onContinue = () => {
        if (!canContinue) return;
        Keyboard.dismiss();
        dispatchNavigate('UsdtSendReview', {
            amount: normalizeSwapAmount(amount),
            destination: destination.value,
        });
    };

    // One line, and the amount's problem comes first: it is the field the
    // keypad is pointed at.
    let hint = 'The Tron network cost is covered, so this is exactly what arrives.';
    let hintIsWarning = false;
    if (!account) {
        // Only reachable if the Hot Vault goes while this screen is open: the
        // card that leads here needs one to exist.
        hint = 'Your USDT comes from your Hot Vault, and this phone no longer has one.';
        hintIsWarning = true;
    } else if (!amountCheck.ok && amountCheck.code === 'INSUFFICIENT_USDT') {
        hint = `That is more than your ${formatUsdtAmount(amountCheck.balance)} USDT.`;
        hintIsWarning = true;
    } else if (!addressEmpty && destination.kind === 'invalid') {
        hint = describeSendDestinationProblem(destination.problem);
        hintIsWarning = true;
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

                <View style={destination.kind === 'tron' ? [styles.field, styles.fieldGood] : styles.field}>
                    <TextInput
                        style={styles.input}
                        placeholder="Tron address, starting with T"
                        placeholderTextColor="#666"
                        value={raw}
                        onChangeText={setRaw}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        returnKeyType="done"
                        blurOnSubmit
                        onSubmitEditing={() => Keyboard.dismiss()}
                        accessibilityLabel="Tron address to send to"
                    />
                    <TouchableOpacity style={styles.fieldButton} onPress={onPaste} accessibilityRole="button">
                        <Text style={styles.fieldButtonText}>PASTE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.fieldButton} onPress={onScan} accessibilityRole="button">
                        <Image source={QrCode} style={styles.scanIcon} resizeMode="contain" />
                    </TouchableOpacity>
                </View>

                <Text
                    style={hintIsWarning ? [styles.hint, styles.hintWarning] : styles.hint}
                    numberOfLines={2}
                >
                    {hint}
                </Text>

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
