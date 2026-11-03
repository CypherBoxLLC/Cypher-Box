import React, { useState } from "react";
import { View } from "react-native";
import styles from "./styles";
import { GradientButton, GradientText } from "@Cypher/components";
import { useNavigation } from "@react-navigation/native";
import InputEmailPhone from "./InputEmailPhone";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import loc from "../../../../loc";

export default function LoginBlink() {
    const [email, setEmail] = useState<string | null>(null);
    const [phone, setPhone] = useState<string | null>(null);
    const { navigate } = useNavigation();

    const nextClickHandler = () => {
        dispatchNavigate('LoginBlinkPhone');
    }

    return (
        <ScreenLayout disableScroll showToolbar progress={1}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.common.login_to_blink}</GradientText>
                    <Text h2 bold style={styles.title}>{loc.cypherbox.account.login_blink.question}</Text>
                    <Text h4 style={styles.title}>{loc.cypherbox.account.login_blink.desc}</Text>
                    <InputEmailPhone label={loc.cypherbox.account.login_blink.phone_number} setText={setPhone} text={phone} type="phone-pad" />
                    <View style={styles.view}>
                        <View style={styles.line} />
                        <Text bold style={styles.or}>{loc.cypherbox.account.login_blink.or}</Text>
                        <View style={styles.line} />
                    </View>
                    <InputEmailPhone label={loc.cypherbox.account.login_blink.email_label} setText={setEmail} text={email} type="email-address" />
                </View>
                <GradientButton title={loc.cypherbox.account.common.home} onPress={nextClickHandler} />
            </View>
        </ScreenLayout>
    )
}
