import React, { useState, useEffect } from "react";
import { View, TouchableOpacity } from "react-native";
import QRCode from "react-native-qrcode-svg";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { GradientButton, GradientCard, GradientText } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchGoBack } from "@Cypher/helpers";
import { getOTPsecret, enableTwoFA } from "@Cypher/api/coinOSApis";

export default function EnableTwoFA() {
    const [otpSecret, setOtpSecret] = useState<string | null>(null);
    const [username, setUsername] = useState<string>('');
    const [verificationCode, setVerificationCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [step, setStep] = useState<'intro' | 'scan' | 'verify'>('intro');

    useEffect(() => {
        loadOTPSecret();
    }, []);

    const loadOTPSecret = async () => {
        try {
            setIsLoading(true);
            const data = await getOTPsecret();
            setOtpSecret(data.secret);
            setUsername(data.username);
        } catch (error: any) {
            console.error('Error loading OTP secret:', error);
            SimpleToast.show(error?.message || 'Failed to load 2FA setup. Please try again.', SimpleToast.LONG);
            dispatchGoBack();
        } finally {
            setIsLoading(false);
        }
    };

    const handleEnable = async () => {
        if (verificationCode.length !== 6) {
            SimpleToast.show('Please enter a valid 6-digit code', SimpleToast.SHORT);
            return;
        }

        setIsLoading(true);
        try {
            await enableTwoFA(verificationCode);
            SimpleToast.show('2FA enabled successfully!', SimpleToast.SHORT);
            dispatchGoBack();
        } catch (error: any) {
            console.error('Error enabling 2FA:', error);
            SimpleToast.show(error?.message || 'Invalid code. Please try again.', SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    };

    // Generate otpauth URL for QR code
    const otpAuthUrl = otpSecret 
        ? `otpauth://totp/CypherBox:${username}?secret=${otpSecret}&issuer=CypherBox`
        : '';

    if (step === 'intro') {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.container}>
                    <View style={styles.innerView}>
                        <GradientText>Enable Two-Factor Authentication</GradientText>
                        <View style={styles.space} />
                        
                        <Text h4 style={styles.description}>
                            Add an extra layer of security to your CoinOS account using an authenticator app like Google Authenticator, Authy, or 1Password.
                        </Text>

                        <View style={styles.featureList}>
                            <Text style={styles.featureItem}>
                                📱 Requires a 6-digit code from your device
                            </Text>
                            <Text style={styles.featureItem}>
                                🔒 Protects your account even if password is compromised
                            </Text>
                            <Text style={styles.featureItem}>
                                ⚠️ Keep your backup codes safe
                            </Text>
                        </View>

                        <View style={styles.extra} />
                        <GradientButton 
                            title="Get Started" 
                            disabled={isLoading}
                            onPress={() => setStep('scan')} 
                        />
                        <View style={styles.extra} />
                        <GradientButton 
                            title="Cancel" 
                            disabled={isLoading}
                            onPress={dispatchGoBack}
                            colors={[colors.gray.thin, colors.gray.thin2]}
                        />
                    </View>
                </View>
            </ScreenLayout>
        );
    }

    if (step === 'scan') {
        return (
            <ScreenLayout showToolbar>
                <View style={styles.container}>
                    <View style={styles.innerView}>
                        <GradientText>Scan QR Code</GradientText>
                        <View style={styles.space} />
                        
                        <Text h4 style={styles.description}>
                            Scan this QR code with your authenticator app, or enter the secret key manually.
                        </Text>

                        {otpSecret && (
                            <View style={styles.qrContainer}>
                                <QRCode
                                    value={otpAuthUrl}
                                    size={200}
                                    color={colors.pink.default}
                                    backgroundColor={colors.white}
                                />
                            </View>
                        )}

                        <GradientCard style={{ width: '100%' }} colors_={[colors.gray.thin, colors.gray.thin2]}>
                            <Text style={styles.secretLabel}>Or enter manually:</Text>
                            <Text style={styles.secretText}>{otpSecret}</Text>
                        </GradientCard>

                        <View style={styles.extra} />
                        <GradientButton 
                            title="Next" 
                            onPress={() => setStep('verify')} 
                        />
                        <View style={styles.extra} />
                        <GradientButton 
                            title="Back" 
                            onPress={() => setStep('intro')}
                            colors={[colors.gray.thin, colors.gray.thin2]}
                        />
                    </View>
                </View>
            </ScreenLayout>
        );
    }

    // Verify step
    return (
        <ScreenLayout showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>Verify Setup</GradientText>
                    <View style={styles.space} />
                    
                    <Text h4 style={styles.description}>
                        Enter the 6-digit code from your authenticator app to verify everything is working.
                    </Text>

                    <GradientCard style={{ width: '100%' }} colors_={verificationCode ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
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
                        title="Enable 2FA" 
                        disabled={verificationCode.length !== 6 || isLoading}
                        onPress={handleEnable}
                    />
                    <View style={styles.extra} />
                    <GradientButton 
                        title="Back" 
                        onPress={() => setStep('scan')}
                        colors={[colors.gray.thin, colors.gray.thin2]}
                    />
                </View>
            </View>
        </ScreenLayout>
    );
}
