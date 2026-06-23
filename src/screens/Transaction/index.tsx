import React, { useEffect, useRef, useState } from "react";
import { Image, ImageBackground, ScrollView, StyleSheet, TextInput, Vibration, View } from "react-native";
import styles from "./styles";
import { Input, ScreenLayout, Text } from "@Cypher/component-library";
import { Blink, CustomKeyboard, GradientButton, GradientCard, GradientInput } from "@Cypher/components";
import { colors, widths, } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import * as Progress from 'react-native-progress';
// import { Ring, Ring3, } from "@Cypher/assets/gif";
import { Electrik, StrikeFull } from "@Cypher/assets/images";
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
import CustomProgressBar from "@Cypher/components/CustomProgressBar";

export default function Transaction({navigation, route}: any) {
    const {matchedRate, currency = 'USD', type, value, converted, isSats, to, item, swappedTo} = route?.params;
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
                    // Clamp to 1 — `prev + 0.1` accumulates float drift
                    // (e.g. 0.9999… + 0.1 = 1.0999…), which made the
                    // strict `progress == 1` check below never match
                    // under Hermes after the RN 0.76 upgrade. Result:
                    // `response` stayed false → rings + success.gif
                    // never rendered → "lightning check animation not
                    // playing" per Bam.
                    return Math.min(1, prevProgress + 0.1);
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
        // Use `>=` rather than `==` as a belt-and-braces guard against
        // any future float drift sneaking past the Math.min clamp above.
        if (progress >= 1) {
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
                            <Text h1 semibold center>{type == "BUY" ? "Purchase Complete" : type == "SELL" ? "Sale Complete" : "Payment Sent"}</Text>
                            {/* Swap-destination badge. Renders only when
                                the BUY auto-routed to a non-Strike rail
                                (CoinOS or Ark). Bigger + bordered + white
                                so it can't be missed or hidden behind
                                the central success visual. */}
                            {!!swappedTo && (
                                <View style={{
                                    alignSelf: 'center',
                                    marginTop: 10,
                                    paddingVertical: 6,
                                    paddingHorizontal: 14,
                                    borderRadius: 14,
                                    borderWidth: 1.5,
                                    borderColor: swappedTo === 'Bark Vault' ? '#FFD93D' : '#FF65D4',
                                }}>
                                    <Text bold center style={{ color: '#fff', fontSize: 16 }}>
                                        {`→ Swapped to ${swappedTo}`}
                                    </Text>
                                </View>
                            )}
                            {type == "BUY" && (
                                // UTXO-tier capsule on the success screen
                                // — same visual the user saw on the Review
                                // page, so they can confirm the bucket
                                // they purchased into. Shown for every BUY
                                // destination (Strike / CoinOS / Ark /
                                // Hot / Cold).
                                <View style={{ alignSelf: 'center', marginTop: 10 }}>
                                    <CustomProgressBar value={Number(amountSat) || 0} />
                                </View>
                            )}
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
                        {/* Central success visual. The animated GIF
                            (success0.gif) doesn't render reliably under
                            RN 0.76 + Fabric on Android — it gets stuck
                            on the first frame. Skip it for the
                            BUY→swap path (where `swappedTo` is set) and
                            use the static GradientCard + Electrik bolt
                            that the non-Lightning path already uses
                            successfully. */}
                        {(startsWithLn(to) || to.includes("@")) && !swappedTo ?
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
                {(type == "BUY" || type == "SELL") ?
                    <Image source={StrikeFull} style={styles.strikeLogo} resizeMode="contain" />
                : to.length > 0 ?
                    <Text semibold center style={styles.text}>Lightning Network</Text>
                :
                    <Text semibold center style={styles.text}>Fiat Network</Text>
                }
                {response &&
                    <GradientButton style={styles.invoiceButton} textStyle={{ fontFamily: 'Lato-Medium', }}
                        title={type == "BUY" || type == "SELL" || startsWithLn(to) || to.includes("@") || to.length == 0 ? 'Home' : 'Payment Details'}
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