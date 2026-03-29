import React, { useEffect, useState } from "react";
import { View } from "react-native";
import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { CustomKeyboard, GradientInput } from "@Cypher/components";

interface Props {
    navigation: any;
    route: any;
}

export default function WithdrawThreshold({ navigation, route }: Props) {
    const { title, titleBtn, index, matchedRate, currency } = route?.params;
    const [isSats, setIsSats] = useState(true);
    const [isError, setIsError] = useState(false);
    const [isLow, setIsLow] = useState(false);
    const [isHigh, setIsHigh] = useState(false);
    const [sats, setSats] = useState('');
    const [usd, setUSD] = useState('');

    useEffect(() => {
        if (sats.length) {
            const amount = isSats ? sats : usd;
            const multiplier = isSats ? 0.000594 : 1683.79;
            const total = multiplier * Number(sats);
            const total_ = total.toFixed(4);
            setUSD(total_);
            console.log(multiplier, multiplier < 10000);
            if (index == 0 && Number(amount) < 2000000) {
                console.log('low');
                setIsError(true);
                setIsLow(true);
                setIsHigh(false);
            } else if (index == 0 && Number(amount) > 10000000) {
                console.log('high');
                setIsError(true);
                setIsHigh(true);
                setIsLow(false);
            } else if (index == 1 && Number(amount) < 100000) {
                console.log('low');
                setIsError(true);
                setIsLow(true);
                setIsHigh(false);
            } else if (index == 1 && Number(amount) > 2000000) {
                console.log('high');
                setIsError(true);
                setIsHigh(true);
                setIsLow(false);
            } else {
                console.log('else');
                setIsError(false);
                setIsHigh(false);
                setIsLow(false);
            }
        } else {
            setUSD('');
            setIsError(false);
            setIsLow(false);
            setIsHigh(false);
        }
    }, [sats, isSats]);

    const setClickHandler = () => {
        // dispatchNavigate('ThresholdAdjust');
        route?.params?.onSelect(isSats ? sats : usd, route?.params?.index);
        navigation.pop();
    }

    return (
        <ScreenLayout showToolbar isBackButton title={title}>
            <View style={styles.container}>
                <GradientInput walletInfo={route?.params} isSats={isSats} sats={sats} setSats={setSats} usd={usd} />
                {isError && isLow && index == 0 &&
                    <Text style={styles.error}>Withdrawal threshold is too low, indicating that you would incur a higher network fee if you intend to take self-custody of the funds in the future. We recommend keeping it between 2M to 10M sats.</Text>
                }
                {isError && isLow && index == 1 &&
                    <Text style={styles.error}>Reserve Amount is too low, indicating that you would incur a higher network fee if you intend to take self-custody of the funds in the future. We recommend keeping it between 100k to 2M sats.</Text>
                }
                {isError && isHigh && index == 0 &&
                    <Text style={styles.error}>Withdraw Threshold is too high, indicating an unnecessary exposure to counter-party risk since your assets will be under the custody and control of a bitcoin custodian (Coinos) for an extended period. We recommend keeping it between 2M to 10M sats.</Text>
                }
                {isError && isHigh && index == 1 &&
                    <Text style={styles.error}>Reserve Amount is too high, indicating an unnecessary exposure to counter-party risk since your assets will be under the custody and control of a bitcoin custodian (Coinos) for an extended period. We recommend keeping it between 100K to 2M sats.</Text>
                }
            </View>
            <CustomKeyboard
                title={isError ? 'Set anyways ' : titleBtn}
                onPress={setClickHandler}
                disabled={!sats.length}
                setSATS={setSats}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                isError={isError}
                matchedRate={matchedRate}
                currency={currency || 'USD'}
            />
        </ScreenLayout>
    )
}
