import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import SimpleToast from "react-native-simple-toast";

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { SwipeButton } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import loc from "../../../loc";
import Biometric from "../../../class/biometrics";
import Notifications from "../../../blue_modules/notifications";
import triggerHapticFeedback, { HapticFeedbackTypes } from "../../../blue_modules/hapticFeedback";
import { assertSignedTxMatchesPsbt, dispatchNavigate, spendsPendingInputs, summarizeSignedTx } from "@Cypher/helpers";
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
            return { summary: null, error: e.message as string };
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
        SimpleToast.show('Transaction copied', SimpleToast.SHORT);
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
                <Text style={styles.title} center>Confirm Transaction</Text>
                <View style={styles.recipientView}>
                    <Text h2 style={{marginBottom: 20}} center>Transaction Signed!</Text>
                    {signedTx.error ? (
                        <Text h3 center style={{color: colors.redLight}}>{signedTx.error}</Text>
                    ) : (
                        <ScrollView>
                            <Text h4>Check this matches what you approved on your device:</Text>
                            {signedTx.summary?.outputs.map((output, i) => (
                                <View key={i} style={styles.priceView}>
                                    <View style={styles.summaryItem}>
                                        <Text style={styles.recipientTitle}>{isOwnAddress(output.address) ? "Back to your wallet:" : "To:"}</Text>
                                        <Text bold style={styles.value}>{output.value + ' sats'}</Text>
                                        <Text style={styles.fees}>{output.address ?? 'Unknown output script'}</Text>
                                    </View>
                                </View>
                            ))}
                            {signedTx.summary?.fee != null ? (
                                <View style={styles.priceView}>
                                    <View style={styles.summaryItem}>
                                        <Text style={styles.recipientTitle}>Network fee:</Text>
                                        <Text style={styles.fees}>{signedTx.summary.fee + ' sats'}</Text>
                                    </View>
                                </View>
                            ) : null}
                            <View style={styles.copyRow}>
                                <TouchableOpacity onPress={copyTransaction} style={[styles.nextBtn, styles.copyBtn]}>
                                    <Text h3>Copy transaction</Text>
                                </TouchableOpacity>
                            </View>
                            {/* every cold vault send (Send, Top-up, Consolidate, Move to Hot Vault) ends on this screen,
                                so this is the one place the advice needs to be; same words as the import screen */}
                            <TouchableOpacity
                                onPress={() => navigation.navigate('VerifyTransactionGuide')}
                                style={styles.verifyRow}
                                accessibilityRole="button"
                                accessibilityLabel="How to check this transaction yourself"
                            >
                                <Text style={styles.verifyText}>
                                    Spending large capsules from cold storage? Check this signed transaction in an independent, offline tool before you send it.
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
