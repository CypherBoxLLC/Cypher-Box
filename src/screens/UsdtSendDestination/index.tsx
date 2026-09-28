import Clipboard from "@react-native-clipboard/clipboard";
import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useContext, useMemo, useState } from "react";
import { Keyboard, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import { ScreenLayout, Text } from "@Cypher/component-library";
import { GradientButton } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { resolveHotVaultTronAccount } from "@Cypher/services/tron/account";
import { USDT_ASSET_LABEL } from "@Cypher/services/tron/constants";
import { formatUsdtExact } from "@Cypher/services/tron/format";
import { classifyTronSendDestination, describeSendDestinationProblem } from "@Cypher/services/tron/sendForm";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";

import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
// Same geometry as the swap flow's destination step, deliberately.
import styles from "../UsdtSwapDestination/styles";

interface Props {
    route: { params?: { amount?: string } };
}

/**
 * Send USDT on Tron, step two: where it goes.
 *
 * A Tron address, typed, pasted or scanned, classified as it is entered. The
 * refusals matter more here than anywhere else in this feature: USDT exists on
 * several chains under the same ticker, a Tron transfer cannot be recalled,
 * and an address for another chain is the way people actually lose it. So each
 * wrong kind is named rather than lumped into "invalid address".
 */
export default function UsdtSendDestination({ route }: Props) {
    const amount = route?.params?.amount ?? '';
    const navigation = useNavigation<any>();
    const { walletID } = useAuthStore();
    const { wallets } = useContext(BlueStorageContext);

    const [raw, setRaw] = useState('');

    // Memoised: the derivation runs BIP39's PBKDF2 over 2048 rounds. Only used
    // to recognise this wallet's own address and refuse it.
    const account = useMemo(() => resolveHotVaultTronAccount(wallets, walletID), [wallets, walletID]);

    const destination = useMemo(
        () => classifyTronSendDestination(raw, account?.address ?? null),
        [raw, account],
    );
    const empty = raw.trim().length === 0;
    const usable = destination.kind === 'tron';

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

    const onContinue = () => {
        if (!usable) return;
        Keyboard.dismiss();
        dispatchNavigate('UsdtSendReview', { amount, destination: destination.value });
    };

    const status = usable ? (
        <View style={styles.pill}>
            <Text style={styles.pillText}>Tron address</Text>
        </View>
    ) : (
        <Text style={empty ? styles.status : [styles.status, styles.statusWarning]}>
            {describeSendDestinationProblem(destination.problem)}
        </Text>
    );

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title={`Send ${USDT_ASSET_LABEL}`}>
            <ScrollView
                style={styles.main}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Text bold style={styles.heading}>Where should the USDT go?</Text>
                {!!amount && (
                    <Text style={styles.subheading}>{`Sending ${formatUsdtExact(amount)} USDT on Tron`}</Text>
                )}

                <View style={styles.inputWrap}>
                    <TextInput
                        style={styles.input}
                        placeholder="Tron address, starting with T"
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

                {usable && (
                    <Text style={styles.note}>
                        This sends over the Tron network only. Make sure the wallet you are sending to accepts
                        USDT on Tron, sometimes called TRC-20. USDT sent on the wrong network cannot be recovered.
                    </Text>
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
