import React, { useContext, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import styles from "./styles";
import { StackActions, useNavigation } from "@react-navigation/native";
import { isHandset } from "../../../blue_modules/environment";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import BootSplash from 'react-native-bootsplash';
import { heights } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SplashScreen_() {
    const [isLoading, setIsLoading] = useState(true);
    const opacity = useRef(new Animated.Value(1));
    const translateY = useRef(new Animated.Value(0));

    const { setWalletsInitialized, startAndDecrypt } = useContext(BlueStorageContext);
    const { dispatch } = useNavigation();

    const initialise = async () => {
        BootSplash.hide({ fade: true });

        const useNativeDriver = true;

        // Animate icon up 50 pixels before animating it down off the screen
        Animated.stagger(1000, [
            Animated.spring(translateY.current, {
                useNativeDriver,
                toValue: -50,
                delay: 500,
            }),
            Animated.spring(translateY.current, {
                useNativeDriver,
                toValue: heights,
            }),
        ]).start();
        // Fade screen out
        Animated.timing(opacity.current, {
            useNativeDriver,
            toValue: 0,
            duration: 750,
            delay: 1250,
        }).start(() => {
            successfullyAuthenticated()
        });
    };

    // Bump this when TOS/Privacy Policy content changes to force re-acceptance
    const CURRENT_TOS_VERSION = '2026-04';

    const successfullyAuthenticated = async () => {
        const hasAcceptedTerms = await AsyncStorage.getItem('hasAcceptedTermsOfService')
        const acceptedTosVersion = await AsyncStorage.getItem('acceptedTosVersion')

        if (await startAndDecrypt()) {
            setWalletsInitialized(true);
            if (hasAcceptedTerms === 'true' && acceptedTosVersion === CURRENT_TOS_VERSION) {
                dispatch(StackActions.replace(isHandset ? 'Navigation' : 'DrawerRoot'));
            } else if (hasAcceptedTerms === 'true' && acceptedTosVersion !== CURRENT_TOS_VERSION) {
                // Returning user, TOS updated — show re-acceptance screen
                dispatch(StackActions.replace('GetStartedScreen', { returningUser: true }));
            } else {
                dispatch(StackActions.replace('GetStartedScreen'));
            }
        } else {
            dispatchNavigate('WelcomeScreen')
        }
        setIsLoading(false);
    };

    return (
        <View style={styles.container}>
            {isLoading && (
                <Animated.View
                    style={[
                        StyleSheet.absoluteFill,
                        styles.splash,
                        { opacity: opacity.current },
                    ]}>
                    <Animated.Image
                        source={require('../../../img/logo.png')}
                        fadeDuration={0}
                        onLoadEnd={initialise}
                        resizeMode={'contain'}
                        style={[
                            styles.logoImage,
                            { transform: [{ translateY: translateY.current }] },
                        ]}
                    />
                </Animated.View>
            )}
        </View>
    )
}