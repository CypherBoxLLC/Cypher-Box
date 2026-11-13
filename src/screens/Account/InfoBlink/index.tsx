import React from "react";
import { Image, View } from "react-native";
import styles from "./styles";
import { CoinOS } from "@Cypher/assets/images";
import { GradientButton, GradientText } from "@Cypher/components";
import Description from "./Description";
import { ScreenLayout, Text, TextLink } from "@Cypher/component-library";
import { dispatchNavigate, openUrl } from "@Cypher/helpers";
import { colors } from "@Cypher/style-guide";
import loc from "../../../../loc";

export default function InfoBlink() {

    const nextClickHandler = () => {
        console.log('create coinos account click');
        dispatchNavigate('CreateCoinOSScreen');
    }

    const websiteClickHandler = (type: string) => {
        console.log(`${type} click`);
        switch (type) {
            case 'website':
            case 'xaccount':
                openUrl('https://coinos.io/');
            case 'telegram':
                openUrl('https://t.me/coinoswallet');
            case 'email':
                openUrl('support@coinos.io');
                break;
            case 'here':
                openUrl('https://amboss.space/node/02868e12f320073cad0c2959c42559fbcfd1aa326fcb943492ed7f02c9820aa399');
                break;
            default:
                break;
        }
    }

    return (
        <ScreenLayout showToolbar progress={0}>
            <View style={styles.container}>
                <View style={styles.innerView}>
                    <GradientText>{loc.cypherbox.account.common.lightning_account}</GradientText>
                    <Text h4 style={styles.descption}>{loc.cypherbox.account.info_blink.desc}</Text>


                    <Text h4 bold style={styles.alertText2}>{loc.cypherbox.account.info_blink.regulated}</Text>
                    <Description text={loc.cypherbox.account.info_blink.requirements} />
                    <Description text={loc.cypherbox.account.info_blink.non_kyc} />
                    <Description text={loc.cypherbox.account.info_blink.intraledger} />
                    <Description text={loc.cypherbox.account.info_blink.send_receive_fees} />
                    <Description text={loc.cypherbox.account.info_blink.settlement_fees} />
                    <Description text={loc.cypherbox.account.info_blink.node_security} />
                    <View style={{ flexDirection: 'row',alignSelf:'flex-start' }}>
                        <Description text={loc.cypherbox.account.info_blink.audit_node} />
                        <TextLink text={loc.cypherbox.account.info_blink.here} style={{borderColor:colors.pink.light}} textStyle={styles.link} onPress={() => websiteClickHandler('here')} />
                    </View>
                    <View style={{ marginVertical: 20, alignSelf: 'flex-start' }}>
                        <TextLink text={loc.cypherbox.account.info_blink.website} onPress={() => websiteClickHandler('website')} />
                        <TextLink text="Telegram" onPress={() => websiteClickHandler('telegram')} />
                        <TextLink text={loc.cypherbox.account.info_blink.x_account} onPress={() => websiteClickHandler('xaccount')} />
                        <TextLink text={loc.cypherbox.account.common.email} onPress={() => websiteClickHandler('email')} />
                    </View>
                </View>
                <Image source={CoinOS} style={styles.image} resizeMode="contain" />
                <GradientButton title={loc.cypherbox.account.common.next} onPress={nextClickHandler} />
            </View>
        </ScreenLayout>
    )
}
