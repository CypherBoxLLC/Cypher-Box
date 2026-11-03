import React, { useState } from "react";
import { View } from "react-native";
import SimpleToast from "react-native-simple-toast";

import styles from "./styles";
import loc from "../../../loc";
import { ScreenLayout } from "@Cypher/component-library";
import { CustomKeyboard, GradientInput } from "@Cypher/components";
import { dispatchNavigate } from "@Cypher/helpers";
import { createInvoice } from "@Cypher/api/coinOSApis";
import { createInvoice as createInvoiceStrike } from "@Cypher/api/strikeAPIs";
import { getStrikeCurrency } from "@Cypher/helpers/coinosHelper";

export default function CreateInvoice({navigation, route}: any) {
    const {matchedRate, currency, receiveType} = route.params
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState('');
    const [usd, setUSD] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // const createInvoice = () => {
    //     dispatchNavigate('CopyInvoice', {
    //         value: isSats ? `Receive ${sats} sats` : `Receive ${sats} USD`,
    //         converted: isSats ? `$ ${usd}` : `${usd} sats`,
    //     });
    // }

    console.log('sats: ', sats);
    console.log('usd: ', usd);
    console.log('isSats: ', isSats)
    const handleCreateInvoice = async () => {
        setIsLoading(true);
        if(!sats) {
            SimpleToast.show(loc.cypherbox.payments.common.enter_amount, SimpleToast.SHORT);
            setIsLoading(false);
            return;
        }
        try {
            console.log('receiveType: ', receiveType)
            const response = receiveType ? await createInvoice({
                amount: isSats ? Number(sats) : Number(usd),
                type: 'lightning',
            }) : await createInvoiceStrike({
                bolt11: {
                    amount: {
                        amount: isSats ? Number(usd) : Number(sats),
                        currency: currency || "USD"
                    },
                    expiryInSeconds: 3600 // 1h: a receive invoice a human must scan + pay; 60s was far too short (LN norm is ~1h)
                },
                targetCurrency: "BTC" // Cypher Box: receive as Bitcoin, no auto-convert to fiat
              });
            const hash = receiveType ? response.hash : response.bolt11?.invoice
            console.log('hash: ', hash)
            navigation.replace('CopyInvoice', {
                value: isSats ? String(loc.formatString(loc.cypherbox.payments.create_invoice.receive_sats, { amount: sats })) : String(loc.formatString(loc.cypherbox.payments.create_invoice.receive_fiat, { amount: sats, currency: currency || 'USD' })),
                converted: isSats ? `${getStrikeCurrency(currency || 'USD')} ${usd}` : `${usd} sats`,
                hash: hash,
                receiveType
            });

            // navigation.navigate('CreatedInvoice', {invoice: response})

            console.log('response: ', response)
        } catch (error) {
            console.error('Error creating invoice:', error);
            SimpleToast.show(loc.cypherbox.payments.create_invoice.create_failed, SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ScreenLayout disableScroll showToolbar isBackButton title={loc.cypherbox.payments.create_invoice.title}>
            <View style={styles.main}>
            <GradientInput isSats={isSats} walletInfo={route.params} sats={sats} setSats={setSats} usd={usd} />
            </View>
            <CustomKeyboard
                title={loc.cypherbox.payments.create_invoice.create_invoice}
                onPress={handleCreateInvoice}
                disabled={!sats.length || isLoading}
                setSATS={setSats}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                matchedRate={matchedRate}
                currency={currency}
                // Invoices have no "max" semantics — the receiver picks
                // any amount they want to be paid. MAX is a send-side
                // affordance (drain the wallet); suppress it on receive.
                hideMax
            />
        </ScreenLayout>
    )
}
