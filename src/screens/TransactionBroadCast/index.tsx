import React, { useEffect, useRef, useState } from "react";
import { Image, ImageBackground, Linking, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import styles from "./styles";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { Blink, CustomKeyboard, GradientButton, GradientCard, GradientInput, GradientText } from "@Cypher/components";
import { colors, widths, } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
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
import { dispatchReset } from "@Cypher/helpers/navigation";
import { getStrikeCurrency } from "@Cypher/helpers/coinosHelper";

export default function TransactionBroadCast({navigation, route}: any) {
    const {matchedRate, type, value, converted, isSats, item, receiveType, currency = 'USD', strikePending = false } = route?.params;
    const amountSat = isSats ? value : converted;
    const amountUSD = isSats ? converted : value
    const [response, setResponse] = useState(false);
    const [progress, setProgress] = useState(0);
    const [sats, setSats] = useState('100K sats');
    const [usd, setUsd] = useState('$40');
    const [to, setTo] = useState('Awaiting Network Confirmation');
    const fadeInOpacity = useSharedValue(0);

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
        // Reset the WalletsStack back to HomeScreen instead of CommonActions.navigate.
        // navigate() leaves intermediate screens (ReviewPayment / SendScreen) mounted
        // under HomeScreen, which on iOS Fabric (RN 0.77 New Arch) renders as the
        // half-mounted HomeScreen overlay or pops the user back to ReviewPayment.
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
        };
    });

    return (
        <ScreenLayout disableScroll showToolbar isBackButton={false}>
            <View style={styles.main}>
                <View style={styles.container}>
                    {response &&
                        <>
                            <Text h1 bold center style={styles.title}>{strikePending ? 'Withdrawal Submitted' : 'Transaction Broadcasted...'}</Text>
                            <Animated.View style={animatedStyle}>
                                <Text semibold center style={styles.sats}>{amountSat} sats</Text>
                                <View style={styles.extra} />
                                <Text subHeader bold center>{getStrikeCurrency(currency || 'USD')}{amountUSD}</Text>
                                <View style={styles.extra} />
                                <Text h2 bold center>{to}</Text>
                                <GradientText style={styles.gradientText}>{strikePending ? 'Strike is sending this on-chain. Arrives in about an hour.' : 'Estimated time: ~2hr'}</GradientText>
                            </Animated.View>
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
                {/* <View
                    style={styles.ringEffect}
                >
                    <Image source={Ring4} style={styles.effect} resizeMode="contain" />
                    <ImageBackground source={Tower} style={styles.image} resizeMode="contain">
                        <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain" />
                    </ImageBackground>
                    <Text semibold center style={styles.text}>Bitcoin Network</Text>
                </View> */}
                {/* <View
                    style={styles.ringEffect}
                >
                    <Ring delay={0} />
                    <Ring delay={1000} />
                    <Ring delay={2000} />
                    <Ring delay={3000} />
                    <ImageBackground source={BitcoinTower} style={styles.image} resizeMode="contain">
                        <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain" />
                    </ImageBackground>
                </View> */}
                {/* <View
                    style={styles.ringEffect}
                > */}
                {/* <Image source={Tower} style={styles.image} resizeMode="contain" />
                    <Image source={Ring4} style={styles.effect} resizeMode="contain" /> */}
                {/* <Ring delay={0} />
                    <Ring delay={1000} />
                    <Ring delay={2000} />
                    <Ring delay={3000} /> */}
                {/* <ImageBackground source={Tower} style={styles.image} resizeMode="contain">
                        <Image source={Ring4} style={styles.effect} resizeMode="contain" />
                    <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain" />
                    </ImageBackground>
                </View> */}
                {/* {!response ?
                    <View
                        style={styles.ringEffect}
                    >
                        <Ring delay={0} />
                        <Ring delay={1000} />
                        <Ring delay={2000} />
                        <Ring delay={3000} />
                        <ImageBackground source={BitcoinTower} style={styles.image} resizeMode="contain">
                            <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain" />
                        </ImageBackground>
                    </View>
                    :
                    <View
                        style={styles.ringEffect}
                    >
                        <ImageBackground source={BitcoinTower} style={styles.image} resizeMode="contain">
                            <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain" />
                        </ImageBackground>
                    </View>
                } */}
                {/* {!response ?
                    <Blink duration={1000}>
                        <ImageBackground source={BitcoinTower} style={styles.image} resizeMode="contain">
                            <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain"/>
                        </ImageBackground>
                    </Blink>
                    :
                    <ImageBackground source={BitcoinTower} style={styles.image} resizeMode="contain">
                        <Image source={Bitcoin} style={styles.bitcoin} resizeMode="contain" />
                    </ImageBackground>
                } */}
                {/* <View style={styles.extra} /> */}
                {response && item?.txid &&
                    <TouchableOpacity
                        style={{
                            alignSelf: 'center',
                            marginTop: 12,
                            paddingHorizontal: 16,
                            paddingVertical: 8,
                        }}
                        onPress={() => {
                            // #details auto-expands the inputs/outputs panel on
                            // mempool.space — same fragment used by the parent
                            // tx detail explorer button in SendReceiveOnChain.
                            const url = `https://mempool.space/tx/${item.txid}#details`;
                            Linking.openURL(url).catch(err => console.error('mempool open failed:', err));
                        }}
                    >
                        <Text semibold center style={{ color: colors.white, textDecorationLine: 'underline' }}>
                            View transaction in Bitcoin Network Explorer
                        </Text>
                        {item?.originalTxid &&
                            <Text center style={{ color: colors.gray.light, fontSize: 11, marginTop: 4 }}>
                                {type === 'cpfp' ? 'Child of' : 'Replaces'} {String(item.originalTxid).substring(0, 8)}…
                            </Text>
                        }
                    </TouchableOpacity>
                }
                {response &&
                    <GradientButton style={styles.invoiceButton} textStyle={{ fontFamily: 'Lato-Medium', }}
                        title={receiveType ? 'Transaction Details' : 'Home'}
                        disabled={!response}
                        onPress={onPressClickHandler} />
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