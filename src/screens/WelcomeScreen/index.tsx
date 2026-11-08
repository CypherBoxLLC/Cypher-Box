import React, { useContext, useEffect, useState } from "react";
import { Image, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import Description from "./Description";
import { StackActions, useNavigation } from "@react-navigation/native";
import { isHandset } from "../../../blue_modules/environment";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import { MiddleImage, TitleImage } from "../../../img";
import { Start, Title } from "@Cypher/assets/images";
import { ScreenLayout } from "@Cypher/component-library";
import loc from "../../../loc";
import { GoodLuckWords, StartWord, welcomeArtFits } from "@Cypher/components/WelcomeWords";

export default function WelcomeScreen() {
    const { setWalletsInitialized, startAndDecrypt } = useContext(BlueStorageContext);
    const { dispatch } = useNavigation();
    const [isClick, setClick] = useState(false);

    useEffect(() => {
        if (isClick) {
            successfullyAuthenticated();
        }
    }, [isClick, setClick]);

    const successfullyAuthenticated = async () => {
        await startAndDecrypt()
        setWalletsInitialized(true);
        dispatch(StackActions.replace(isHandset ? 'Navigation' : 'DrawerRoot'));
    };

    const startClickHandler = () => {
        console.log('start click');
        setClick(true);
    }

    return (
        <ScreenLayout style={styles.container}>
            <View style={styles.inner}>
                <Image source={Title} style={styles.title}
                    resizeMode="contain" />
                <Image
                    source={require('../../../img/logo.png')}
                    resizeMode={'contain'}
                    style={styles.logoImage}
                />
                <View style={{ alignSelf: 'center' }}>
                    <Description text={loc.cypherbox.welcome.sat_fraction} />
                    <Description text={loc.cypherbox.welcome.sats_per_bitcoin} />
                    <Description text={loc.cypherbox.welcome.max_supply} />
                </View>
                {welcomeArtFits() ?
                    <Image source={MiddleImage} style={styles.middle}
                        resizeMode="contain" />
                    : <GoodLuckWords />}
                <TouchableOpacity onPress={startClickHandler}>
                    {welcomeArtFits() ?
                        <Image source={Start} style={styles.start}
                            resizeMode="contain" />
                        : <StartWord active />}
                </TouchableOpacity>
            </View>
        </ScreenLayout>
    )
}