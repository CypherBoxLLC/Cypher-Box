import React, { useState } from "react";
import { TextInput, View } from "react-native";
import styles from "./styles";
import { GradientButton } from "@Cypher/components";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import loc from "../../../../loc";

interface Props {
    route: any;
}

export default function VerifyPhone({ route}:Props) {
    const [code, setCode] = useState<string>('');

    const nextClickHandler = () => {
        dispatchNavigate('AccountStatus');
    }

    return (
        <ScreenLayout disableScroll showToolbar progress={1}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text h2 semibold style={styles.title}>{loc.formatString(loc.cypherbox.account.verify_phone.enter_code, { phone: route?.params?.phone })}</Text>
                    <TextInput
                        value={code}
                        onChangeText={setCode}
                        keyboardType='phone-pad'
                        returnKeyType="done"
                        maxLength={6}
                        style={styles.textInput}
                        placeholder="000-000"
                    />
                </View>
                <GradientButton title={loc.cypherbox.account.common.submit} onPress={nextClickHandler} disabled={code.length < 6} />
            </View>
        </ScreenLayout>
    )
}
