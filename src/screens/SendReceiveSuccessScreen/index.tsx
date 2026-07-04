import React, { useEffect, useState } from "react";
import { Image } from "react-native";
import styles from "./styles";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { Electricity } from "@Cypher/assets/images";
import { dispatchReset } from "@Cypher/helpers/navigation";

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
            <Text subHeader style={styles.text}>{isReceive_ ? 'Boom!' : 'Zapped!'}</Text>
            <Image style={styles.image} source={Electricity} resizeMode="contain" />
            <Text subHeader style={styles.text}>{`Payment ${isReceive_ ? 'Received' : 'Sent'}`}</Text>
            <Text subHeader style={styles.text}>{isReceive_ ? `${value} sats` : `${value} sats`}</Text>
            {!isReceive_ &&
                <Text subHeader style={styles.subtext}>{`$${valueUsd}`}</Text>
            }
        </ScreenLayout>
    )
}