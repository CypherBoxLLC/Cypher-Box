import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { GradientButton, GradientCard, GradientText } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchGoBack } from "@Cypher/helpers";
import { disableTwoFA } from "@Cypher/api/coinOSApis";
import loc from "../../../../loc";

export default function DisableTwoFA() {
    const [verificationCode, setVerificationCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleDisable = async () => {
        if (verificationCode.length !== 6) {
            SimpleToast.show(loc.cypherbox.account.common.valid_6_digit_code, SimpleToast.SHORT);
            return;
        }

        setIsLoading(true);
        try {
            await disableTwoFA(verificationCode);
            SimpleToast.show(loc.cypherbox.account.disable_2fa.disabled_toast, SimpleToast.SHORT);
            dispatchGoBack();
        } catch (error: any) {
            console.error('Error disabling 2FA:', error);
            SimpleToast.show(error?.message || loc.cypherbox.account.common.invalid_code_retry, SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.disable_2fa.title}</GradientText>
                    <View style={styles.space} />
                    
                    <Text h4 style={styles.warningText}>
                        {loc.cypherbox.account.disable_2fa.warning}
                    </Text>

                    <Text style={styles.description}>
                        {loc.cypherbox.account.disable_2fa.desc}
                    </Text>

                    <GradientCard style={{ width: '100%' }} colors_={[colors.gray.thin, colors.gray.thin2]}>
                        <Input 
                            onChange={setVerificationCode}
                            value={verificationCode}
                            style={styles.textInput}
                            keyboardType="numeric"
                            maxLength={6}
                            placeholder="000000"
                            label={loc.cypherbox.account.common.authentication_code}
                        />
                    </GradientCard>

                    <View style={styles.extra} />
                    <GradientButton 
                        title={loc.cypherbox.account.disable_2fa.title} 
                        disabled={verificationCode.length !== 6 || isLoading}
                        onPress={handleDisable}
                    />
                    <View style={styles.extra} />
                    <GradientButton 
                        title={loc._.cancel} 
                        onPress={dispatchGoBack}
                        colors={[colors.gray.thin, colors.gray.thin2]}
                    />
                </View>
            </View>
        </ScreenLayout>
    );
}
