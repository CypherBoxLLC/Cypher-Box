import React, { useState, useEffect } from "react";
import { View, TouchableOpacity } from "react-native";
import QRCode from "react-native-qrcode-svg";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { GradientButton, GradientCard, GradientText } from "@Cypher/components";
import { colors, rtl } from "@Cypher/style-guide";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchGoBack } from "@Cypher/helpers";
import { getOTPsecret, enableTwoFA } from "@Cypher/api/coinOSApis";
import loc from "../../../../loc";

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
            SimpleToast.show(error?.message || loc.cypherbox.account.enable_2fa.load_failed, SimpleToast.LONG);
            dispatchGoBack();
        } finally {
            setIsLoading(false);
        }
    };

    const handleEnable = async () => {
        if (verificationCode.length !== 6) {
            SimpleToast.show(loc.cypherbox.account.common.valid_6_digit_code, SimpleToast.SHORT);
            return;
        }

        setIsLoading(true);
        try {
            await enableTwoFA(verificationCode);
            SimpleToast.show(loc.cypherbox.account.enable_2fa.enabled_toast, SimpleToast.SHORT);
            dispatchGoBack();
        } catch (error: any) {
            console.error('Error enabling 2FA:', error);
            SimpleToast.show(error?.message || loc.cypherbox.account.common.invalid_code_retry, SimpleToast.SHORT);
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
                        <GradientText>{loc.cypherbox.account.enable_2fa.title}</GradientText>
                        <View style={styles.space} />
                        
                        <Text h4 style={styles.description}>
                            {loc.cypherbox.account.enable_2fa.intro_desc}
                        </Text>

                        <View style={styles.featureList}>
                            <Text style={styles.featureItem}>
                                {loc.cypherbox.account.enable_2fa.feature_code}
                            </Text>
                            <Text style={styles.featureItem}>
                                {loc.cypherbox.account.enable_2fa.feature_protects}
                            </Text>
                            <Text style={styles.featureItem}>
                                {loc.cypherbox.account.enable_2fa.feature_backup}
                            </Text>
                        </View>

                        <View style={styles.extra} />
                        <GradientButton 
                            title={loc.cypherbox.account.enable_2fa.get_started} 
                            disabled={isLoading}
                            onPress={() => setStep('scan')} 
                        />
                        <View style={styles.extra} />
                        <GradientButton 
                            title={loc._.cancel} 
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
                        <GradientText>{loc.cypherbox.account.enable_2fa.scan_title}</GradientText>
                        <View style={styles.space} />
                        
                        <Text h4 style={styles.description}>
                            {loc.cypherbox.account.enable_2fa.scan_desc}
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
                            <Text style={styles.secretLabel}>{loc.cypherbox.account.enable_2fa.enter_manually}</Text>
                            <Text style={[styles.secretText, rtl.ltrText]}>{otpSecret}</Text>
                        </GradientCard>

                        <View style={styles.extra} />
                        <GradientButton 
                            title={loc.cypherbox.account.common.next} 
                            onPress={() => setStep('verify')} 
                        />
                        <View style={styles.extra} />
                        <GradientButton 
                            title={loc.cypherbox.account.common.back} 
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
                    <GradientText>{loc.cypherbox.account.enable_2fa.verify_title}</GradientText>
                    <View style={styles.space} />
                    
                    <Text h4 style={styles.description}>
                        {loc.cypherbox.account.enable_2fa.verify_desc}
                    </Text>

                    <GradientCard style={{ width: '100%' }} colors_={verificationCode ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
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
                        title={loc.cypherbox.account.enable_2fa.enable_button} 
                        disabled={verificationCode.length !== 6 || isLoading}
                        onPress={handleEnable}
                    />
                    <View style={styles.extra} />
                    <GradientButton 
                        title={loc.cypherbox.account.common.back} 
                        onPress={() => setStep('scan')}
                        colors={[colors.gray.thin, colors.gray.thin2]}
                    />
                </View>
            </View>
        </ScreenLayout>
    );
}
