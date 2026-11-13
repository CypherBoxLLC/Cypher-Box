import React, { useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import SimpleToast from 'react-native-simple-toast';
import styles from "./styles";
import { GradientButton, GradientCard, GradientText } from "@Cypher/components";
import { useNavigation } from "@react-navigation/native";
import { InputEmailPhone } from "@Cypher/screens/Components";
import { Button, Input, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import { emailRegex, passwordRegex } from "@Cypher/helpers/regex";
import { loginUser, registerUser } from "@Cypher/api/coinOSApis";
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchReset } from "@Cypher/helpers/navigation";
import loc from "../../../../loc";

export default function CreateCoinOSScreen() {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const passwordRef = useRef<TextInput>(null);
    const emailRef = useRef<TextInput>(null);
    const { setToken, setAuth, setUser } = useAuthStore();

    const loginClickHandler = () => {
        console.log('login click');
        dispatchReset('ChangeUsername', { username: email });
    }

    const createClickHandler = async () => {
        setIsLoading(true);
        if(email == "") {
            SimpleToast.show(loc.cypherbox.account.common.enter_username, SimpleToast.SHORT);
            setIsLoading(false);
            return;
        } else if(password == ""){
            SimpleToast.show(loc.cypherbox.account.common.enter_password, SimpleToast.SHORT);
            setIsLoading(false);
            return;
        } 
        // else if (!validateEmail(email)) {
        //     SimpleToast.show('Please enter a valid email address.', SimpleToast.SHORT);
        //     setIsLoading(false);
        //     return;
        // } 
        else if (!validatePassword(password)) {
            SimpleToast.show(loc.cypherbox.account.create_coinos.password_rules, SimpleToast.LONG);
            setIsLoading(false);
            return;
        }

        try {
            const response: any = await registerUser(email, password);
            console.log('User registration successful:', response);
            if(response == "null user") {
                const responseLogin: any = await loginUser(email, password);
                console.log("User Login successful:", response);
                if (responseLogin.token) {
                    setAuth(true);
                    setToken(responseLogin?.token);
                    setUser(responseLogin?.user);
                    loginClickHandler();                
                    setEmail('');
                    setPassword('');
                } else {
                    SimpleToast.show(loc.cypherbox.account.common.invalid_credentials, SimpleToast.SHORT);
                }
    
            } else {
                SimpleToast.show(response, SimpleToast.SHORT);
            }
        } catch (error: any) {
            console.error('Error registering user:', error?.message);
            SimpleToast.show(error?.message, SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    }

    const validateEmail = (email: string) => {
        return emailRegex.test(email);
    }

    const validatePassword = (password: string) => {
        return passwordRegex.test(password);
    }

    return (
        <ScreenLayout disableScroll showToolbar progress={1}>
            <View style={styles.container}>
                {/* <View style={styles.innerView}>
                    <GradientText>Create Coinos Account</GradientText>
                    <InputEmailPhone label={`E-mail`} setText={setPhone} text={phone} type="email-address" style={{ marginTop: 50 }} />
                    <InputEmailPhone label="Password" setText={setEmail} text={email} />
                    <Button style={StyleSheet.flatten(styles.button)} textStyle={styles.text} text="Create Account" onPress={createClickHandler} />
                </View>
                <Text style={styles.create}>Already have an an account with Coinos?</Text> */}
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.create_coinos.title}</GradientText>
                    <View style={styles.space} />
                    {/* <GradientCard style={styles.gradient} colors_={username ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                        <Input onChange={setUsername}
                            value={username}
                            style={styles.textInput}
                            returnKeyType="next"
                            onSubmitEditing={() => emailRef?.current?.focus() }
                            label="Username"
                        />
                    </GradientCard> */}
                    <View style={styles.extra} />
                    <GradientCard style={styles.gradient} colors_={email ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                        <Input onChange={setEmail}
                            ref={emailRef}
                            value={email}
                            style={styles.textInput}
                            returnKeyType="next"
                            onSubmitEditing={() => passwordRef?.current?.focus() }
                            // keyboardType="email-address"
                            label={loc.cypherbox.account.common.username}
                        />
                    </GradientCard>
                    <View style={styles.extra} />
                    <GradientCard style={styles.gradient} colors_={password ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                        <Input onChange={setPassword}
                            ref={passwordRef}
                            value={password}
                            style={styles.textInput}
                            secureTextEntry
                            maxLength={15}
                            label={loc.cypherbox.account.common.password}
                        />
                    </GradientCard>
                </View>
                <GradientButton 
                    title={loc.cypherbox.account.create_coinos.create_account} 
                    onPress={createClickHandler} 
                    disabled={!email.length || !password.length || isLoading}
                />
            </View>
        </ScreenLayout>
    )
}
