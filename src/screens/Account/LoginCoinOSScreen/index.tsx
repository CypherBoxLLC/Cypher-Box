import React, { useEffect, useState } from "react";
import { TouchableOpacity, View, Image, Platform, Button } from "react-native";
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

// Strike OAuth configuration
const config = {
    id: 'strike',
    name: 'Strike',
    type: 'oauth',
    issuer: "https://auth.strike.me", // Strike Identity Server URL
    clientId: "cypherbox",
    clientSecret: "SbYmuewpZGS8XDktirso8ficpChSGu7dEaYuMrLx+3k=", // If needed (but avoid hardcoding secrets in client-side code)
    redirectUrl: "cypherbox://oauth/callback", // Must match the redirect URI in your Strike app settings
    scopes: ["offline_access", "partner.balances.read", "partner.currency-exchange-quote.read", "partner.account.profile.read", "profile", "openid", "partner.invoice.read", "partner.invoice.create", "partner.invoice.quote.generate", "partner.invoice.quote.read", "partner.rates.ticker"], // Specify necessary scopes
    //clientAuthMethod: "post",
    //wellKnown: `https://auth.strike.me/.well-known/openid-configuration`,
    // authorization: {
    //     params: {
    //         scope: 'partner.invoice.read offline_access',
    //         response_type: 'code',
    //     }
    // },
    idToken: false,
    checks: ['pkce', 'state'],
    // serviceConfiguration: {
    //   authorizationEndpoint: "https://auth.strike.me/oauth/authorize",
    //   tokenEndpoint: "https://auth.strike.me/oauth/token",
    //   revocationEndpoint: "https://auth.strike.me/oauth/revoke",
    // },
};

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

    useEffect(() => {
        if(userCreds){
            setEmail(userCreds.email);
            setPassword(userCreds.password)
            setIsRememberMe(userCreds.isRememberMe)
        }
    }, [userCreds])

    const handleLogin = async () => {
        try {
            const result = await authorize(config);
            console.log("Access Token:", result);
            setAccessToken(result.accessToken);
        } catch (error) {
            console.error("OAuth error", error);
        }
    };
    
    const nextClickHandler = async () => {
        setIsLoading(true);
        if (email == "") {
            SimpleToast.show("Please enter your username", SimpleToast.SHORT);
            setIsLoading(false);
            return;
        } else if (password == "") {
            SimpleToast.show("Please enter your password", SimpleToast.SHORT);
            setIsLoading(false);
            return;
        }

        try {
            const response: any = await loginUser(email, password);
            console.log("User Login successful:", response);
            if (response.token) {
                setAuth(true);
                setToken(response?.token);
                setUser(response?.user);
                const temp = [...allBTCWallets];
                setAllBTCWallets([...temp, 'COINOS']);
                dispatchReset("HomeScreen");
                if(isRememberMe){
                    setUserCreds({email, password, isRememberMe});
                } else {
                    setUserCreds(undefined);
                }
            } else {
                SimpleToast.show("Invalid usernmae or password", SimpleToast.SHORT);
            }

            // await AsyncStorage.setItem("viewWithdraw", "1");
        } catch (error: any) {
            console.error("Error login user:", error?.message);
            SimpleToast.show(error?.message, SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    };

    const forgotClickHandler = () => {
        dispatchNavigate('ForgotCoinOSScreen')
    }

    const toggleIsRememberMe = (value: boolean | ((prevState: boolean) => boolean)) => {
        setIsRememberMe(value)
    }

    console.log('accessToken: ', accessToken)
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
        </ScreenLayout>
    )
}
