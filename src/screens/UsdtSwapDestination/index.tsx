import Clipboard from "@react-native-clipboard/clipboard";
import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Keyboard, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { formatUsdtExact } from "@Cypher/services/tron/format";
import {
    classifySwapDestination,
    describeSwapDestinationProblem,
    formatSats,
    labelForSwapDestination,
} from "@Cypher/services/tron/swapDestination";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import styles from "./styles";

/** How long to wait for the Hot Vault to hand out an address from its server before deriving one locally. */
const ADDRESS_TIMEOUT_MS = 1500;

interface Props {
    route: { params?: { amount?: string } };
}

/**
 * Swap USDT to bitcoin, step two: where the bitcoin goes.
 *
 * A Lightning invoice, a Lightning address or a bitcoin address, typed,
 * pasted, scanned, or the user's own Hot Vault. It is classified as it is
 * entered, the way the Ark send screen does, and anything a swap cannot pay is
 * refused here with what to do about it, before a quote is booked.
 *
 * An invoice that names its amount sets the swap's amount instead of the USDT
 * entered on the previous step, and the screen says so: that swap is priced
 * backwards from the invoice (exact_out).
 */
export default function UsdtSwapDestination({ route }: Props) {
    const amount = route?.params?.amount ?? '';
    const navigation = useNavigation<any>();
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    const [raw, setRaw] = useState('');
    const [fetchingVaultAddress, setFetchingVaultAddress] = useState(false);

    const destination = useMemo(() => classifySwapDestination(raw), [raw]);
    const empty = raw.trim().length === 0;
    const usable = destination.kind !== 'invalid';

    const hotVault = useMemo(
        () => (wallets || []).find((w: any) => typeof w?.getID === 'function' && w.getID() === walletID),
        [wallets, walletID],
    );

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
                            // screen is what is left.
                            navigation.getParent()?.pop();
                            const scanned = typeof ret === 'string' ? ret : ret?.data ?? '';
                            if (!scanned) {
                                SimpleToast.show('No data in QR code', SimpleToast.SHORT);
                                return;
                            }
                            setRaw(scanned.trim());
                        },
                    },
                });
            })
            .catch(() => SimpleToast.show('Camera permission needed to scan', SimpleToast.SHORT));
    }, [navigation]);

    // A fresh receive address from the Hot Vault: the one HomeScreen and the
    // buy flow use, from its server when it answers quickly, derived locally
    // otherwise.
    const onUseHotVault = useCallback(async () => {
        if (!hotVault || fetchingVaultAddress) return;
        setFetchingVaultAddress(true);
        let address: string | undefined;
        try {
            address = await Promise.race<any>([
                hotVault.getAddressAsync?.(),
                new Promise((resolve) => setTimeout(() => resolve(undefined), ADDRESS_TIMEOUT_MS)),
            ]);
        } catch {
            address = undefined;
        }
        if (!address && hotVault._getExternalAddressByIndex) {
            try {
                address = hotVault._getExternalAddressByIndex(hotVault.getNextFreeAddressIndex());
            } catch {
                address = undefined;
            }
        }
        setFetchingVaultAddress(false);
        if (!address) {
            SimpleToast.show('Could not get an address from your Hot Vault', SimpleToast.SHORT);
            return;
        }
        setRaw(address);
    }, [hotVault, fetchingVaultAddress]);

    const onContinue = () => {
        if (!usable) return;
        Keyboard.dismiss();
        dispatchNavigate('UsdtSwapConfirm', { amount, destination: destination.value });
    };

    // What was recognised as a pill, or what is wrong as a sentence.
    const status = usable ? (
        <View style={styles.pill}>
            <Text style={styles.pillText}>{labelForSwapDestination(destination)}</Text>
        </View>
    ) : (
        <Text style={empty ? styles.status : [styles.status, styles.statusWarning]}>
            {describeSwapDestinationProblem(destination.problem)}
        </Text>
    );

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title="Swap USDT to bitcoin">
            <ScrollView
                style={styles.main}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Text bold style={styles.heading}>Where should the bitcoin go?</Text>
                {!!amount && (
                    <Text style={styles.subheading}>{`Swapping ${formatUsdtExact(amount)} USDT`}</Text>
                )}

                <View style={styles.inputWrap}>
                    <TextInput
                        style={styles.input}
                        placeholder="Lightning invoice, Lightning address or bitcoin address"
                        placeholderTextColor="#666"
                        value={raw}
                        onChangeText={setRaw}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        multiline
                        returnKeyType="done"
                        blurOnSubmit
                        onSubmitEditing={() => Keyboard.dismiss()}
                    />
                    <TouchableOpacity style={styles.fieldButton} onPress={onPaste}>
                        <Text style={styles.fieldButtonText}>PASTE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.fieldButton} onPress={onScan}>
                        <Text style={styles.fieldButtonText}>SCAN</Text>
                    </TouchableOpacity>
                </View>

                {status}

                {destination.kind === 'ln-invoice' && destination.amountSats !== null && (
                    <Text style={styles.note}>
                        {`This invoice asks for ${formatSats(destination.amountSats)} sats, so it sets the amount instead of the ${formatUsdtExact(amount || '0')} USDT you entered. The USDT it takes is shown before you confirm.`}
                    </Text>
                )}
                {destination.kind === 'onchain' && (
                    <Text style={styles.note}>
                        On-chain bitcoin can take an hour or more to confirm. For bitcoin you can spend right away, use Lightning.
                    </Text>
                )}

                {!!hotVault && (
                    <TouchableOpacity
                        style={styles.vaultButton}
                        onPress={onUseHotVault}
                        disabled={fetchingVaultAddress}
                        accessibilityRole="button"
                    >
                        {fetchingVaultAddress ? (
                            <ActivityIndicator size="small" color={colors.usdt.light} />
                        ) : (
                            <Text bold style={styles.vaultButtonText}>Send to my Hot Vault</Text>
                        )}
                    </TouchableOpacity>
                )}
            </ScrollView>

            <View style={styles.footer}>
                <GradientButton
                    style={styles.continueButton}
                    title="Continue"
                    disabled={!usable}
                    onPress={onContinue}
                    colors_={[colors.usdt.gradient1, colors.usdt.gradient2]}
                />
            </View>
        </ScreenLayout>
    );
}
