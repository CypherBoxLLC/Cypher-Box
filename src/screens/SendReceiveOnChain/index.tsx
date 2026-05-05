import React, { useContext, useEffect, useState, useRef } from "react";
import { Linking, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import dayjs from "dayjs";
import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import TextView from "./TextView";
import { btc } from "@Cypher/helpers/coinosHelper";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { colors } from "@Cypher/style-guide";
import useAuthStore from "@Cypher/stores/authStore";
import RBSheet from "react-native-raw-bottom-sheet";
import { HDSegwitBech32Wallet, HDSegwitBech32Transaction } from "../../../class";
import { dispatchNavigate } from "@Cypher/helpers";
import { NetworkTransactionFees } from "../../../models/networkTransactionFees";

interface Props {
    route: any;
}

const shortenAddress = (address: string) => {
    // Take the first 6 characters
    const start = address.substring(0, 6);
    // Take the last 6 characters
    const end = address.substring(address.length - 6);
    // Combine with three dots in the middle
    return `${start}...${end}`;
};


export default function SendReceiveOnChain({ route }: Props) {
    const { transaction, history, matchedRate, wallet } = route?.params;
    const isSent = transaction.value < 0;
    const satsAmount = transaction.value.toString().replace('-', ''); // Adjusted for negative sign
    const amountSign = transaction.value < 0 ? "-" : "+";
    const currency = btc(1);
    const dollarAmount = satsAmount * matchedRate * currency;
    const BTCAmount = btc(satsAmount) + " BTC";
    const { saveToDisk, txMetadata, wallets, getTransactions } = useContext(BlueStorageContext);
    const { vaultTab } = useAuthStore();
    const [from, setFrom] = useState();
    const [to, setTo] = useState();
    const [isLoading, setIsLoading] = useState(true);
    const [tx, setTX] = useState();
    const [memo, setMemo] = useState();
    const [newFeeRate, setNewFeeRate] = useState('2');
    const [currentFeeRate, setCurrentFeeRate] = useState<number | null>(null);
    const [rbfTx, setRbfTx] = useState<HDSegwitBech32Transaction | null>(null);
    const [isRBFLoading, setIsRBFLoading] = useState(false);
    const [isRBFSubmitting, setIsRBFSubmitting] = useState(false);
    const [feeOptions, setFeeOptions] = useState<{fast: number, medium: number, slow: number} | null>(null);
    const rbfSheetRef = useRef<any>(null);

    const findWalletForTransaction = () => {
        if (wallet) return wallet;
        for (const w of wallets || []) {
            const txs = w.getTransactions ? w.getTransactions() : [];
            if (txs?.some((t: any) => t.hash === transaction?.hash || t.txid === transaction?.txid)) {
                return w;
            }
        }
        return null;
    };
  

    useEffect(() => {
        let foundTx = {};
        let newFrom = [];
        let newTo = [];
        for (const trans of getTransactions(null, Infinity, true)) {
          if (trans.hash === transaction.hash) {
            foundTx = trans;
            for (const input of foundTx.inputs) {
              newFrom = newFrom.concat(input.addresses);
            }
            for (const output of foundTx.outputs) {
              if (output.addresses) newTo = newTo.concat(output.addresses);
              if (output.scriptPubKey && output.scriptPubKey.addresses) newTo = newTo.concat(output.scriptPubKey.addresses);
            }
          }
        }
    
        for (const w of wallets) {
          for (const t of w.getTransactions()) {
            if (t.hash === transaction.hash) {
              console.log('tx', transaction.hash, 'belongs to', w.getLabel());
            }
          }
        }
        if (txMetadata[foundTx.hash]) {
          if (txMetadata[foundTx.hash].memo) {
            setMemo(txMetadata[foundTx.hash].memo);
          }
        }
    
        setTX(foundTx);
        setFrom(newFrom);
        setTo(newTo);
        setIsLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [transaction.hash, wallets]);
    
    const handleViewBtcNetExplorerClickHandler = () => {
        // mempool.space is the default explorer across the rest of the app
        // (Ark tx details, BlueWallet 6.5.1's send/broadcast + transaction
        // status screens). Standardising here so vault transaction history
        // taps don't bounce between providers.
        // #details fragment auto-expands the inputs/outputs section on
        // mempool.space so we land on the full transaction view rather
        // than the mobile-collapsed summary.
        const url = `https://mempool.space/tx/${transaction?.txid}#details`;
        Linking.openURL(url).catch(err => console.error('An error occurred', err));
    }

    const handleAccelerateTransaction = async () => {
        setIsRBFLoading(true);
        try {
            const walletInstance = findWalletForTransaction();
            if (!walletInstance) {
                alert('No wallet available for this transaction');
                setIsRBFLoading(false);
                return;
            }

            if (walletInstance.type !== HDSegwitBech32Wallet.type) {
                alert('Acceleration is only available for native SegWit (bc1) wallets');
                setIsRBFLoading(false);
                return;
            }

            const txObject = new HDSegwitBech32Transaction(null, transaction?.txid, walletInstance);
            const isOurTx = await txObject.isOurTransaction();
            const confirmations = await txObject.getRemoteConfirmationsNum();
            const isReplaceable = await txObject.isSequenceReplaceable();

            if (!isOurTx) {
                alert('This transaction does not belong to the current wallet');
                setIsRBFLoading(false);
                return;
            }

            if (confirmations > 0) {
                alert('This transaction is already confirmed');
                setIsRBFLoading(false);
                return;
            }

            if (!isReplaceable) {
                alert('This transaction was not created with RBF enabled');
                setIsRBFLoading(false);
                return;
            }

            const info = await txObject.getInfo();
            
            // Fetch current fee options from mempool
            try {
                const fees = await NetworkTransactionFees.recommendedFees();
                setFeeOptions({ fast: fees.fastestFee, medium: fees.mediumFee, slow: fees.slowFee });
            } catch (e) {
                console.warn('Failed to fetch fee options:', e);
                setFeeOptions(null);
            }
            
            setNewFeeRate(String(info.feeRate + 1));
            setCurrentFeeRate(info.feeRate);
            setRbfTx(txObject);
            rbfSheetRef.current?.open();
        } catch (error) {
            console.error('RBF prep error:', error);
            alert('Unable to accelerate transaction: ' + error.message);
        }
        setIsRBFLoading(false);
    };

    const handleRBFSubmit = async () => {
        if (!rbfTx) {
            handleAccelerateTransaction();
            return;
        }

        setIsRBFSubmitting(true);
        try {
            const walletInstance = (rbfTx as any)._wallet || findWalletForTransaction();
            if (!walletInstance) {
                alert('No wallet available for broadcasting');
                setIsRBFSubmitting(false);
                return;
            }

            const feeRateNumber = parseInt(newFeeRate, 10);
            if (isNaN(feeRateNumber)) {
                alert('Please enter a valid fee rate');
                setIsRBFSubmitting(false);
                return;
            }

            if (currentFeeRate && feeRateNumber <= currentFeeRate) {
                alert('New fee rate must be higher than current rate');
                setIsRBFSubmitting(false);
                return;
            }

            const { tx: newTx } = await rbfTx.createRBFbumpFee(feeRateNumber);

            await walletInstance.broadcast(newTx.toHex());
            console.log('RBF transaction broadcasted:', newTx.getId());

            rbfSheetRef.current?.close();
            navigateToBroadcastScreen(feeRateNumber, newTx.getId());
        } catch (error) {
            console.error('RBF error:', error);
            alert('Failed to accelerate transaction: ' + error.message);
        }
        setIsRBFSubmitting(false);
    };

    const navigateToBroadcastScreen = (feeRateNumber: number, newTxid: string) => {
        const satValueNumber = Number(satsAmount || 0);
        const fiatValue = dollarAmount || 0;
        const toAddress = transaction?.outputs?.[0]?.scriptPubKey?.addresses?.[0] || transaction?.outputs?.[0]?.addresses?.[0];

        dispatchNavigate('TransactionBroadCast', {
            matchedRate,
            currency: route?.params?.currency || 'USD',
            type: 'rbf',
            value: satValueNumber,
            converted: fiatValue,
            isSats: true,
            to: toAddress,
            receiveType: false,
            item: {
                txid: newTxid,
                originalTxid: transaction?.txid,
                feeRate: feeRateNumber,
            },
        });
    };

    console.log('transaction?.confirmations: ', transaction)
    console.log('tx: ', tx)
    return (
        <ScreenLayout showToolbar isBackButton title="Review Transaction">
            <View style={styles.main}>
                <View style={styles.valueView}>
                    <Text semibold center style={StyleSheet.flatten([styles.sats, { color: isSent ? '#FD7A68' : '#4FBF67' }])}>{amountSign+BTCAmount}</Text>
                    <Text bold subHeader>{'$'+dollarAmount.toFixed(2)}</Text>
                </View>
                <TextView keytext="Sent from: " text={`Bitcoin Address: ${shortenAddress(transaction?.inputs[0].addresses[0])}`} />
                <TextView keytext="Received to: " text={`Bitcoin Address: ${shortenAddress(transaction?.outputs[0].scriptPubKey.addresses[0])}`} />
                {isSent &&
                    <>
                        <TextView keytext="Status: " text={
                          transaction.confirmations > 0 ? 
                            transaction?.confirmations > 3 ? 
                            "Received" : 
                            "Sent"
                        : "Pending"} />
                        {tx?.fee &&
                            <TextView keytext="Network fee: " text={tx?.fee} />                        
                        }
                        {/* <TextView keytext="Service fee: " text="~ 400 sats" />
                        <TextView keytext="Total fee: " text="~ 5,400 sats (~ 0.1%)" /> */}
                    </>
                }
                
                <TextView keytext="Date:  " text={dayjs(tx?.received).format('HH:mm:ss MM/DD/YYYY')} />
                {/* {!isSent && <TextView keytext="At bitcoin exchange rate: " text={'$'+matchedRate} />} */}
                <TextView keytext="Txid:  " text={transaction?.txid} />

                {isSent && transaction.confirmations == 0 &&
                    <TouchableOpacity 
                        style={[styles.button, { marginBottom: 20 }, vaultTab && { borderColor: colors.coldGreen}]}
                        onPress={handleAccelerateTransaction}
                        disabled={isRBFLoading}
                    >
                        <Text bold h4 style={styles.text}>{isRBFLoading ? 'Preparing...' : 'Accelerate transaction'}</Text>
                    </TouchableOpacity>
                }
                <TouchableOpacity style={[styles.button, vaultTab && { borderColor: colors.coldGreen}]} onPress={handleViewBtcNetExplorerClickHandler}>
                    <Text bold h4 style={styles.text}>View in Bitcoin Network Explorer</Text>
                </TouchableOpacity>
            </View>

            <RBSheet
                ref={rbfSheetRef}
                height={320}
                openDuration={250}
                closeOnDragDown
                customStyles={{
                    container: {
                        backgroundColor: colors.black.light,
                        borderTopLeftRadius: 20,
                        borderTopRightRadius: 20,
                        paddingBottom: 30,
                    },
                }}
            >
                <View style={{ padding: 20 }}>
                    <Text bold h3 center style={{ marginBottom: 20, color: colors.white }}>Accelerate Transaction</Text>
                    {currentFeeRate !== null && (
                        <Text semibold style={{ marginBottom: 10, color: colors.gray.light }}>
                            Current fee rate: {currentFeeRate} sat/vbyte
                        </Text>
                    )}
                    <Text semibold style={{ marginBottom: 10, color: colors.white }}>Select Fee Rate:</Text>
                    
                    {feeOptions ? (
                        <View style={{ marginBottom: 20 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                                <TouchableOpacity 
                                    style={{
                                        flex: 1,
                                        backgroundColor: newFeeRate === String(feeOptions.slow) ? colors.green : colors.black.bg,
                                        borderRadius: 10,
                                        padding: 12,
                                        marginRight: 5,
                                        borderWidth: 1,
                                        borderColor: newFeeRate === String(feeOptions.slow) ? colors.green : colors.gray.dark,
                                    }}
                                    onPress={() => setNewFeeRate(String(feeOptions.slow))}
                                >
                                    <Text bold center style={{ color: colors.white }}>Slow</Text>
                                    <Text center style={{ color: colors.gray.light, fontSize: 12 }}>{feeOptions.slow} sat/vB</Text>
                                    <Text center style={{ color: colors.gray.light, fontSize: 10 }}>~{currentFeeRate ? Math.round((currentFeeRate/feeOptions.slow)*60) : '?'} min</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                    style={{
                                        flex: 1,
                                        backgroundColor: newFeeRate === String(feeOptions.medium) ? colors.green : colors.black.bg,
                                        borderRadius: 10,
                                        padding: 12,
                                        marginHorizontal: 5,
                                        borderWidth: 1,
                                        borderColor: newFeeRate === String(feeOptions.medium) ? colors.green : colors.gray.dark,
                                    }}
                                    onPress={() => setNewFeeRate(String(feeOptions.medium))}
                                >
                                    <Text bold center style={{ color: colors.white }}>Medium</Text>
                                    <Text center style={{ color: colors.gray.light, fontSize: 12 }}>{feeOptions.medium} sat/vB</Text>
                                    <Text center style={{ color: colors.gray.light, fontSize: 10 }}>~{currentFeeRate ? Math.round((currentFeeRate/feeOptions.medium)*60) : '?'} min</Text>
                                </TouchableOpacity>
                                <TouchableOpacity 
                                    style={{
                                        flex: 1,
                                        backgroundColor: newFeeRate === String(feeOptions.fast) ? colors.green : colors.black.bg,
                                        borderRadius: 10,
                                        padding: 12,
                                        marginLeft: 5,
                                        borderWidth: 1,
                                        borderColor: newFeeRate === String(feeOptions.fast) ? colors.green : colors.gray.dark,
                                    }}
                                    onPress={() => setNewFeeRate(String(feeOptions.fast))}
                                >
                                    <Text bold center style={{ color: colors.white }}>Fast</Text>
                                    <Text center style={{ color: colors.gray.light, fontSize: 12 }}>{feeOptions.fast} sat/vB</Text>
                                    <Text center style={{ color: colors.gray.light, fontSize: 10 }}>~{currentFeeRate ? Math.round((currentFeeRate/feeOptions.fast)*60) : '?'} min</Text>
                                </TouchableOpacity>
                            </View>
                            
                            <Text semibold style={{ marginBottom: 10, color: colors.white }}>Or enter custom rate:</Text>
                            <TextInput
                                style={{
                                    backgroundColor: colors.black.bg,
                                    borderRadius: 10,
                                    padding: 15,
                                    fontSize: 18,
                                    color: colors.white,
                                    marginBottom: 10,
                                }}
                                keyboardType="numeric"
                                value={newFeeRate}
                                onChangeText={setNewFeeRate}
                                placeholder="Custom fee rate"
                                placeholderTextColor={colors.gray.placeholder}
                            />
                        </View>
                    ) : (
                        <TextInput
                            style={{
                                backgroundColor: colors.black.bg,
                                borderRadius: 10,
                                padding: 15,
                                fontSize: 18,
                                color: colors.white,
                                marginBottom: 20,
                            }}
                            keyboardType="numeric"
                            value={newFeeRate}
                            onChangeText={setNewFeeRate}
                            placeholder="Enter fee rate (sat/vbyte)"
                            placeholderTextColor={colors.gray.placeholder}
                        />
                    )}

                    <TouchableOpacity 
                        style={[styles.button, { marginBottom: 10 }]} 
                        onPress={handleRBFSubmit}
                        disabled={isRBFSubmitting}
                    >
                        <Text bold h4 style={styles.text}>
                            {isRBFSubmitting ? 'Processing...' : 'Accelerate'}
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={[styles.button, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.gray.light }]} 
                        onPress={() => rbfSheetRef.current?.close()}
                    >
                        <Text bold h4 style={[styles.text, { color: colors.white }]}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </RBSheet>
        </ScreenLayout>
    )
}
