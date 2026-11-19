import React, { useRef, useState } from "react";
import { Image, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import { Icon } from 'react-native-elements';

import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { SavingVault, SwipeButton } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import loc from "../../../loc";

interface Props {
    route: any;
}

export default function PurchaseVault({ route }: Props) {
    const { data } = route?.params;

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

    const nextClickHandler = () => {

    }

    const editAmountClickHandler = () => {
        dispatchNavigate('EditAmount', {
            sats: sats,
            usd: usd,
            setSats: setSats_
        });
    }

    const editFeesClickHandler = () => {
        setVisibleSelection(true);
    }

    const setSats_ = (sats: any, usd: any) => {
        setUSD(usd);
        const value = Number(sats) / 10000;
        setSats(value + 'K sats ~$' + usd);
        setSatsEditable(true);
    }

    const setNetFee_ = (sats: any, usd: any) => {
        setFeeUSD(usd);
        setNetworkFees(sats);
        setFeesEditable(true);
    }

    const selectFeesClickHandler = (index: number) => {
        console.log("🚀 ~ selectFeesClickHandler ~ index:", index);
        setVisibleSelection(false);
        setSelectedFees(index);
        setFeesEditable(true);
        if (index === 3) {
            dispatchNavigate('FeeRate', {
                networkFees: networkFees,
                feeUSD: feeUSD,
                setNetFee_: setNetFee_
            });
        }
    }

    const getFeesText = () => {
        let feesText = 'Medium';
        switch (selectedFees) {
            case 0:
                feesText = 'Fast';
                break;
            case 1:
                feesText = 'Medium';
                break;
            case 2:
                feesText = 'Show';
                break;
            case 3:
                feesText = 'Customize';
                break;
            default:
                break;
        }
        return feesText;
    }

    const handleToggle = (val: any) => {
        console.log("🚀 ~ handleToggle ~ value:", val)
        if (val) {
            // handleSendSats();
            dispatchNavigate('TransactionNew');
        }
    }

    return (
        <ScreenLayout showToolbar disableScroll>
            <View style={styles.container}>
                <Text style={styles.title} center>{loc.cypherbox.vault.purchase_vault.title}</Text>
                <SavingVault
                    container={styles.savingVault}
                    innerContainer={styles.savingVault}
                    shadowTopBottom={styles.savingVault}
                    shadowBottomBottom={styles.savingVault}
                    bitcoinText={styles.bitcoinText}
                    imageStyle={styles.bitcoinImage}
                    titleStyle={styles.titleVault}
                    title={loc.cypherbox.vault.purchase_vault.hot_savings}
                    bitcoinValue='0.1 BTC ~ $6500'
                // onPress={savingVaultClickHandler}
                />
                <View style={styles.recipientView}>
                    <Text bold style={styles.text}>{loc.formatString(loc.cypherbox.vault.purchase_vault.one_time_purchase, { price: <Text bold style={{ color: colors.green }}>30,000 sats  ~$5</Text> })}</Text>
                    <Text style={styles.text2}>{loc.cypherbox.vault.purchase_vault.deducted}</Text>
                    <Text style={styles.header}>{loc.cypherbox.vault.purchase_vault.features}</Text>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_withdraw_topup}</Text>
                    </View>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_send_receive}</Text>
                    </View>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_coin_control}</Text>
                    </View>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_fee_estimator}</Text>
                    </View>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_transfer_cold}</Text>
                    </View>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_own_node}</Text>
                    </View>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_multiple_addresses}</Text>
                    </View>
                    <View style={styles.flexView}>
                        <View style={styles.dot} />
                        <Text style={styles.desc}>{loc.cypherbox.vault.purchase_vault.feature_bip39}</Text>
                    </View>
                </View>
                <View style={{ alignSelf: 'center' }}>
                    <SwipeButton ref={swipeButtonRef} onToggle={handleToggle} isLoading={isSendLoading} />
                </View>
            </View>
        </ScreenLayout>
    )
}
