import React, { useEffect, useState } from "react";
import { Image, TouchableOpacity, View } from "react-native"
import styles from "./styles";
import LinearGradient from "react-native-linear-gradient";
import { Bitcoin, Cancel, Currency, CurrencyWhite, Sats, Small } from "@Cypher/assets/images";
import { Text } from "@Cypher/component-library";
import { btc, SATS } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";
import GradientTabNew from "../GradientTabNew";

interface Props {
    onPress(): void;
    setSATS(sats: string): void;
    setUSD(usd: string): void;
    setIsSATS(isSats: boolean): void;
    disabled?: boolean;
    title: string;
    prevSats?: string;
    isError?: boolean;
    matchedRate?: number;
    currency?: string;
    isConverter?: boolean;
    firstTabText?: string;
    isEdit?: string;
    vaultTab?: boolean;
}

export default function CustomKeyBoardNew({ vaultTab, isEdit, prevSats, title, disabled, onPress, setSATS, setUSD, setIsSATS, isError, matchedRate, isConverter = true, firstTabText = "Sats" }: Props) {
    const KEYSARRAY = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState(prevSats || '');
    const currency = btc(1);

    // useEffect(() => {
    //     console.log('prevSats: ', prevSats)
    //     if(sats !== prevSats && prevSats)
    //         setSats(prevSats)
    // }, [prevSats])
    useEffect(() => {
        if (sats.length > 0) {
            let amount = 0;
            if (isSats) {
                amount = ((Number(sats || 0) * Number(matchedRate || 0))).toFixed(2)
                setSATS(sats);
                setUSD(String(amount));
            } else {
                amount = ((Number(sats || 0) / (Number(matchedRate) || 1))).toFixed(2);
                // const multiplier = isSats ? 0.000594 : 1683.79;
                // const total = multiplier * Number(sats);
                // const total_ = total.toFixed(4);
                setSATS(String(sats));
                setUSD(String(amount));
            }
        } else {
            setUSD('0');
            setSATS('0');
        }
    }, [sats.length, isSats]);

    useEffect(() => {
        if(!isEdit){
            setSats('');
            setSATS('0');
            setUSD('0');
        }
        setIsSATS(isSats);    
    }, [isSats, isEdit]);

    const handlePress = (value: string) => {
        setSats((prev) => prev + value);
    };

    const handleDelete = () => {
        setSats((prev) => prev.slice(0, -1));
    };

    return (
        <View style={styles.container}>
            {isConverter &&
                <GradientTabNew
                    firstTabImg={firstTabText === "Sats" ? Sats : isSats ? Bitcoin : Small}
                    secondTabImg={isSats ? Currency : CurrencyWhite}
                    tab1={firstTabText}
                    tab2="USD"
                    isSats={isSats}
                    setIsSats={setIsSats}
                    imageStyle={{ width: 33, height: 33, marginTop: 0, marginStart: -5 }}
                    textStyle={{ marginStart: 15, fontFamily: 'Lato-Medium' }}
                    vaultTab={vaultTab}
                />
            }
            <LinearGradient
                start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                colors={vaultTab ? [colors.cold.gradient1, colors.cold.gradient2] : [colors.green, colors.green]}
                style={styles.linearGradient} />
            <View style={styles.keypad}>
                {KEYSARRAY.map((key) => (
                    <TouchableOpacity key={key} style={styles.key} onPress={() => handlePress(key)}>
                        <Text style={styles.keyText}>{key}</Text>
                    </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.key} onPress={handleDelete}>
                    <Image source={Cancel} />
                </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.nextBtn, vaultTab && { backgroundColor: colors.coldGreen }, disabled && {backgroundColor: colors.gray.disable}]}>
                <Text h3>Next</Text>
            </TouchableOpacity>
        </View>
    )
}
