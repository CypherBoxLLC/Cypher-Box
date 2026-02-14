import React, { useEffect, useState } from "react";
import { Image, TouchableOpacity, View } from "react-native"
import styles from "./styles";
import GradientTab from "../GradientTab";
import LinearGradient from "react-native-linear-gradient";
import GradientButton from "../GradientButton";
import { Cancel, Currency, CurrencyWhite, CurrencyEUR, Sats } from "@Cypher/assets/images";
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
    maxBalance?: number;
}

export default function CustomKeyBoard({ title, prevSats, disabled, onPress, setSATS, setUSD, setIsSATS, isError, matchedRate, currency = 'USD', colors_ = [colors.pink.extralight, colors.pink.default], isGradient = true, maxBalance }: Props) {
    const KEYSARRAY = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'MAX', '0'];
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState(prevSats || '');
    const currencyBTC = btc(1);

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
    }, [sats, isSats]);

    const prevIsSats = React.useRef(isSats);
    useEffect(() => {
        if (!prevSats) {
            setSats('');
            setSATS('');
            setUSD('');
        }
        // Convert value when switching between sats and USD
        if (prevIsSats.current !== isSats && sats.length > 0) {
            const currentValue = Number(sats);
            if (currentValue > 0) {
                if (isSats) {
                    // Was USD, now sats: convert USD → sats
                    const converted = Math.round((currentValue / Number(matchedRate || 1)) * SATS);
                    setSats(String(converted));
                } else {
                    // Was sats, now USD: convert sats → USD
                    const converted = (currentValue / SATS * (Number(matchedRate) || 0)).toFixed(2);
                    setSats(String(converted));
                }
            }
        }
        prevIsSats.current = isSats;
        setIsSATS(isSats);
    }, [isSats, prevSats]);

    const handlePress = (value: string) => {
        setSats((prev) => prev + value);
    };

    const handleDelete = () => {
        setSats((prev) => prev.slice(0, -1));
    };

    const handleMax = () => {
        if (maxBalance && maxBalance > 0) {
            if (isSats) {
                setSats(String(Math.floor(maxBalance)));
            } else {
                const usdAmount = (maxBalance / SATS * (Number(matchedRate) || 0)).toFixed(2);
                setSats(String(usdAmount));
            }
        }
    };

    return (
        <View style={styles.container}>
            {/*Need to change the secondTabImg according to Strike */}
            <GradientTab tabColor_={colors_} firstTabImg={Sats} secondTabImg={currency === 'EUR' ? CurrencyEUR : isSats ? Currency : CurrencyWhite} tab1="Sats" tab2={currency || "USD"} isSats={isSats} setIsSats={setIsSats} />
            <LinearGradient
                start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                colors={colors_}
                style={styles.linearGradient} />
            <View style={styles.keypad}>
                {KEYSARRAY.map((key) => (
                    key === 'MAX' ? (
                        <TouchableOpacity key={key} style={styles.key} onPress={handleMax}>
                            <LinearGradient
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                                colors={colors_}
                                style={styles.maxButton}
                            >
                                <Text bold style={styles.maxText}>MAX</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity key={key} style={styles.key} onPress={() => handlePress(key)}>
                            <Text style={styles.keyText}>{key}</Text>
                        </TouchableOpacity>
                    )
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
