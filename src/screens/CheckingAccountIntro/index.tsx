import React from "react";
import { View, Image} from "react-native";
import styles from "./styles";
import { Button, ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import useAuthStore from "@Cypher/stores/authStore";

export default function CheckingAccountIntro() {
    const { setHasSeenCustodialWarning } = useAuthStore();

    const nextClickHandler = () => {
        console.log('next click');
        setHasSeenCustodialWarning(true);
        dispatchNavigate('CheckingAccountLogin');
    }

  
    return (
        <ScreenLayout showToolbar progress={0} color={[colors.pink.light, colors.pink.light]}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <Text style={styles.title}>Lightning Account</Text>
                    <Text h4 style={styles.descption}>To use Bitcoin efficiently, you can create a Lightning Account at a reliable custodian. This entity will help you send and receive payments globally, instantaneously, with ~zero fees. You can also use it to accumulate a measured amount of bitcoin until you are able to economically withdraw to self-custody.
                      {'\n\n'}
                      Be careful: while bitcoin custodians and exchanges offer user friendly financial services, it's wise to exercise caution with the amount of money you entrust to them. As your balance increases, Cypher Box will notify you and provide instructions on how to secure your wealth independently, without the reliance on any third party custodian.
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
                <Button text="I understand" onPress={nextClickHandler} style={styles.button} textStyle={styles.btnText} />
            </View>
        </ScreenLayout>
    )
}
