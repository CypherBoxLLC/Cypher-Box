import React from "react";
import { Linking, Platform, View } from "react-native";
import styles from "./styles";
import { GradientText } from "@Cypher/components";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import loc from "../../../../loc";

export default function DownloadBlink() {

    const loginClickHandler = () => {
        dispatchNavigate('LoginBlink');
    }

    const appleStoreClickHandler = () => {
        const link =
            Platform.OS === 'android' ?
                'https://play.google.com/store/apps/details?id=com.galoyapp' :
                'https://apps.apple.com/ng/app/blink-bitcoin-beach-wallet/id1531383905'
        Linking.canOpenURL(link).then(supported => {
            supported && Linking.openURL(link);
        }, (err) => console.log(err));
    }

    return (
        <ScreenLayout disableScroll showToolbar progress={0}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.download_blink.title}</GradientText>
                    <Text h4 style={styles.descption}>{loc.cypherbox.account.download_blink.desc}</Text>
                    <Button onPress={appleStoreClickHandler} text={loc.cypherbox.account.download_blink.download_button} leftIcon="logo-apple" textStyle={{color:colors.black.default}}/>
                </View>
                <Text style={styles.info}>{loc.cypherbox.account.download_blink.info}</Text>
                <Button onPress={loginClickHandler} text={loc.cypherbox.account.common.login} style={styles.login} textStyle={{color:colors.black.default}}/>
            </View>
        </ScreenLayout>
    )
}
