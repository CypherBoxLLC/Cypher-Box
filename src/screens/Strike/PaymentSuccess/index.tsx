import React, { useEffect, useState } from "react";
import { ScreenLayout, Text } from "@Cypher/component-library";
import styles from "./styles";
import { Image, TouchableOpacity, View } from "react-native";
import { Close, GradientShock } from "@Cypher/assets/images";

interface Props {
    navigation: any;
    route: any;
}

export default function PaymentSuccess({ navigation, route }: Props) {

    const onClosePress = () => {
        navigation?.pop(3)
    }

    return (
        <ScreenLayout showToolbar isBackButton={false} isClose>
            {/* <TouchableOpacity onPress={onClosePress} style={styles.closeContainer}>
                <Image source={Close} style={styles.close} />
            </TouchableOpacity> */}
            <View style={styles.container}>
                <Text semibold style={styles.title}>Payment Sent</Text>
                <Text semibold style={styles.value}>10,000 sats</Text>
                <Text semibold style={styles.value}>$8.78</Text>
                <Text bold style={styles.to}>To: Satoshi@cypherbox.io</Text>
                <Image source={GradientShock} style={styles.image} />
                <Text semibold style={styles.accType}>Lightning Network</Text>
            </View>
        </ScreenLayout>
    )
}

