import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { SwipeButton } from "@Cypher/components";
import { colors, rtl } from "@Cypher/style-guide";
import { assertSignedTxMatchesPsbt, createPendingSignature, formatSats, formatUsd, isRawTransactionHex, sameUnsignedTransaction, summarizePsbt } from "@Cypher/helpers";
import signedTxErrorText from "@Cypher/helpers/signedTxErrorText";
import { confirmLabels, VaultSendKind } from "@Cypher/helpers/vaultSendKind";
import useAuthStore from "@Cypher/stores/authStore";
import { shortenAddress } from "../ColdStorage";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { useIsFocused } from "@react-navigation/native";
import loc from "../../../loc";
// with its title and button in the app's language (the global alert() titles it "Alert" in English)
import alert from "../../../components/Alert";
import Biometric from "../../../class/biometrics";
import Notifications from "../../../blue_modules/notifications";
import triggerHapticFeedback, { HapticFeedbackTypes } from "../../../blue_modules/hapticFeedback";
import Clipboard from "@react-native-clipboard/clipboard";
import { requestCameraAuthorization } from "../../../helpers/scan-qr";
import { DynamicQRCode } from "../../../components/DynamicQRCode";
import { DynamicPSBTQRCode } from "../../../components/DynamicPSBTQRCode";
import { SecondButton } from "../../../BlueComponents";

const BlueElectrum = require('../../../blue_modules/BlueElectrum');
const bitcoin = require('bitcoinjs-lib');
const fs = require('../../../blue_modules/fs');

interface Props {
    route: any;
    navigation: any
}

export default function HardwareWalletTransaction({ route, navigation }: Props) {
    const { walletID = null, isCustomFee, fromWallet, sats, inUSD, sentFrom, destinationAddress, networkFees, serviceFees, totalFees, fee, memo, tx, psbt, to = null, kind = null, changeSats = 0 } = route?.params;
    const { txMetadata, fetchAndSaveWalletTransactions, isElectrumDisabled } = useContext(BlueStorageContext);
    // A Cold Vault spend, labelled by the flow that built it. A signing saved by an
    // older version has no `kind`: it keeps the labels it had.
    const sendKind: VaultSendKind = kind || (to ? 'top_up' : 'send');
    const labels = confirmLabels(sendKind, { vaultTab: true, toCoinos: sendKind === 'top_up' && !!to && destinationAddress === to });
    // The figures shown are read from the PSBT the device will sign. A signing saved by an
    // older version carries the review's estimate in its params, which could be far off.
    const shown = useMemo(() => {
        let built = null;
        try {
            built = summarizePsbt(psbt, destinationAddress);
        } catch (_) {
            // fall back to what the review passed
        }
        const amount = built && built.amountSats > 0 ? built.amountSats : Number(sats) || 0;
        // fiat at the rate the review used
        const usdPerSat = Number(sats) > 0 && Number(inUSD) > 0 ? Number(inUSD) / Number(sats) : null;
        return {
            amount,
            usd: usdPerSat !== null ? amount * usdPerSat : null,
            change: built ? built.changeSats : Number(changeSats) || 0,
            fee: built && built.fee !== null ? built.fee : kind ? Number(networkFees) || null : null,
        };
    }, [psbt, destinationAddress, sats, inUSD, changeSats, networkFees, kind]);
    const openScannerButton = useRef();
    const dynamicQRCode = useRef();
    const isFocused = useIsFocused();

    const [isLoading, setIsLoading] = useState(false);
    const [txHex, setTxHex] = useState(route.params.txhex);

    const _combinePSBT = receivedPSBT => {
        return fromWallet.combinePsbt(psbt, receivedPSBT);
      };

    const onBarScanned = ret => {
        if (ret && !ret.data) ret = { data: ret };
        if (ret.data.toUpperCase().startsWith('UR')) {
          alert('BC-UR not decoded. This should never happen');
        }
        if (isRawTransactionHex(ret.data)) {
          // a finished transaction instead of a signed PSBT: only accept it if it is the one the user reviewed
          try {
            assertSignedTxMatchesPsbt(ret.data, psbt);
            setTxHex(ret.data.trim());
          } catch (Err: any) {
            alert(signedTxErrorText(Err.message));
          }
          return;
        }
        try {
          const Tx = _combinePSBT(ret.data);
          setTxHex(Tx.toHex());
        //   if (launchedBy) {
        //     // we must navigate back to the screen who requested psbt (instead of broadcasting it ourselves)
        //     // most likely for LN channel opening
        //     navigation.navigate({ name: launchedBy, params: { psbt }, merge: true });
        //     // ^^^ we just use `psbt` variable sinse it was finalized in the above _combinePSBT()
        //     // (passed by reference)
        //   }
        } catch (Err) {
          alert(Err.message);
        }
    };

    // Signing happens away from the app, so keep this until it is broadcast: if the app is closed meanwhile the
    // vault tab offers to resume it, and checks what comes back against it.
    useEffect(() => {
        if (!psbt || !walletID) return;
        const { pendingSignatures, setPendingSignature } = useAuthStore.getState();
        const current = pendingSignatures?.[walletID];
        // resuming the same transaction keeps when it was prepared
        if (current && sameUnsignedTransaction(current.psbt, psbt)) return;
        setPendingSignature(walletID, createPendingSignature(route.params));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [psbt, walletID]);

    useEffect(() => {
        if (isFocused) {
          dynamicQRCode.current?.startAutoMove();
        } else {
          dynamicQRCode.current?.stopAutoMove();
        }
    }, [isFocused]);

    useEffect(() => {
        if (!psbt) {
          alert(loc.send.no_tx_signing_in_progress);
        }

        // if (deepLinkPSBT) {
        //     const newPsbt = bitcoin.Psbt.fromBase64(deepLinkPSBT);
        //     try {
        //         const Tx = fromWallet.combinePsbt(routeParamsPSBT.current, newPsbt);
        //         setTxHex(Tx.toHex());
        //     } catch (Err) {
        //         alert(Err);
        //     }
        // } else if (routeParamsTXHex) {
        //   setTxHex(routeParamsTXHex);
        // }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [psbt]);

    const broadcast = async () => {
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
                Notifications.majorTomToGroundControl([], [], [txid]);
                if (memo) {
                    txMetadata[txid] = { memo };
                }
                navigation.navigate('Success', { amount: undefined });
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

    const copyHexToClipboard = () => {
        Clipboard.setString(txHex);
    };

    const exportPSBT = () => {
        const fileName = `${Date.now()}.psbt`;
        dynamicQRCode.current?.stopAutoMove();
        fs.writeFileAndExport(fileName, typeof psbt === 'string' ? psbt : psbt.toBase64()).finally(() => {
            dynamicQRCode.current?.startAutoMove();
        });
    };

    const openSignedTransaction = async () => {
        // the shared reader handles binary .psbt files and file names with spaces, and alerts on failure itself
        const file = await fs.openSignedTransaction();
        if (file) {
            onBarScanned({ data: file });
        }
    };

    const openScanner = () => {
        requestCameraAuthorization().then(() => {
          navigation.navigate('ScanQRCodeRoot', {
            screen: 'ScanQRCode',
            params: {
              launchedBy: route.name,
              showFileImportButton: false,
              onBarScanned,
            },
          });
        });
    };

    const nextClickHandler = async () => {
        navigation.navigate("HardwareWalletTransactionContinue", { walletID, isCustomFee, fromWallet, sats, inUSD, sentFrom, destinationAddress, networkFees, serviceFees, totalFees, fee, memo, tx, psbt, to, kind, changeSats })
    };

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <Text style={styles.title} center>{loc.cypherbox.payments.common.transaction_signing}</Text>
                <View style={styles.recipientView}>
                    <Text h4 style={{marginBottom: 12}}>{loc.cypherbox.payments.hardware_wallet_transaction.instructions}</Text>
                    <Text h4 style={styles.leaveNote}>{loc.cypherbox.payments.hardware_wallet_transaction.leave_note}</Text>
                    <TouchableOpacity
                        onPress={() => navigation.navigate('SigningSafetyGuide')}
                        style={styles.signerRow}
                        accessibilityRole="button"
                        accessibilityLabel={loc.cypherbox.payments.hardware_wallet_transaction.signing_safely_a11y}
                    >
                        <Text h4 style={styles.signerText}>{loc.cypherbox.payments.hardware_wallet_transaction.signer_warning}</Text>
                        <View style={styles.signerHelp}>
                            <Text bold style={styles.signerHelpText}>?</Text>
                        </View>
                    </TouchableOpacity>
                    <DynamicPSBTQRCode value={psbt.toHex()} ref={dynamicQRCode} />
                    <TouchableOpacity onPress={exportPSBT} style={[styles.nextBtn, {borderColor: colors.blueText, borderWidth: 1}]}>
                        <Text h3>{loc.cypherbox.payments.hardware_wallet_transaction.export}</Text>
                    </TouchableOpacity>

                    {/* the built transaction's amount, change and fee: the same figures the review showed */}
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>{labels.amount}</Text>
                            <Text bold style={[styles.value, {color: colors.blueText}, rtl.ltrText]}>{formatSats(shown.amount) + (shown.usd !== null ? ' ~' + formatUsd(shown.usd) : '')}</Text>
                        </View>
                    </View>
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>{labels.toTitle}</Text>
                            <Text style={StyleSheet.flatten([styles.fees, { color: colors.blueText }])}>{labels.to}{shortenAddress(destinationAddress)}</Text>
                        </View>
                    </View>
                    {shown.change > 0 &&
                        <View style={styles.priceView}>
                            <View>
                                <Text style={styles.recipientTitle}>{loc.cypherbox.payments.confirm_transaction.change}</Text>
                                <Text style={StyleSheet.flatten([styles.fees, rtl.ltrText])}>{formatSats(shown.change)}</Text>
                            </View>
                        </View>
                    }
                    {shown.fee !== null &&
                        <View style={styles.priceView}>
                            <View>
                                <Text style={styles.recipientTitle}>{loc.cypherbox.payments.confirm_transaction.network_fee}</Text>
                                <Text style={StyleSheet.flatten([styles.fees, rtl.ltrText])}>{formatSats(shown.fee)}</Text>
                            </View>
                        </View>
                    }
                </View>
                <TouchableOpacity onPress={nextClickHandler} style={[styles.nextBtn, {backgroundColor: colors.blueText}]}>
                    <Text h3>{loc.cypherbox.payments.common.next}</Text>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    )
}
