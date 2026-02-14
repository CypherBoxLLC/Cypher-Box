import React, { useContext, useEffect, useRef, useState } from "react";
import { Linking, TouchableOpacity, View } from "react-native";

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { SwipeButton } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import loc from "../../../loc";
import Biometric from "../../../class/biometrics";
import Notifications from "../../../blue_modules/notifications";
import triggerHapticFeedback, { HapticFeedbackTypes } from "../../../blue_modules/hapticFeedback";
import { dispatchNavigate } from "@Cypher/helpers";

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
                Notifications?.majorTomToGroundControl([], [], [txid]);
                if (memo) {
                    txMetadata[txid] = { memo };
                }
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
    
    const handleOnVerifyPressed = () => {
        Linking.openURL('https://coinb.in/?verify=' + txHex);
    };
        
    const handleToggle = (val: any) => {
        console.log("🚀 ~ handleToggle ~ value:", val)
        if (val) {
            broadcast();
        }
    }

    return (
        <ScreenLayout showToolbar disableScroll>
            <View style={styles.container}>
                <Text style={styles.title} center>Confirm Transaction</Text>
                <View style={styles.recipientView}>
                    <Text h2 style={{marginBottom: 20}} center>Transaction Signed!</Text>
                    <TouchableOpacity onPress={handleOnVerifyPressed} style={styles.nextBtn}>
                        <Text h3 style={{color: colors.gray.default}}>Verify on Coinb.in</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.swipeview}>
                    <SwipeButton ref={swipeButtonRef} onToggle={handleToggle} isLoading={isLoading} />
                </View>
            </View>
        </ScreenLayout>
    )
}
