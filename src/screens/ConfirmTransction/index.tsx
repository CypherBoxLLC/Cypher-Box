import React, { useContext, useRef, useState } from "react";
import { Image, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import { Icon } from 'react-native-elements';

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { SavingVault, SwipeButton, VaultCapsules } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import { shortenAddress } from "../ColdStorage";
import PayjoinTransaction from "../../../class/payjoin-transaction";
import { PayjoinClient } from "payjoin-client";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import useAuthStore from "@Cypher/stores/authStore";
import Biometric from "../../../class/biometrics";
import loc, { formatBalanceWithoutSuffix } from "../../../loc";
import triggerHapticFeedback, { HapticFeedbackTypes } from '../../../blue_modules/hapticFeedback';
import Notifications from "../../../blue_modules/notifications";
import { BitcoinUnit } from "../../../models/bitcoinUnits";
import { btcToSatoshi } from "../../../blue_modules/currency";
const BlueElectrum = require('../../../blue_modules/BlueElectrum');
const bitcoin = require('bitcoinjs-lib');

interface Props {
    route: any;
}

export default function ConfirmTransction({ route }: Props) {
    const { data } = route?.params;
    const { recipients = [], walletID, vaultTab, fee, memo, tx, satoshiPerByte, psbt, capsulesData = null, to = null, vaultSend, capsuleTotal, isBatch } = data;

    const [usd, setUSD] = useState('40');
    const [sats, setSats] = useState('100K sats  ~$' + usd);
    const [address, setAddress] = useState('bc1...34f');
    const [networkFees, setNetworkFees] = useState(5000);
    const [serviceFees, setServiceFees] = useState('~ 400 sats');
    const [totalFees, setTotalFees] = useState('~ 5400 sats (~0.2%)');
    const [note, setNote] = useState('');
    const [destinationAddress, setDestinationAddress] = useState('');
    const [visibleSelection, setVisibleSelection] = useState(false);
    const [selectedFees, setSelectedFees] = useState(1);
    // const [feeSats, setFeeSats] = useState(5000);
    const [feeUSD, setFeeUSD] = useState(1);
    const [feesEditable, setFeesEditable] = useState(false);
    const [satsEditable, setSatsEditable] = useState(false);
    const swipeButtonRef = useRef(null);
    const [isSendLoading, setIsSendLoading] = useState<boolean>(false);
    const { wallets, fetchAndSaveWalletTransactions } = useContext(BlueStorageContext);
    const [isLoading, setIsLoading] = useState(false);
    const [isPayjoinEnabled, setIsPayjoinEnabled] = useState(false);
    const wallet = wallets.find(w => w.getID() === walletID);
  
    const [isBiometricUseCapableAndEnabled, setIsBiometricUseCapableAndEnabled] = useState(false);


    const setSats_ = (sats: any, usd: any) => {
        setUSD(usd);
        const value = Number(sats) / 10000;
        setSats(value + 'K sats ~$' + usd);
        setSatsEditable(true);
    }

    const handleToggle = (val: any) => {
        console.log("🚀 ~ handleToggle ~ value:", val)
        if (val) {
            // handleSendSats();
            send();
            // dispatchNavigate('TransactionBroadCastNew', {...data});
        }
    }

    const broadcast = async transaction => {
        await BlueElectrum.ping();
        await BlueElectrum.waitTillConnected();
    
        if (isBiometricUseCapableAndEnabled) {
          if (!(await Biometric.unlockWithBiometrics())) {
            return;
          }
        }
    
        const result = await wallet.broadcastTx(transaction);
        if (!result) {
          throw new Error(loc.errors.broadcast);
        }
    
        return result;
    };
    
    const getPaymentScript = () => {
        return bitcoin.address.toOutputScript(destinationAddress);
    };
    
    const send = async () => {
        setIsLoading(true);
        try {
            const txids2watch = [];
            if (!isPayjoinEnabled) {
                    await broadcast(tx);
            } else {
                const payJoinWallet = new PayjoinTransaction(psbt, txHex => broadcast(txHex), wallet);
                const paymentScript = getPaymentScript();
                const payjoinClient = new PayjoinClient({
                paymentScript,
                wallet: payJoinWallet,
                payjoinUrl: data?.payjoinUrl,
                });
                await payjoinClient.run();
                const payjoinPsbt = payJoinWallet.getPayjoinPsbt();
                if (payjoinPsbt) {
                const tx2watch = payjoinPsbt.extractTransaction();
                txids2watch.push(tx2watch.getId());
                }
            }
        
            const txid = bitcoin.Transaction.fromHex(tx).getId();
            txids2watch.push(txid);
            Notifications.majorTomToGroundControl([], [], txids2watch);
            let amount = 0;
            for (const recipient of recipients) {
              amount += recipient.value;
            }
      
            amount = formatBalanceWithoutSuffix(amount, BitcoinUnit.BTC, false);
      
            // let amount = 0;
            // for (const recipient of recipients) {
            //     amount += recipient.value;
            // }
        
            // amount = formatBalanceWithoutSuffix(amount, BitcoinUnit.BTC, false);
            triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
            console.log('fee: ', fee)
            dispatchNavigate('TransactionBroadCastNew', {...data})
            // navigate('Success', {
            //     fee: Number(fee),
            //     amount,
            // });
        
            setIsLoading(false);
        
            await new Promise(resolve => setTimeout(resolve, 3000)); // sleep to make sure network propagates
            fetchAndSaveWalletTransactions(walletID);
        } catch (error) {
            triggerHapticFeedback(HapticFeedbackTypes.NotificationError);
            setIsLoading(false);
            alert(error.message);
        }
    };

    console.log('data?.address: ', data)
    return (
        <ScreenLayout showToolbar disableScroll>
            <View style={styles.container}>
                <Text style={styles.title} center>Confirm transaction</Text>
                {/* <SavingVault
                    container={styles.savingVault}
                    innerContainer={styles.savingVault}
                    shadowTopBottom={styles.savingVault}
                    shadowBottomBottom={styles.savingVault}
                    bitcoinText={styles.bitcoinText}
                    imageStyle={styles.bitcoinImage}
                    titleStyle={styles.titleVault}
                    title="Hot Savings"
                    bitcoinValue='0.1 BTC ~ $6500'
                // onPress={savingVaultClickHandler}
                /> */}
                <View style={styles.recipientView}>
                    {!isBatch &&
                        <Text bold style={styles.coinselected}>Capsules selected:</Text>
                    }
                    {capsulesData && capsulesData.length > 0 ? (
                        <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10, marginBottom: 10}}>
                            {capsulesData.map((item: any, i: number) => (
                                <View key={item.id || i} style={{width: "17%", marginRight: 2, marginLeft: 2}}>
                                    <VaultCapsules item={item.value} />
                                </View>
                            ))}
                        </View>
                    ) : !isBatch && (
                        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 10}}>
                            {Array(data?.coinsSelected || 0).fill(0).map((_, i) => (
                                <View key={i} style={{width: "17%", marginRight: 2, marginLeft: 2}}>
                                    <VaultCapsules item={0} />
                                </View>
                            ))}
                        </View>
                    )}
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>{isBatch ? "Amount to be batched:" : to ? "Top-up amount:" : "Recipient will get:"}</Text>
                            <Text bold style={[styles.value, vaultTab && {color: colors.coldGreen}]}>{data?.sats + ' sats ~$'+ data?.inUSD}</Text>
                            <View style={{flexDirection: 'row', marginTop: 8}}>
                                <View style={{width: "17%", marginRight: 2, marginLeft: 2}}>
                                    <VaultCapsules item={data?.sats || 0} />
                                </View>
                            </View>
                        </View>
                        {/* <TouchableOpacity style={styles.editAmount} onPress={editAmountClickHandler}>
                            <Text>Edit amount</Text>
                        </TouchableOpacity> */}
                    </View>
                    {data?.capsuleTotal > 0 && data?.networkFees > 0 && !isBatch &&
                        (() => {
                            const changeSats = data.capsuleTotal - data.sats - data.networkFees;
                            if (changeSats > 0) {
                                return (
                                    <View style={[styles.priceView, {marginTop: 5}]}>
                                        <View>
                                            <Text style={styles.recipientTitle}>Change:</Text>
                                            <Text bold style={[styles.value, vaultTab && {color: colors.coldGreen}]}>{changeSats.toFixed(0) + ' sats' + (data?.matchedRate ? ' ~$' + (changeSats / 100000000 * Number(data.matchedRate)).toFixed(2) : '')}</Text>
                                            <View style={{flexDirection: 'row', marginTop: 8}}>
                                                <View style={{width: "17%", marginRight: 2, marginLeft: 2}}>
                                                    <VaultCapsules item={changeSats} />
                                                </View>
                                            </View>
                                        </View>
                                    </View>
                                );
                            }
                            return null;
                        })()
                    }
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>Sent from:</Text>
                            <Text style={styles.fees}>{isBatch ? "Cold Vault address: " : "Vault address: "}{shortenAddress(data.sentFrom)}</Text>
                        </View>
                    </View>
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>{to && !vaultSend ? "To Coinos Bitcoin address" : "To:"}</Text>
                            <Text style={StyleSheet.flatten([styles.fees, { color: vaultTab ? colors.coldGreen : colors.green }])}>{isBatch ? "Cold Vault address: " : "Bitcoin Address: "}{shortenAddress(data?.destinationAddress)}</Text>
                        </View>
                    </View>
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>Network fee:</Text>
                            <Text style={StyleSheet.flatten(styles.fees)}>~ {data?.isCustomFee ? data.networkFees + " sats/vByte" :  data?.networkFees + " sats"}{!data?.isCustomFee && data?.networkFees && data?.matchedRate ? ` (~$${(data.networkFees / 100000000 * Number(data.matchedRate)).toFixed(2)}) (${(data.networkFees / data.sats * 100).toFixed(1)}%)` : ''}</Text>
                            {/* <Text style={StyleSheet.flatten(styles.fees)}>~ {btcToSatoshi(data?.fee)}</Text> */}
                        </View>
                    </View>
                    {/* <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>Service fee:</Text>
                            <Text style={styles.fees}>{serviceFees}</Text>
                        </View>
                    </View>
                    <View style={styles.priceView}>
                        <View>
                            <Text style={styles.recipientTitle}>Total fee:</Text>
                            <Text style={styles.fees}>{totalFees}</Text>
                        </View>
                    </View> */}
                    {data?.note &&
                        <Text h4>Note: {data?.note}</Text>                        
                    }
                </View>
                <View style={styles.swipeview}>
                    <SwipeButton ref={swipeButtonRef} onToggle={handleToggle} isLoading={isLoading} />
                </View>
            </View>
        </ScreenLayout>
    )
}
