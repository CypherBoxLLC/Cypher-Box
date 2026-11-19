import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { SwipeButton } from "@Cypher/components";
import { colors, rtl } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import loc from "../../../loc";
// with its title and button in the app's language (the global alert() titles it "Alert" in English)
import alert from "../../../components/Alert";
import Biometric from "../../../class/biometrics";
import Notifications from "../../../blue_modules/notifications";
import triggerHapticFeedback, { HapticFeedbackTypes } from "../../../blue_modules/hapticFeedback";
import { assertSignedTxMatchesPsbt, dispatchNavigate, formatSats, spendsPendingInputs, summarizeSignedTx } from "@Cypher/helpers";
import signedTxErrorText from "@Cypher/helpers/signedTxErrorText";
import useAuthStore from "@Cypher/stores/authStore";

const BlueElectrum = require('../../../blue_modules/BlueElectrum');
const bitcoin = require('bitcoinjs-lib');
const fs = require('../../../blue_modules/fs');

interface Props {
    route: any;
    navigation: any
}

export default function ConfirmHardwareTransaction({ route, navigation }: Props) {
    const { walletID = null, isCustomFee, txHex, fromWallet, sats, inUSD, sentFrom, destinationAddress, networkFees, serviceFees, totalFees, fee, memo, tx, psbt, to = null } = route?.params;
    const { txMetadata, fetchAndSaveWalletTransactions, isElectrumDisabled } = useContext(BlueStorageContext);

    const [isLoading, setIsLoading] = useState(false);
    const swipeButtonRef = useRef(null);

    // decode locally and re-check against the reviewed PSBT; nothing is broadcast unless they match
    const signedTx = useMemo(() => {
        try {
            assertSignedTxMatchesPsbt(txHex, psbt);
            return { summary: summarizeSignedTx(txHex, psbt), error: null };
        } catch (e: any) {
            // shown in the app's language, in the alert and in place of the summary
            return { summary: null, error: signedTxErrorText(e.message) };
        }
    }, [txHex, psbt]);

    const broadcast = async () => {
        if (signedTx.error) {
            alert(signedTx.error);
            return;
        }
        setIsLoading(true);
        const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();
    
        if (isBiometricsEnabled) {
            if (!(await Biometric.unlockWithBiometrics())) {
                setIsLoading(false);
                return;
            }
        }
        try {
            await BlueElectrum.ping();
            await BlueElectrum.waitTillConnected();
            const result = await fromWallet.broadcastTx(txHex);
            if (result) {
                setIsLoading(false);
                const txDecoded = bitcoin.Transaction.fromHex(txHex);
                const txid = txDecoded.getId();
                Notifications?.majorTomToGroundControl([], [], [txid]);
                if (memo) {
                    txMetadata[txid] = { memo };
                }
                // its capsules are spent now (it usually is the waiting transaction), so there is nothing to resume
                const pendingID = walletID ?? fromWallet.getID();
                const pending = useAuthStore.getState().pendingSignatures?.[pendingID];
                if (pending && spendsPendingInputs(txHex, pending)) useAuthStore.getState().setPendingSignature(pendingID, null);
                dispatchNavigate('TransactionBroadCastNew', {...route?.params})
                // navigation.navigate('Success', { amount: undefined });
                await new Promise(resolve => setTimeout(resolve, 3000)); // sleep to make sure network propagates
                fetchAndSaveWalletTransactions(fromWallet.getID());
            } else {
                triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
                setIsLoading(false);
                alert(loc.errors.broadcast);
            }
        } catch (error) {
            triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
            setIsLoading(false);
            alert(error.message);
        }
    };
    
    const handleToggle = (val: any) => {
        console.log("🚀 ~ handleToggle ~ value:", val)
        if (val) {
            broadcast();
        }
    }

    const copyTransaction = () => {
        Clipboard.setString(txHex);
        SimpleToast.show(loc.cypherbox.payments.confirm_hardware_transaction.tx_copied, SimpleToast.SHORT);
    };

    const isOwnAddress = (address: string | null) => {
        if (!address) return false;
        try {
            return !!fromWallet?.weOwnAddress?.(address);
        } catch (_) {
            return false;
        }
    };

    return (
        <ScreenLayout showToolbar disableScroll>
            <View style={styles.container}>
                <Text style={styles.title} center>{loc.cypherbox.payments.confirm_hardware_transaction.title}</Text>
                <View style={styles.recipientView}>
                    <Text h2 style={{marginBottom: 20}} center>{loc.cypherbox.payments.confirm_hardware_transaction.transaction_signed}</Text>
                    {signedTx.error ? (
                        <Text h3 center style={{color: colors.redLight}}>{signedTx.error}</Text>
                    ) : (
                        <ScrollView>
                            <Text h4>{loc.cypherbox.payments.confirm_hardware_transaction.check_matches}</Text>
                            {signedTx.summary?.outputs.map((output, i) => (
                                <View key={i} style={styles.priceView}>
                                    <View style={styles.summaryItem}>
                                        <Text style={styles.recipientTitle}>{isOwnAddress(output.address) ? loc.cypherbox.payments.confirm_hardware_transaction.back_to_wallet : loc.cypherbox.payments.confirm_hardware_transaction.to}</Text>
                                        <Text bold style={[styles.value, rtl.ltrText]}>{formatSats(output.value)}</Text>
                                        <Text style={[styles.fees, rtl.ltrText]}>{output.address ?? loc.cypherbox.payments.confirm_hardware_transaction.unknown_output}</Text>
                                    </View>
                                </View>
                            ))}
                            {signedTx.summary?.fee != null ? (
                                <View style={styles.priceView}>
                                    <View style={styles.summaryItem}>
                                        <Text style={styles.recipientTitle}>{loc.cypherbox.payments.confirm_hardware_transaction.network_fee}</Text>
                                        <Text style={[styles.fees, rtl.ltrText]}>{formatSats(signedTx.summary.fee)}</Text>
                                    </View>
                                </View>
                            ) : null}
                            <View style={styles.copyRow}>
                                <TouchableOpacity onPress={copyTransaction} style={[styles.nextBtn, styles.copyBtn]}>
                                    <Text h3>{loc.cypherbox.payments.confirm_hardware_transaction.copy_tx}</Text>
                                </TouchableOpacity>
                            </View>
                            {/* every cold vault send (Send, Top-up, Consolidate, Move to Hot Vault) ends on this screen,
                                so this is the one place the advice needs to be; same words as the import screen */}
                            <TouchableOpacity
                                onPress={() => navigation.navigate('VerifyTransactionGuide')}
                                style={styles.verifyRow}
                                accessibilityRole="button"
                                accessibilityLabel={loc.cypherbox.payments.confirm_hardware_transaction.verify_guide_a11y}
                            >
                                <Text style={styles.verifyText}>
                                    {loc.cypherbox.payments.confirm_hardware_transaction.verify_guide_text}
                                </Text>
                                <View style={styles.helpBtn}>
                                    <Text bold style={styles.helpText}>?</Text>
                                </View>
                            </TouchableOpacity>
                        </ScrollView>
                    )}
                </View>
                {signedTx.error ? null : (
                    <View style={styles.swipeview}>
                        <SwipeButton ref={swipeButtonRef} onToggle={handleToggle} isLoading={isLoading} />
                    </View>
                )}
            </View>
        </ScreenLayout>
    )
}
