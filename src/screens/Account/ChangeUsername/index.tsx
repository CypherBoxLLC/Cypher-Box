import React, { useState } from "react";
import { View } from "react-native";
import SimpleToast from "react-native-simple-toast";
import styles from "./styles";
import { GradientButton, GradientCard, GradientText } from "@Cypher/components";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import { getMe, updateUserName } from "@Cypher/api/coinOSApis";
import useAuthStore from "@Cypher/stores/authStore";
import { dispatchNavigate } from "@Cypher/helpers";
import { emailRegex } from "@Cypher/helpers/regex";
import loc from "../../../../loc";

export default function ChangeUsername({navigation, route}: any) {
    const username = route?.params?.username;
    const goBack = route?.params?.goBack;
    console.log('username: ', username)
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { setUser, token } = useAuthStore();

    const validateEmail = (email: string) => {
        return emailRegex.test(email);
    }

    const nextClickHandler = async () => {
        setIsLoading(true);
        if (email == "") {
            SimpleToast.show(loc.cypherbox.account.common.enter_username, SimpleToast.SHORT);
            setIsLoading(false);
            return;
        } else if (!validateEmail(email)) {
            SimpleToast.show(loc.cypherbox.account.common.valid_email, SimpleToast.SHORT);
            setIsLoading(false);
            return;
        } 

        try {
            const me: any = await getMe();
            console.log('me: ', me)

            const response: any = await updateUserName(me?.id, email);
            console.log("User Changed successful:", response);
            setUser(username);
            if (response && response !== 'Username taken' && response?.startsWith('{')) {
                const jsonResponse = JSON.parse(response);
                if(jsonResponse.ok){
                    SimpleToast.show(loc.cypherbox.account.change_username.verify_email_toast, SimpleToast.SHORT);    
                    if(goBack){
                        navigation.goBack();
                    } else {
                        dispatchNavigate('AccountStatus');
                    }
                }
            } else {
                SimpleToast.show(response, SimpleToast.SHORT);
            }
        } catch (error: any) {
            console.error("Error Username user:", error?.message);
            SimpleToast.show(error?.message, SimpleToast.SHORT);
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <ScreenLayout disableScroll showToolbar progress={username ? 1 : undefined} isBackButton={username ? false : true}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.change_username.recovery_email}</GradientText>
                    <View style={styles.space} />
                    <Text bold center style={{ fontSize: 18, lineHeight: 30, marginBottom: 20 }}>{loc.cypherbox.account.change_username.recovery_email_desc}</Text>
                    <GradientCard style={{width: '100%'}} colors_={email ? [colors.pink.extralight, colors.pink.default] : [colors.gray.thin, colors.gray.thin2]}>
                        <Input onChange={setEmail}
                            value={email}
                            style={styles.textInput}
                            // keyboardType="email-address"
                            label={loc.cypherbox.account.common.email}
                        />
                    </GradientCard>
                    <View style={styles.extra} />
                </View>
                <GradientButton title={loc.cypherbox.account.change_username.set_recovery_email} disabled={!email.length || isLoading} onPress={nextClickHandler} />
            </View>
        </ScreenLayout>
    )
}
