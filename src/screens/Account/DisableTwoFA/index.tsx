import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { GradientButton, GradientCard, GradientText } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchGoBack } from "@Cypher/helpers";
import { disableTwoFA } from "@Cypher/api/coinOSApis";

export default function DisableTwoFA() {
    const [verificationCode, setVerificationCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleDisable = async () => {
        if (verificationCode.length !== 6) {
            SimpleToast.show('Please enter a valid 6-digit code', SimpleToast.SHORT);
            return;
        }

        setIsLoading(true);
        try {
            await disableTwoFA(verificationCode);
            SimpleToast.show('2FA disabled successfully', SimpleToast.SHORT);
            dispatchGoBack();
        } catch (error: any) {
            console.error('Error disabling 2FA:', error);
            SimpleToast.show(error?.message || 'Invalid code. Please try again.', SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>Disable 2FA</GradientText>
                    <View style={styles.space} />
                    
                    <Text h4 style={styles.warningText}>
                        ⚠️ Warning: Disabling two-factor authentication will make your account less secure.
                    </Text>

                    <Text style={styles.description}>
                        Enter the 6-digit code from your authenticator app to disable 2FA.
                    </Text>

                    <GradientCard style={{ width: '100%' }} colors_={[colors.gray.thin, colors.gray.thin2]}>
                        <Input 
                            onChange={setVerificationCode}
                            value={verificationCode}
                            style={styles.textInput}
                            keyboardType="numeric"
                            maxLength={6}
                            placeholder="000000"
                            label="Authentication Code"
                        />
                    </GradientCard>

                    <View style={styles.extra} />
                    <GradientButton 
                        title="Disable 2FA" 
                        disabled={verificationCode.length !== 6 || isLoading}
                        onPress={handleDisable}
                    />
                    <View style={styles.extra} />
                    <GradientButton 
                        title="Cancel" 
                        onPress={dispatchGoBack}
                        colors={[colors.gray.thin, colors.gray.thin2]}
                    />
                </View>
            </View>
        </ScreenLayout>
    );
}
