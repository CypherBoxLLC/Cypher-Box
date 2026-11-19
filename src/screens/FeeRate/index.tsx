import React, { useRef, useState } from "react";
import { Image, ScrollView, StyleSheet, TextInput, View } from "react-native";
import styles from "./styles";
import loc from "../../../loc";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { CustomKeyboardNew, GradientInput, GradientInputNew } from "@Cypher/components";
import { colors, } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";

interface Props {
    route: any;
    navigation: any;
}

export default function FeeRate({ route, navigation }: Props) {
    const { setCustomFee, wallet, utxo, ids, inUSD, total, matchedRate } = route?.params;
    const [isSats, setIsSats] = useState(true);
    const [sats, setSats] = useState('');
    const [usd, setUSD] = useState('');
    const [sender, setSender] = useState('');

    const nextClickHandler = () => {
        route?.params?.setCustomFee(sats);
        navigation?.pop();
    }

    return (
        <ScreenLayout disableScroll showToolbar isBackButton >
            <ScrollView style={styles.container} contentContainerStyle={styles.container}>
                <GradientInputNew isSats={isSats} sats={sats} setSats={setSats} usd={usd} title={loc.cypherbox.payments.fee_rate.title} isFeeesRate />
            </ScrollView>
            <CustomKeyboardNew
                title={loc.cypherbox.payments.common.next}
                onPress={nextClickHandler}
                disabled={!sats.length}
                setSATS={setSats}
                setUSD={setUSD}
                setIsSATS={setIsSats}
                isConverter={false}
            />
        </ScreenLayout>
    )
}
