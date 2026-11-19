import React, { useEffect, useState } from "react";
import { Image } from "react-native";
import styles from "./styles";
import loc from "../../../loc";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { Electricity } from "@Cypher/assets/images";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { rtl } from "@Cypher/style-guide";

interface Props {
    route?: any;
}

export default function SendReceiveSuccessScreen({ route }: Props) {
    const { isReceive, value, valueUsd } = route?.params;
    const [isReceive_] = useState(isReceive);

    useEffect(() => {
        setTimeout(() => {
            // Reset stack — Ark send path (ArkSendScreen → SendReceiveSuccessScreen)
            // left mounted under HomeScreen on iOS Fabric otherwise. See
            // TransactionBroadCast for the full half-mount explanation.
            dispatchReset('HomeScreen');
        }, 3000);
    }, []);

    return (
        <ScreenLayout>
            <Text subHeader style={styles.text}>{isReceive_ ? loc.cypherbox.payments.send_receive_success.boom : loc.cypherbox.payments.send_receive_success.zapped}</Text>
            <Image style={styles.image} source={Electricity} resizeMode="contain" />
            <Text subHeader style={styles.text}>{isReceive_ ? loc.cypherbox.payments.send_receive_success.payment_received : loc.cypherbox.payments.send_receive_success.payment_sent}</Text>
            <Text subHeader style={[styles.text, rtl.ltrText]}>{isReceive_ ? `${value} sats` : `${value} sats`}</Text>
            {!isReceive_ &&
                <Text subHeader style={[styles.subtext, rtl.ltrText]}>{`$${valueUsd}`}</Text>
            }
        </ScreenLayout>
    )
}