import React, { useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { SwipeButton } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { assertSignedTxMatchesPsbt, isRawTransactionHex } from "@Cypher/helpers";
import { shortenAddress } from "../ColdStorage";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { useIsFocused } from "@react-navigation/native";
import loc from "../../../loc";
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

export default function HardwareWalletTransactionContinue({ route, navigation }: Props) {
    const { walletID = null, isCustomFee, fromWallet, sats, inUSD, sentFrom, destinationAddress, networkFees, serviceFees, totalFees, fee, memo, tx, psbt, to = null } = route?.params;
    const { txMetadata, fetchAndSaveWalletTransactions, isElectrumDisabled } = useContext(BlueStorageContext);
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
            alert(Err.message);
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
        navigation.navigate("ConfirmHardwareTransaction", { walletID, isCustomFee, fromWallet, sats, inUSD, sentFrom, destinationAddress, networkFees, serviceFees, totalFees, fee, memo, tx, psbt, to, txHex })
    };

    return (
        <ScreenLayout showToolbar disableScroll>
            <View style={styles.container}>
                <Text style={styles.title} center>Transaction signing</Text>
                <View style={styles.recipientView}>
                    <Text h4 style={{marginBottom: 20}}>Signed it on your signing device? Scan or import the signed transaction.</Text>
                    <TouchableOpacity onPress={openScanner} style={[styles.nextBtn, {borderColor: colors.blueText, borderWidth: 1}]}>
                        <Text h3>Scan</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={openSignedTransaction} style={[styles.nextBtn, {borderColor: colors.blueText, borderWidth: 1}]}>
                        <Text h3>Import</Text>
                    </TouchableOpacity>
                    {/* resuming from the vault tab lands here; the device may still need the unsigned one */}
                    <TouchableOpacity
                        onPress={() => navigation.navigate('HardwareWalletTransaction', route.params)}
                        accessibilityRole="button"
                        style={styles.showAgain}
                    >
                        <Text h4 style={styles.showAgainText}>Need the unsigned transaction again? Show it</Text>
                    </TouchableOpacity>
                    <Text h4 style={{marginTop: 20}}>{txHex}</Text>
                </View>
                <TouchableOpacity onPress={nextClickHandler} disabled={!txHex} style={[styles.nextBtn , {backgroundColor: txHex ? colors.blueText : colors.gray.default}]}>
                    <Text h3>Next</Text>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    )
}
