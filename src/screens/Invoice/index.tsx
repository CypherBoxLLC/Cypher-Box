import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, StyleSheet, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import loc from "../../../loc";
import { ScreenLayout, Text } from "@Cypher/component-library";
import TextView from "./TextView";
import { CoinOS } from "@Cypher/assets/images";
import { getTransactionDetail } from "@Cypher/api/coinOSApis";
import { btc } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";
import dayjs from "dayjs";

interface Props {
    route: any;
}

export default function Invoice({ route }: Props) {
    const { item, receiveType } = route?.params;
    const [isLoading, setIsLoading] = useState(true);
    const [historyDetail, setHistoryDetail] = useState<any>();
    const { id: transactionId, matchedRate } = route?.params;
    const satsAmount = historyDetail?.amount ? historyDetail?.amount.toString().replace('-', '') : "";
    const amountSign = historyDetail?.amount < 0 ? "-" : "+";
    const currency = btc(1);
    const dollarAmount = satsAmount * matchedRate * currency;
    const roundedNumber = historyDetail?.rate ? Number(historyDetail?.rate)?.toFixed(2) : 0;
  
    // Format as currency
    const formattedCurrency = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(roundedNumber);
  
    console.log('item: ', item)
    useEffect(() => {
      if (item?.id || item?.txid) {
        getHistoryDetail(item?.id || item?.txid);
      }
    }, [item?.id, item?.txid]);
  
    const getHistoryDetail = async (id: number) => {
      try {
        const paymentList = await getTransactionDetail(id);
        console.log(paymentList);
        setHistoryDetail(paymentList);
      } catch (error) {
        console.error('Error loading transaction detail:', error);
      } finally {
        setIsLoading(false);
      }
    };
  
    const handleViewBtcNetExplorerClickHandler = () => {
        // mempool.space is the default explorer across the rest of the app
        // (Ark tx details, BlueWallet 6.5.1's send/broadcast + transaction
        // status screens). Standardising here so vault transaction history
        // taps don't bounce between providers.
        // #details fragment auto-expands the inputs/outputs section on
        // mempool.space so we land on the full transaction view rather
        // than the mobile-collapsed summary.
        const url = `https://mempool.space/tx/${historyDetail?.ref || historyDetail?.hash}#details`;
        Linking.openURL(url).catch(err => console.error('An error occurred', err));
    }

    const amountSent = (Number(satsAmount) + ((0.1 / 100) * Number(satsAmount)));
    const totalFee = (Number(((Number(satsAmount) + ((0.1 / 100) * Number(satsAmount))) * (0.1 / 100))) + Number((historyDetail?.fee + (historyDetail?.ourfee || 0))))
    const percentageFee = ((totalFee / amountSent) * 100).toFixed(2)
  
    return (
        <ScreenLayout showToolbar isBackButton title={loc.cypherbox.payments.invoice.title}>
            {!!isLoading ? (
                <ActivityIndicator size={100} color={colors.white} />
            ) : (
                <View style={styles.main}>
                    <View style={{flex: 1}}>
                    <View style={styles.valueView}>
                        <Text semibold style={StyleSheet.flatten([styles.sats, { color: amountSign == '+' ? '#4FBF67' : '#FF7A68' }])}>{`${amountSign}${satsAmount} sats`}</Text>
                        <Text bold subHeader>{`$${dollarAmount.toFixed(2)}`}</Text>
                    </View>
                    <TextView keytext={loc.cypherbox.payments.common.sent_from_label} text={historyDetail?.amount < 0 ? loc.cypherbox.payments.common.my_coinos_lightning_account : historyDetail?.with ? historyDetail?.with?.username : loc.cypherbox.payments.invoice.unknown} />
                    {(historyDetail?.with || historyDetail?.amount > 0) &&
                        <TextView keytext={loc.cypherbox.payments.common.to_label} text={historyDetail?.amount > 0 ? loc.cypherbox.payments.common.my_coinos_lightning_account : historyDetail?.with?.username} />
                    }
                    {((historyDetail?.type == 'bitcoin' || historyDetail?.type == 'liquid') && historyDetail?.amount < 0) ?
                        <>
                            <TextView keytext={loc.cypherbox.payments.common.network_fee_label} text={`~${(historyDetail?.fee || 0)} sats`} />
                            {historyDetail?.ourfee > 0 && (
                                <TextView keytext={loc.cypherbox.payments.common.coinos_fee_label} text={`~${(historyDetail?.ourfee || 0)} sats`} />
                            )}
                            {/* <TextView keytext={`Service Fee (0.1%):  `} text={`~${((Number(satsAmount) + ((0.1 / 100) * Number(satsAmount))) * (0.1 / 100)).toFixed(2)} sats`} /> */}
                            <TextView keytext={loc.cypherbox.payments.common.total_fee_label} text={`~${(Number(((Number(satsAmount) + ((0.1 / 100) * Number(satsAmount))) * (0.1 / 100)).toFixed(2)) + Number((historyDetail?.fee + (historyDetail?.ourfee || 0)))).toFixed(2)} sats ${" ("+percentageFee+"%)"}`} />
                        </>
                        :
                            <TextView keytext={loc.cypherbox.payments.invoice.fee_label} text={`~${(historyDetail?.fee || 0)} sats`} />
                    }

                    <TextView keytext={loc.cypherbox.payments.common.date_label} text={dayjs(historyDetail?.created).format('HH:mm:ss MM/DD/YYYY')} />
                    {/* <TextView keytext="At bitcoin exchange rate:  " text={formattedCurrency} /> */}

                    {item?.type === 'bitcoin' ?
                        <TouchableOpacity style={styles.button} onPress={handleViewBtcNetExplorerClickHandler}>
                            <Text bold h4 style={styles.text}>{loc.cypherbox.payments.common.view_in_explorer}</Text>
                        </TouchableOpacity>
                        :
                        (historyDetail?.type == 'bitcoin' || historyDetail?.type == 'liquid') ? (
                            <TextView keytext={loc.cypherbox.payments.common.txid_label} text={historyDetail?.ref || historyDetail?.hash} />
                        ) : (
                            <TextView keytext={loc.cypherbox.payments.invoice.lightning_preimage} text={historyDetail?.ref} />
                        )
                    }
                    </View>
                    <View style={styles.bottomView}>
                        <Image source={CoinOS} />
                    </View>
                </View>
            )}
        </ScreenLayout>
    )
}