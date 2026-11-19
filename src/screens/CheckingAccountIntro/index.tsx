import React from "react";
import { View, Image} from "react-native";
import { useNavigation } from "@react-navigation/native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import loc from "../../../loc";

// On-demand explainer about custodial Lightning risk. Previously this
// screen was a one-time gate on the way to CheckingAccountLogin — gated
// by `hasSeenCustodialWarning` in authStore. That coupling was removed
// (see HomeScreen.loginClickHandler) so the screen is now reached only
// via the "?" icon next to the CUSTODIAL section header in
// CheckingAccountLogin. The CTA accordingly just dismisses (goBack)
// instead of advancing the user.
export default function CheckingAccountIntro() {
    const navigation = useNavigation();

    const closeHandler = () => {
        navigation.goBack();
    };

    return (
        <ScreenLayout showToolbar progress={0} color={[colors.pink.light, colors.pink.light]}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text style={styles.title}>{loc.cypherbox.account.checking_intro.title}</Text>
                    <Text h4 style={styles.descption}>{loc.cypherbox.account.checking_intro.body}
                      {'\n\n'}
                      {loc.cypherbox.account.checking_intro.caution}
                    </Text>
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        alignSelf:'center',
                        justifyContent:'center',
                        flex: 1
                    }}>
                        <Image
                        source={require('@Cypher/assets/images/warningemoji.png')}
                                            style={{height: 100, width: 100, alignSelf: 'center', resizeMode:'contain'}}
                                            resizeMode="contain"
                        />
                    </View>
                </View>
                <Button text={loc.cypherbox.account.checking_intro.got_it} onPress={closeHandler} style={styles.button} textStyle={styles.btnText} />
            </View>
        </ScreenLayout>
    )
}
