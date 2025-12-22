import React, { useEffect, useRef, useState } from "react";
import { Image, ImageBackground, ScrollView, StyleSheet, TextInput, Vibration, View } from "react-native";
import styles from "./styles";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { Blink, CustomKeyboard, GradientButton, GradientCard, GradientInput } from "@Cypher/components";
import { colors, widths, } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import * as Progress from 'react-native-progress';
// import { Ring, Ring3, } from "@Cypher/assets/gif";
import { Electrik } from "@Cypher/assets/images";
import Ring from "@Cypher/components/RingEffect";
// import Ring from "@Cypher/components/RingEffect";
import Animated, {
    useSharedValue,
    withTiming,
    Easing,
    useAnimatedStyle,
} from "react-native-reanimated";
import { dispatchReset, resetAndNavigate } from "@Cypher/helpers/navigation";
import { startsWithLn } from "../Send";
import { getStrikeCurrency } from "@Cypher/helpers/coinosHelper";

export default function Transaction({navigation, route}: any) {
    const {matchedRate, currency = 'USD', type, value, converted, isSats, to, item} = route?.params;
    const amountSat = isSats ? value : converted;
    const amountUSD = !isSats ? value : converted
    const [response, setResponse] = useState(false);
    const [progress, setProgress] = useState(0.2);
    const [sats, setSats] = useState('21 sats');
    const [usd, setUsd] = useState('0.013');
    // const [to, setTo] = useState('To: Satoshi@cypherbox.io');
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
        setTimeout(() => {
            Vibration.vibrate(50);
        }, 500)
        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        if (progress == 1) {
            setResponse(true);
            fadeIn();
        }
    }, [progress]);

    const onPressClickHandler = () => {
        if(startsWithLn(to) || to.includes("@") || to.length == 0) {
            dispatchReset("HomeScreen")
        } else {
            resetAndNavigate('HomeScreen', 'Invoice', {
                item: item,
                matchedRate
            })
        }
        // dispatchNavigate('CheckingAccount', {matchedRate});
    }

    const shortenAddress = (address: string) => {
        // Take the first 6 characters
        const start = address.substring(0, 6);
        // Take the last 6 characters
        const end = address.substring(address.length - 6);
        // Combine with three dots in the middle
        return `${start}...${end}`;
    };

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

    console.log(type, amountUSD)
    return (
        <ScreenLayout disableScroll showToolbar title={""} isBackButton={false}>
            <View style={styles.main}>
                <View style={styles.container}>
                    {response &&
                        <Animated.View style={animatedStyle}>
                            <Text h1 semibold center>{type == "BUY" ? "Payment Received" : "Payment Sent"}</Text>
                            <Text semibold center style={styles.sats}>{amountSat} sats</Text>
                            <Text subHeader bold center>{getStrikeCurrency(currency || 'USD')}{amountUSD}</Text>
                            { to?.length > 0 && <View style={styles.extra} /> }
                            { to.length > 0 && <Text subHeader bold center>{type !== 'username' ? shortenAddress(to) : to}</Text> }
                        </Animated.View>
                    }
                </View>
                {response &&
                    <View style={styles.ringEffect}>
                        <>
                            <Ring delay={0} isWhite={startsWithLn(to) || to.includes("@")} />
                            <Ring delay={1000} isWhite={startsWithLn(to) || to.includes("@")} />
                            <Ring delay={2000} isWhite={startsWithLn(to) || to.includes("@")} />
                            <Ring delay={3000} isWhite={startsWithLn(to) || to.includes("@")} />
                        </>
                        {startsWithLn(to) || to.includes("@") ?
                            <Image source={require('../../../img/success0.gif')} style={styles.gifImage} resizeMode="contain" />
                        :
                            <GradientCard style={styles.gradient} linearStyle={styles.gradient}
                                colors_={!response ? [colors.white, colors.white] : [colors.pink.extralight, colors.pink.default]}>
                                <View style={styles.inner}>
                                    <GradientCard style={styles.gradientInner} linearStyle={styles.gradientInner}
                                        colors_={!response ? [colors.white, colors.white] : [colors.pink.extralight, colors.pink.default]}>
                                        <View style={styles.inside}>
                                            <Image source={Electrik} style={styles.image} resizeMode="contain" />
                                        </View>
                                    </GradientCard>
                                </View>
                            </GradientCard>
                        }
                    </View>
                }
                {/* {!response ?
                    <View style={styles.ringEffect}>
                        <Ring delay={0} />
                        <Ring delay={1000} />
                        <Ring delay={2000} />
                        <Ring delay={3000} />
                        <GradientCard style={styles.gradient} linearStyle={styles.gradient} 
                        colors_={!response ? [colors.white, colors.white] : [colors.pink.extralight, colors.pink.default]}>
                            <View style={styles.inner}>
                                <GradientCard style={styles.gradientInner} linearStyle={styles.gradientInner}
                                    colors_={!response ? [colors.white, colors.white] : [colors.pink.extralight, colors.pink.default]}>
                                    <View style={styles.inside}>
                                        <Image source={Electrik} style={styles.image} resizeMode="contain" />
                                    </View>
                                </GradientCard>
                            </View>
                        </GradientCard>
                    </View>
                    :
                    <Animated.View
                        style={[
                            styles.ringEffect,
                            animatedStyle,
                        ]}
                    >
                        <GradientCard style={styles.gradient} linearStyle={styles.gradient}>
                            <View style={styles.inner}>
                                <GradientCard style={styles.gradientInner} linearStyle={styles.gradientInner}>
                                    <View style={styles.inside}>
                                        <Image source={Electrik} style={styles.image} resizeMode="contain" />
                                    </View>
                                </GradientCard>
                            </View>
                        </GradientCard>
                    </Animated.View>
                } */}
                <View style={styles.extra} />
                {to.length > 0 ?
                    <Text semibold center style={styles.text}>Lightning Network</Text>
                :
                    <Text semibold center style={styles.text}>Fiat Network</Text>
                }
                {response &&
                    <GradientButton style={styles.invoiceButton} textStyle={{ fontFamily: 'Lato-Medium', }}
                        title={startsWithLn(to) || to.includes("@") || to.length == 0 ? 'Home' : 'Payment Details'}
                        disabled={!response}
                        onPress={onPressClickHandler} />
                    // :
                    //     <View style={{height: 50}} />
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