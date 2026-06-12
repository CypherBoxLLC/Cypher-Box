import React, { useEffect, useState } from "react";
import { View } from "react-native";
import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { CustomKeyboard, GradientInput } from "@Cypher/components";

interface Props {
    navigation: any;
    route: any;
}

// Render a sats bound as a short human-readable string for the warning copy.
// 500_000 → "500K", 2_000_000 → "2M", 71 → "71". Always integer (no decimals)
// because the bounds are themselves round numbers.
function formatRange(n: number): string {
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return `${n}`;
}

export default function WithdrawThreshold({ navigation, route }: Props) {
    const { title, titleBtn, index, matchedRate, currency, colors_, hideMax } = route?.params;
    // --- Optional per-call validation overrides ---------------------------
    // Defaults preserve the original Strike/CoinOS bounds (2M–10M for the
    // withdraw threshold, 100K–2M for the reserve amount) so existing
    // callers don't change behaviour. Callers that mean a different rail
    // (e.g. Ark, where balances and dust thresholds live in a different
    // band) pass `minSats`/`maxSats` plus a `kind` string so the warning
    // copy reads correctly. The screen still lets the user "Set anyways"
    // outside the recommended band — these are guidance bounds, not hard
    // caps.
    const minSats: number =
        route?.params?.minSats ?? (index == 0 ? 2_000_000 : 100_000);
    const maxSats: number =
        route?.params?.maxSats ?? (index == 0 ? 10_000_000 : 2_000_000);
    const kindLabel: string = route?.params?.kindLabel ?? 'Lightning Account';
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
            if (index == 0 && Number(amount) < minSats) {
                console.log('low');
                setIsError(true);
                setIsLow(true);
                setIsHigh(false);
            } else if (index == 0 && Number(amount) > maxSats) {
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
                <GradientInput walletInfo={route?.params} isSats={isSats} sats={sats} setSats={setSats} usd={usd} colors_={colors_} />
                {isError && isLow && index == 0 &&
                    <Text style={styles.error}>Withdrawal threshold is too low, indicating that you would incur a higher network fee if you intend to take self-custody of the funds in the future. We recommend keeping it between {formatRange(minSats)} to {formatRange(maxSats)} sats.</Text>
                }
                {isError && isLow && index == 1 &&
                    <Text style={styles.error}>Reserve Amount is too low, indicating that you would incur a higher network fee if you intend to take self-custody of the funds in the future. We recommend keeping it between 100k to 2M sats.</Text>
                }
                {isError && isHigh && index == 0 &&
                    <Text style={styles.error}>Withdraw Threshold is too high, indicating an unnecessary exposure to counter-party risk since your assets will sit on the {kindLabel} for an extended period. We recommend keeping it between {formatRange(minSats)} to {formatRange(maxSats)} sats.</Text>
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
                colors_={colors_}
                hideMax={hideMax}
            />
        </ScreenLayout>
    )
}
