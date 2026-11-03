import React, { useState } from "react";
import { TextInput, View } from "react-native";
import styles from "./styles";
import { GradientButton, GradientText } from "@Cypher/components";
import { useNavigation } from "@react-navigation/native";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import loc from "../../../../loc";

export default function LoginBlinkPhone() {
    const [phone, setPhone] = useState<string>('');

    const nextClickHandler = () => {
        dispatchNavigate('VerifyPhone', { phone: phone });
    }

    return (
        <ScreenLayout disableScroll showToolbar progress={1}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.common.login_to_blink}</GradientText>
                    <Text h2 semibold style={styles.title}>{loc.cypherbox.account.login_blink_phone.login_with_phone}</Text>
                    <TextInput
                        value={phone}
                        onChangeText={setPhone} keyboardType='phone-pad'
                        returnKeyType="done"
                        maxLength={10}
                        style={styles.textInput} />
                </View>
                <GradientButton title={loc.cypherbox.account.login_blink_phone.sms} onPress={nextClickHandler} disabled={phone.length < 10} />
                <View style={styles.space} />
                <GradientButton title={loc.cypherbox.account.login_blink_phone.send_via_whatsapp} onPress={nextClickHandler} disabled={phone.length < 10} />
            </View>
        </ScreenLayout>
    )
}
