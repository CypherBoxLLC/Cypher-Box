import React from "react";
import { Image, View } from "react-native";
import styles from "./styles";
import { Bank } from "@Cypher/assets/images";
import { GradientButton, GradientText } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import { ScreenLayout, Text } from "@Cypher/component-library";
import { dispatchNavigate } from "@Cypher/helpers";
import loc from "../../../../loc";

export default function CheckAccount() {

    const nextClickHandler = () => {
        console.log('next click');
        dispatchNavigate('InfoBlink');
    }

    return (
        <ScreenLayout showToolbar progress={0}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.common.lightning_account}</GradientText>
                    <Text h4 style={styles.descption}>{loc.cypherbox.account.check_account.desc}</Text>


                    <Text h4 style={styles.alertText}>{loc.cypherbox.account.check_account.be_careful}<Text h4 style={{ color: colors.white }}>{loc.cypherbox.account.check_account.caution}</Text></Text>

                </View>
                <Image source={Bank} style={styles.image} resizeMode="contain" />
                <GradientButton title={loc.cypherbox.account.common.next} onPress={nextClickHandler}/>
            </View>
        </ScreenLayout>
    )
}
