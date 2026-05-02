import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Image, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { CustomKeyboardNew, GradientInput, GradientInputNew } from "@Cypher/components";
import { colors, widths } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import VaultCapsules from "../../components/VaultCapsules";
import Capsule from "../HotStorageVault/Capsule";
import { btc as btcHandle } from "@Cypher/helpers/coinosHelper";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SATS = 100_000_000;

interface Props {
    route: any;
    navigation: any;
}

export default function SendScreen({ route, navigation }: Props) {
    const { isEdit, vaultTab, currency, wallet, utxo, ids, maxUSD, inUSD, total, toStrike, toArk = null, matchedRate, setSatsEdit, capsulesData = null, to = null, vaultSend, isBatch, capsuleTotal, title } = route?.params;
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState('0');
    const [usd, setUSD] = useState('0');
    const [sender, setSender] = useState('');
    const senderRef = useRef<TextInput>(null);

    const isVaultFlow = !!(capsulesData && capsulesData.length > 0);

    useEffect(() => {
        if (total && inUSD && isEdit) {
            setSats(String(total) || "0")
            setUSD(String(inUSD) || "0")
        }
    }, [total, inUSD, isEdit])

    const nextClickHandler = () => {
        setSatsEdit && setSatsEdit();
        dispatchNavigate('ColdStorage', { wallet, currency, vaultTab, utxo, ids, maxUSD, inUSD: isSats ? usd : sats, total: isSats ? sats : usd, matchedRate, capsulesData, vaultSend, toStrike, toArk, to, title, isBatch, capsuleTotal });
    }

    const maxSendClickHandler = () => {
        setSatsEdit && setSatsEdit();
        dispatchNavigate('ColdStorage', { wallet, currency, vaultTab, utxo, ids, maxUSD, inUSD: inUSD, total: total, isMaxEdit: true, matchedRate, capsulesData, vaultSend, to, toStrike, toArk, title, isBatch, capsuleTotal });
    }

    // Convert current typed amount to sats for the dynamic capsule
    const currentSatsAmount = useMemo(() => {
        const val = Number(sats) || 0;
        if (isSats) {
            // sats field holds BTC value (since firstTabText="BTC")
            return Math.round(val * SATS);
        } else {
            const btcVal = Number(usd) || 0;
            return Math.round(btcVal * SATS);
        }
    }, [sats, usd, isSats, matchedRate]);

    // Total of selected capsules in BTC and USD
    const totalSelectedSats = useMemo(() => {
        if (!capsulesData) return 0;
        return capsulesData.reduce((acc: number, c: any) => acc + (c.value || 0), 0);
    }, [capsulesData]);

    const { totalBTC, totalUSD } = useMemo(() => {
        const btcVal = btcHandle(totalSelectedSats);
        const usdVal = Number(btcVal) * Number(matchedRate || 0);
        return { totalBTC: String(btcVal), totalUSD: usdVal.toFixed(2) };
    }, [totalSelectedSats, matchedRate]);

    // Change capsule = total selected - sending amount
    const changeSatsAmount = useMemo(() => {
        if (currentSatsAmount <= 0 || currentSatsAmount >= totalSelectedSats) return 0;
        return totalSelectedSats - currentSatsAmount;
    }, [currentSatsAmount, totalSelectedSats]);

    const primaryColor = vaultTab ? colors.coldGreen : colors.green;

    // Get memo/label for a capsule UTXO
    const getMemo = (item: any): string | null => {
        if (!wallet?.getUTXOMetadata) return null;
        try {
            const parts = item.id ? item.id.split(':') : [item.txid, item.vout];
            const { memo } = wallet.getUTXOMetadata(parts[0], Number(parts[1]));
            return memo && memo !== "" ? memo : null;
        } catch { return null; }
    };

    return (
        <ScreenLayout disableScroll showToolbar isBackButton >
            <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
                <GradientInputNew isSats={isSats} sats={sats} setSats={setSats} usd={usd} title={'Specify  Amount'}
                    _colors={vaultTab ? [colors.cold.gradient1, colors.cold.gradient2] : [colors.green, colors.green]}
                />

                {isVaultFlow ? (
                    <>
                        {/* Selected capsules — horizontal scroll, no containers */}
                        <View style={{ marginTop: 14, marginBottom: 6 }}>
                            <Text bold style={{ fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 6 }}>
                                Selected capsules ({capsulesData.length})
                            </Text>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 2, alignItems: 'center', flexGrow: 1, justifyContent: 'center' }}
                            >
                                {capsulesData.map((cap: any, index: number) => {
                                    const memo = getMemo(cap);
                                    return (
                                        <View
                                            key={cap.id || index}
                                            style={{
                                                width: 70,
                                                marginRight: 10,
                                                alignItems: 'center',
                                            }}
                                        >
                                            <View style={{ width: 65, height: 14 }}>
                                                <VaultCapsules item={cap.value} isVault={vaultTab} />
                                            </View>
                                            <Text numberOfLines={1} style={{
                                                fontSize: 8,
                                                color: primaryColor,
                                                fontStyle: memo ? 'normal' : 'italic',
                                                marginTop: 4,
                                            }}>
                                                {memo || '(not labeled)'}
                                            </Text>
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        </View>

                        {/* Total + MAX button */}
                        <View style={{ alignItems: 'center', marginTop: 6, marginBottom: 4 }}>
                            <TouchableOpacity
                                onPress={maxSendClickHandler}
                                activeOpacity={0.7}
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    backgroundColor: vaultTab ? colors.coldGreen : colors.green,
                                    borderRadius: 10,
                                    paddingVertical: 8,
                                    paddingHorizontal: 16,
                                }}
                            >
                                <Text bold style={{ fontSize: 13, color: '#000' }}>
                                    Max: {totalBTC} BTC
                                </Text>
                                <Text style={{ fontSize: 11, color: '#000', marginLeft: 6 }}>~${totalUSD}</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Sending capsule + Change capsule side by side */}
                        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6, marginBottom: 4 }}>
                            {/* Sending capsule */}
                            <View style={{ alignItems: 'center', width: 140 }}>
                                <Text style={{ fontSize: 10, color: '#fff', marginBottom: 6 }}>
                                    Outgoing capsule
                                </Text>
                                <View style={{
                                    width: 140,
                                    height: 20,
                                    marginLeft: 40,
                                    opacity: currentSatsAmount > 0 ? 1 : 0.3,
                                }}>
                                    {currentSatsAmount > 0 ? (
                                        <View style={{ width: '100%', height: 14 }}>
                                            <Capsule item={{ value: currentSatsAmount, height: 1, confirmations: 1 }} wallet={null} onPress={() => {}} handleChoose={() => {}} ids={[]} vaultTab={vaultTab} />
                                        </View>
                                    ) : (
                                        <View style={{
                                            width: '46%',
                                            height: 14,
                                            borderRadius: 4.5,
                                            borderWidth: 1,
                                            borderColor: '#444',
                                            backgroundColor: '#222',
                                            alignSelf: 'center',
                                        }} />
                                    )}
                                </View>
                            </View>

                            {/* Change capsule — only if amount < total and > 0 */}
                            {changeSatsAmount > 0 && (
                                <View style={{ alignItems: 'center', width: 140, marginLeft: 20 }}>
                                    <Text style={{ fontSize: 10, color: '#fff', marginBottom: 6 }}>
                                        Change capsule
                                    </Text>
                                    <View style={{
                                        width: 140,
                                        height: 20,
                                        marginLeft: 40,
                                    }}>
                                        <View style={{ width: '100%', height: 14 }}>
                                            <Capsule item={{ value: changeSatsAmount, height: 1, confirmations: 1 }} wallet={null} onPress={() => {}} handleChoose={() => {}} ids={[]} vaultTab={vaultTab} />
                                        </View>
                                    </View>
                                </View>
                            )}
                        </View>
                        <Text style={{ fontSize: 11, color: '#fff', marginTop: 6, textAlign: 'center', paddingHorizontal: 24 }}>
                            How much of your selected capsules do you want to spend?
                        </Text>
                    </>
                ) : (
                    <>
                        <Text bold h2 center style={{ marginTop: 30, marginBottom: 25 }}>Total size of selected bars:{'\n'}{maxUSD} BTC</Text>
                        <TouchableOpacity onPress={maxSendClickHandler} style={[styles.btn, vaultTab && { backgroundColor: colors.coldGreen }]}>
                            <Text bold style={{ fontSize: 13 }}>Send Max: {maxUSD} BTC</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>
            <CustomKeyboardNew
                title="Next"
                onPress={nextClickHandler}
                prevSats={sats}
                isEdit={isEdit}
                disabled={!sats.length || Number(sats) == 0 || (isSats ? sats > maxUSD : usd > maxUSD)}
                setSATS={setSats}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                firstTabText="BTC"
                matchedRate={matchedRate}
                vaultTab={vaultTab}
            />
        </ScreenLayout>
    )
}
