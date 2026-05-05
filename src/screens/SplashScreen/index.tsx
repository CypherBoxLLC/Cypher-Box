import React, { useContext, useEffect, useRef, useState } from "react";
import { Animated, Dimensions, View } from "react-native";
import styles from "./styles";
import { StackActions, useNavigation } from "@react-navigation/native";
import { isHandset } from "../../../blue_modules/environment";
import { BlueStorageContext } from "../../../blue_modules/storage-context";
import BootSplash from 'react-native-bootsplash';
import { dispatchNavigate } from "@Cypher/helpers";
import AsyncStorage from '@react-native-async-storage/async-storage';

// Bump this when TOS/Privacy Policy content changes to force re-acceptance
const CURRENT_TOS_VERSION = '2026-04';

// Minimum time the bootsplash stays up so the brand moment doesn't flicker
// on fast boots. Boot work and tos check race against this.
const MIN_DWELL_MS = 1000;

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SLIDE_DOWN_MS = 500;

export default function SplashScreen_() {
    const [showLogo, setShowLogo] = useState(false);
    const translateY = useRef(new Animated.Value(0));
    const initialisedRef = useRef(false);

    const { setWalletsInitialized, startAndDecrypt } = useContext(BlueStorageContext);
    const { dispatch } = useNavigation();

    const initialise = async () => {
        if (initialisedRef.current) return;
        initialisedRef.current = true;

        // Boot work in parallel with min dwell — bootsplash stays up the
        // whole time so there's a single continuous logo from launch.
        const [decryptResult, [hasAcceptedTerms, acceptedTosVersion]] = await Promise.all([
            startAndDecrypt(),
            Promise.all([
                AsyncStorage.getItem('hasAcceptedTermsOfService'),
                AsyncStorage.getItem('acceptedTosVersion'),
            ]),
            new Promise<void>(resolve => setTimeout(resolve, MIN_DWELL_MS)),
        ]);

        // Hand off from native bootsplash to JS logo: render JS logo first,
        // wait one frame so it's painted, then hide bootsplash without fade.
        // Start the slide-down on the same tick so any position discrepancy
        // between the two logos is masked by motion.
        setShowLogo(true);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        BootSplash.hide({ fade: false });

        await new Promise<void>(resolve => {
            Animated.timing(translateY.current, {
                useNativeDriver: true,
                toValue: SCREEN_HEIGHT + 200,
                duration: SLIDE_DOWN_MS,
            }).start(() => resolve());
        });

        if (decryptResult) {
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
            dispatchNavigate('WelcomeScreen');
        }
    };

    useEffect(() => {
        initialise();
    }, []);

    return (
        <View style={styles.container}>
            {showLogo && (
                <Animated.Image
                    source={require('../../../img/logo.png')}
                    fadeDuration={0}
                    resizeMode="contain"
                    style={[
                        styles.logoImage,
                        { transform: [{ translateY: translateY.current }] },
                    ]}
                />
            )}
        </View>
    );
}
