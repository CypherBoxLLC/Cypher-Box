import React, { useEffect, useState } from "react";
import { Image, TouchableOpacity, View } from "react-native"
import styles from "./styles";
import GradientTab from "../GradientTab";
import LinearGradient from "react-native-linear-gradient";
import GradientButton from "../GradientButton";
import { Cancel, Currency, CurrencyWhite, Sats } from "@Cypher/assets/images";
import { Text } from "@Cypher/component-library";
import { btc, SATS } from "@Cypher/helpers/coinosHelper";
import { colors } from "@Cypher/style-guide";

interface Props {
    onPress(): void;
    setSATS(sats: string): void;
    setUSD(usd: string): void;
    setIsSATS(isSats: boolean): void;
    disabled?: boolean;
    title: string;
    prevSats: string | boolean;
    isError?: boolean;
    matchedRate?: number;
    currency?: string;
    colors_?: string[];
    isGradient?: boolean;
}

export default function CustomKeyBoard({ title, prevSats, disabled, onPress, setSATS, setUSD, setIsSATS, isError, matchedRate, colors_ = [colors.pink.extralight, colors.pink.default], isGradient = true }: Props) {
    const KEYSARRAY = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState(prevSats || '');
    const currency = btc(1);

    useEffect(() => {
        if (sats.length) {
            let amount = 0;
            console.log('sats: ', sats);
            console.log('matchedRate: ', matchedRate);
            if (!isSats) {
                amount = ((Number(sats || 0) / Number(matchedRate || 0)) * SATS).toFixed(2)
                console.log('amount 0: ', amount);
                setSATS(sats);
                setUSD(String(amount));
            } else {
                amount = ((Number(sats) / SATS * (Number(matchedRate) || 0))).toFixed(2);
                console.log('amount 1: ', amount);
                // const multiplier = isSats ? 0.000594 : 1683.79;
                // const total = multiplier * Number(sats);
                // const total_ = total.toFixed(4);
                setSATS(String(sats));
                setUSD(String(amount));
            }
        } else {
            setUSD('');
            setSATS('');
        }
    }, [sats.length, isSats]);

    useEffect(() => {
        if (!prevSats) {
            setSats('');
            setSATS('');
            setUSD('');
        }
        setIsSATS(isSats);
    }, [isSats, prevSats]);

    const handlePress = (value: string) => {
        setSats((prev) => prev + value);
    };

    const handleDelete = () => {
        setSats((prev) => prev.slice(0, -1));
    };

    return (
        <View style={styles.container}>
            <GradientTab tabColor_={colors_} firstTabImg={Sats} secondTabImg={isSats ? Currency : CurrencyWhite} tab1="Sats" tab2="USD" isSats={isSats} setIsSats={setIsSats} />
            <LinearGradient
                start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                colors={colors_}
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
            {isGradient ?
                <GradientButton style={styles.invoiceButton} textStyle={{ fontFamily: 'Lato-Medium', }}
                    title={title}
                    disabled={disabled}
                    isError={isError}
                    onPress={onPress} />
                :
                <TouchableOpacity onPress={onPress} disabled={disabled} style={{ width: '90%', opacity: disabled ? 0.5 : 1 }}>
                    <LinearGradient style={{
                        height: 47,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: '#FFFCFC',
                    }}
                        colors={['#2A2A2A', '#1E1E1E']}
                    >
                        <Text h3>{title}</Text>
                    </LinearGradient>
                </TouchableOpacity>
            }
        </View>
    )
}
