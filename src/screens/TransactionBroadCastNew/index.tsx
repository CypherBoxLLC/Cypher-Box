import React, { useEffect, useRef, useState } from "react";
import { Image, ImageBackground, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { Blink, CustomKeyboard, GradientButton, GradientCard, GradientInput, GradientText } from "@Cypher/components";
import { colors, widths, } from "@Cypher/style-guide";
import { dispatchReset } from "@Cypher/helpers/navigation";
import { Bitcoin, BitcoinTower, Electrik, Socked, Tower } from "@Cypher/assets/images";
import * as Progress from 'react-native-progress';
import Ring from "@Cypher/components/RingEffect";
import { Ring4 } from "@Cypher/assets/gif";
import Animated, {
    useSharedValue,
    withTiming,
    Easing,
    useAnimatedStyle,
} from "react-native-reanimated";

export default function TransactionBroadCastNew({navigation, route}: any) {
    const [response, setResponse] = useState(false);
    const [progress, setProgress] = useState(0);
    // const [sats, setSats] = useState('100K sats');
    const [usd, setUsd] = useState('$40');
    const [to, setTo] = useState('Awaiting Network Confirmation');
    const fadeInOpacity = useSharedValue(0);
    console.log('route: ', route?.params)
    const { sats, inUSD } =  route?.params || {};

    useEffect(() => {
        const intervalId = setInterval(() => {
            setProgress((prevProgress) => {
                if (prevProgress < 1) {
                    return prevProgress + 0.1;
                } else {
                    clearInterval(intervalId);
                    return 1;
                }
            });
        }, 5);

        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        if (progress == 1) {
            setResponse(true);
            fadeIn();
        }
    }, [progress]);

    const onPressClickHandler = () => {
        // Reset the WalletsStack instead of CommonActions.navigate — the Cold
        // Vault signing path (ReviewPayment → SendReceiveOnChain → BBQr →
        // ConfirmHardwareTransaction → TransactionBroadCastNew) leaves all the
        // intermediate screens mounted under HomeScreen on iOS Fabric (RN 0.77
        // New Arch), producing half-rendered HomeScreen or back-popping to
        // ReviewPayment with a blank loading state.
        dispatchReset('HomeScreen');
    }

    const fadeIn = () => {
        fadeInOpacity.value = withTiming(1, {
            duration: 1500,
            easing: Easing.linear,
        });
    };

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: fadeInOpacity.value, // Use the value directly 
            height: 300,
        };
    });

    return (
        <ScreenLayout disableScroll showToolbar isBackButton={false}>
            <View style={styles.main}>
                <View style={styles.container}>
                    {response &&
                        <>
                            <Text h1 bold center style={styles.title}>Transaction Broadcasted...</Text>
                            {sats &&
                                <Animated.View style={animatedStyle}>
                                    <Text semibold center style={styles.sats}>{sats} sats</Text>
                                    <View style={styles.extra} />
                                    <Text subHeader bold center>${inUSD}</Text>
                                    <View style={styles.extra} />
                                    <Text h2 bold center>{to}</Text>
                                    {/* <GradientText style={styles.gradientText}>Estimated time: ~2hr</GradientText> */}
                                </Animated.View>
                            }
                        </>
                        // :
                        // <Text h1 bold center style={styles.title}>Broadcasting Transaction...</Text>
                    }
                </View>
                {response &&
                    <View
                        style={styles.ringEffect}
                    >
                        <Ring delay={0} isWhite />
                        <Ring delay={1000} isWhite />
                        <Ring delay={2000} isWhite />
                        <Ring delay={3000} isWhite />
                        <ImageBackground source={BitcoinTower} style={styles.image} resizeMode="contain">
                            <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain" />
                        </ImageBackground>
                        <Text semibold center style={styles.text}>Bitcoin Network</Text>
                    </View>
                }
                {response &&
                    <TouchableOpacity onPress={onPressClickHandler} style={styles.nextBtn}>
                        <Text h3>Home</Text>
                    </TouchableOpacity>
                    // :
                    // <View style={styles.invoiceButton}>
                    //     <Progress.Bar
                    //         height={30}
                    //         progress={progress}
                    //         color={colors.white}
                    //         borderColor="#303030"
                    //         width={widths - 60}
                    //         style={{
                    //             backgroundColor: '#303030',
                    //             height: 30,
                    //             borderRadius: 20,
                    //         }} />
                    // </View>
                }
            </View>
        </ScreenLayout>
    )
}
