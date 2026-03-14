import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import TextView from "./TextView";
import { CoinOS } from "@Cypher/assets/images";
import { getTransactionDetail } from "@Cypher/api/coinOSApis";
import { btc } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";
import dayjs from "dayjs";
import { dispatchNavigate } from "@Cypher/helpers";

interface Props {
    route: any;
}

export default function InvoiceNew({ route }: Props) {
    const { item, receiveType } = route?.params;
    const [isLoading, setIsLoading] = useState(false);
    const [note, setNote] = useState('');
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
        const url = `https://www.blockchain.com/btc/tx/${historyDetail?.ref || historyDetail?.hash}`;
        Linking.openURL(url).catch(err => console.error('An error occurred', err));
    }

    const amountSent = (Number(satsAmount) + ((0.1 / 100) * Number(satsAmount)));
    const totalFee = (Number(((Number(satsAmount) + ((0.1 / 100) * Number(satsAmount))) * (0.1 / 100))) + Number((historyDetail?.fee + (historyDetail?.ourfee || 0))))
    const percentageFee = ((totalFee / amountSent) * 100).toFixed(2)

    const buyClickHandler = () => {
        dispatchNavigate('PaymentSuccess');
    }

    return (
        <ScreenLayout showToolbar isBackButton title="Review Payment">
            {!!isLoading ? (
                <ActivityIndicator size={100} color={colors.white} />
            ) : (
                <View style={styles.main}>
                    <View style={styles.container}>
                        <TextView keytext="Recipient will get: " text="100K sats  ~$40" />
                        <TextView keytext="Sent from: " text="Coinos Lightning Account" />

                        <TextView keytext="To: " text={`Bitcoin Address: \nbc1s....efwef`} />
                        <Text style={styles.fees}>Fees:  ~   0 sat</Text>
                        <TextInput
                            value={note}
                            onChangeText={setNote}
                            placeholder="Add note"
                            placeholderTextColor={colors.white}
                            style={styles.textInput}
                        />
                    </View>
                    <TouchableOpacity style={styles.button} onPress={buyClickHandler}>
                        <Text h3 style={{color: colors.black.default}}>BUY</Text>
                    </TouchableOpacity>
                </View>
            )}
        </ScreenLayout>
    )
}

