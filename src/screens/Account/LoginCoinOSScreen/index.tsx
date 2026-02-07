import React, { useEffect, useState } from "react";
import { TouchableOpacity, View, Image, Platform, Button, Modal, StyleSheet } from "react-native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { GradientButton, GradientCard, GradientText } from "@Cypher/components";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { loginUser } from "@Cypher/api/coinOSApis";
import useAuthStore from "@Cypher/stores/authStore";
import { CoinOS } from "@Cypher/assets/images";
import CheckBox from '@react-native-community/checkbox';
import { authorize } from "react-native-app-auth";
import RecaptchaV3 from "./RecaptchaV3";
import RecaptchaV2 from "./RecaptchaV2";

// Strike OAuth configuration
const SITE_KEY = "6LfCd8YkAAAAANmVJgzN3SQY3n3fv1RhiS5PgMYM"; // from env

export default function LoginCoinOSScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRememberMe, setIsRememberMe] = useState(false);
    const {
        userCreds,
        allBTCWallets,
        setToken, 
        setAuth, 
        setUser, 
        setUserCreds,
        setAllBTCWallets,
    } = useAuthStore();
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [captchaToken, setCaptchaToken] = useState("");
    const [showCaptcha, setShowCaptcha] = useState(false);

    useEffect(() => {
        if(userCreds){
            setEmail(userCreds.email);
            setPassword(userCreds.password)
            setIsRememberMe(userCreds.isRememberMe)
        }
    }, [userCreds])

    const handleCaptchaToken = (token: string) => {
        console.log('Captcha verified, proceeding with login...');
        setCaptchaToken(token);
        setShowCaptcha(false);
        // Automatically proceed with login after captcha
        performLogin(token);
    };

    const performLogin = async (recaptchaToken: string) => {
        setIsLoading(true);
        
        try {
            const response: any = await loginUser(email, password, recaptchaToken);
            console.log("User Login successful:", response);
            
            if (response.token) {
                setAuth(true);
                setToken(response.token);
                setUser(response.user);
                const temp = [...allBTCWallets];
                setAllBTCWallets([...temp, 'COINOS']);
                
                if(userCreds) {
                    setUserCreds({email, password, isRememberMe: true});
                }
                
                dispatchReset("HomeScreen");
            } else {
                SimpleToast.show("Invalid username or password", SimpleToast.SHORT);
                setCaptchaToken(""); // Reset to allow retry
            }
        } catch (error: any) {
            console.error("Error login user:", error?.message);
            
            // More specific error messages
            if (error?.message?.includes('Captcha')) {
                SimpleToast.show("Captcha verification failed. Please try again.", SimpleToast.LONG);
            } else if (error?.message?.includes('429')) {
                SimpleToast.show("Too many attempts. Please wait and try again.", SimpleToast.LONG);
            } else {
                SimpleToast.show(error?.message || "Login failed. Please try again.", SimpleToast.SHORT);
            }
            
            // Reset captcha on error so user can try again
            setCaptchaToken("");
        } finally {
            setIsLoading(false);
        }
    };

    const nextClickHandler = async () => {
        if (email === "") {
            SimpleToast.show("Please enter your username", SimpleToast.SHORT);
            return;
        }
        if (password === "") {
            SimpleToast.show("Please enter your password", SimpleToast.SHORT);
            return;
        }

        // Show captcha modal
        setShowCaptcha(true);
    };

    const forgotClickHandler = () => {
        dispatchNavigate('ForgotCoinOSScreen');
    };

    const closeCaptcha = () => {
        setShowCaptcha(false);
        setCaptchaToken("");
    };

    const toggleIsRememberMe = (value: boolean | ((prevState: boolean) => boolean)) => {
        setIsRememberMe(value)
    }

    console.log('captchaToken: ', captchaToken)
    return (
        <ScreenLayout keyboardAware showToolbar>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>Login to Coinos</GradientText>
                    <View style={styles.space} />
                    <GradientCard style={{ width: '100%' }} colors_={email ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                        <Input 
                            onChange={setEmail}
                            value={email}
                            style={styles.textInput}
                            // keyboardType="email-address"
                            label="Username"
                        />
                    </GradientCard>
                    <View style={styles.extra} />
                    <GradientCard style={{ width: '100%' }} colors_={password ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                        <Input onChange={setPassword}
                            value={password}
                            style={styles.textInput}
                            secureTextEntry
                            // maxLength={15}
                            label="Password"
                        />
                    </GradientCard>
                    {/* <Button title="Login with Strike" onPress={handleLogin} /> */}
                    {/* {accessToken && <Text>Access Token: {accessToken}</Text>} */}
                    {/* <View 
                        style={{ 
                            marginTop: 15,
                            flexDirection: 'row',
                            alignItems: 'center',
                            alignSelf: 'flex-start'
                        }} 
                    >
                        <CheckBox
                            boxType="square"
                            disabled={false}
                            // tintColors={{ true: colors.pink.default, false: colors.pink.default }}
                            tintColor={colors.pink.default}
                            tintColors={{ true: colors.pink.default, false: colors.white }}
                            onTintColor={colors.pink.default}
                            onFillColor={colors.primary}
                            onCheckColor={colors.white}
                            style={{ transform: [{ scaleX: Platform.OS == 'ios' ? 0.8 : 1 }, { scaleY: Platform.OS == 'ios' ? 0.8 : 1 }] }}
                            value={isRememberMe}
                            onValueChange={(newValue) => toggleIsRememberMe(newValue)}
                        />
                        <Text bold style={styles.rememberMe}>
                            Remember Me
                        </Text>
                    </View> */}
                    <TouchableOpacity style={{ marginTop: 18, alignSelf: 'flex-end' }} onPress={forgotClickHandler}>
                        <Text bold style={styles.forgot}>
                            Forgot Password?
                        </Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.coinOsImage}>
                    <Image source={CoinOS} />
                </View>
                <GradientButton title="Login" disabled={!email.length || !password.length || isLoading} onPress={nextClickHandler} />
            </View>
            <Modal
                visible={showCaptcha}
                animationType="none"
                onRequestClose={closeCaptcha}
                presentationStyle="fullScreen"
            >
                <View style={modalStyles.modalContainer}>
                    <RecaptchaV2
                        siteKey={SITE_KEY}
                        onToken={handleCaptchaToken}
                        baseUrl="https://coinos.io"
                    />                    
                    <TouchableOpacity
                        style={modalStyles.closeButton}
                        onPress={closeCaptcha}
                    >
                        <Text style={modalStyles.closeButtonText}>✕ Close</Text>
                    </TouchableOpacity>
                </View>
            </Modal>
        </ScreenLayout>
    )
}

const modalStyles = StyleSheet.create({
    modalContainer: {
        flex: 1,
        backgroundColor: '#1a1a1a',
    },
    closeButton: {
        position: 'absolute',
        top: 50,
        right: 20,
        backgroundColor: colors.pink.default,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    closeButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
});