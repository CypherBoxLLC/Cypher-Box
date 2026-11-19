import React from "react";
import { Image, View } from "react-native";
import styles from "./styles";
import { CoinOSSmall } from "@Cypher/assets/images";
import { GradientButton, GradientCardWithShadow, GradientText } from "@Cypher/components";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { colors, heights } from "@Cypher/style-guide";
import LinearGradient from "react-native-linear-gradient";
import { dispatchReset } from "@Cypher/helpers/navigation";
import loc from "../../../../loc";

export default function AccountStatus() {

    const nextClickHandler = () => {
        console.log('home click');
        dispatchReset('HomeScreen');
    }

    return (
        <ScreenLayout disableScroll progress={2}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.common.lightning_account_created}</GradientText>
                    <GradientCardWithShadow colors_={[colors.gray.dark, colors.gray.dark]} style={styles.linearGradient} disabled linearStyle={styles.height} shadowStyleTop={styles.top} shadowStyleBottom={styles.bottom}>
                        <View style={styles.view}>
                            <Text h2 bold style={styles.check}>
                                {loc.cypherbox.account.common.lightning_account}
                            </Text>
                            <Image
                                source={CoinOSSmall}
                                style={styles.blink}
                                resizeMode="contain"
                            />
                        </View>
                        <Text bold style={styles.text}>2M sats</Text>
                        <LinearGradient
                            start={{ x: 0, y: 1 }} end={{ x: 1, y: 1 }}
                            colors={[colors.white, colors.pink.dark]}
                            style={styles.linearGradient2}>
                            <View style={styles.box} />
                            {/* <Shadow
                                inner // <- enable inner shadow
                                useArt // <- set this prop to use non-native shadow on ios
                                style={styles.top2} >
                            </Shadow> */}
                        </LinearGradient>
                    </GradientCardWithShadow>
                    <Text h4 style={styles.description}>{loc.cypherbox.account.account_status.desc_1}{'\n'}{'\n'}
                        {loc.cypherbox.account.account_status.desc_2}</Text>
                </View>
                <GradientButton title={loc.cypherbox.account.common.home} onPress={nextClickHandler} />
            </View>
        </ScreenLayout>
    )
}
