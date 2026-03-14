import React, { useContext, useEffect, useState } from "react";
import { Linking, StyleSheet, TouchableOpacity, View } from "react-native";
import dayjs from "dayjs";
import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import TextView from "./TextView";
import { btc } from "@Cypher/helpers/coinosHelper";
import { formatBalance } from "../../../loc";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { colors } from "@Cypher/style-guide";
import useAuthStore from "@Cypher/stores/authStore";

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
        const url = `https://www.blockchain.com/btc/tx/${transaction?.txid}`;
        Linking.openURL(url).catch(err => console.error('An error occurred', err));
    }

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
                    <TouchableOpacity style={[styles.button, { marginBottom: 20 }, vaultTab && { borderColor: colors.coldGreen}]}>
                        <Text bold h4 style={styles.text}>Accelrate transaction</Text>
                    </TouchableOpacity>
                }
                <TouchableOpacity style={[styles.button, vaultTab && { borderColor: colors.coldGreen}]} onPress={handleViewBtcNetExplorerClickHandler}>
                    <Text bold h4 style={styles.text}>View in Bitcoin Network Explorer</Text>
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    )
}
