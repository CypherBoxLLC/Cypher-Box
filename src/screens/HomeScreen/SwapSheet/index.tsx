import React, { useState } from "react";
import { View, TouchableOpacity, Image, Dimensions } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { Text } from "@Cypher/component-library";
import { GradientView } from "@Cypher/components";
import { StrikeFull, CoinOS } from "@Cypher/assets/images";
import { colors } from "@Cypher/style-guide";
import { dispatchNavigate } from "@Cypher/helpers";
import { StyleSheet } from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Service = 'strike' | 'coinos' | null;

interface Props {
    refSwapRBSheet: any;
    user: any;
    strikeMe: any;
    isAuth: boolean | undefined;
    isStrikeAuth: boolean;
    coinosBalance?: number;
    strikeBalance?: number;
}

export default function SwapSheet({ refSwapRBSheet, user, strikeMe, isAuth, isStrikeAuth, coinosBalance = 0, strikeBalance = 0 }: Props) {
    const [swapFrom, setSwapFrom] = useState<Service>(null);
    const [sendTo, setSendTo] = useState<Service>(null);

    const handleSelectFrom = (service: Service) => {
        setSwapFrom(service);
        if (service === 'strike') setSendTo('coinos');
        else if (service === 'coinos') setSendTo('strike');
    };

    const handleSelectTo = (service: Service) => {
        setSendTo(service);
        if (service === 'strike') setSwapFrom('coinos');
        else if (service === 'coinos') setSwapFrom('strike');
    };

    const canProceed = swapFrom && sendTo && swapFrom !== sendTo;

    const handleNext = () => {
        if (!canProceed) return;
        const fromAddress = swapFrom === 'coinos'
            ? `${user}@coinos.io`
            : `${strikeMe?.username}@strike.me`;
        const toAddress = sendTo === 'coinos'
            ? `${user}@coinos.io`
            : `${strikeMe?.username}@strike.me`;

        const sourceBalance = swapFrom === 'coinos' ? coinosBalance : strikeBalance;
        refSwapRBSheet?.current?.close();
        dispatchNavigate('SwapAmount', { swapFrom, sendTo, fromAddress, toAddress, sourceBalance });
    };

    const renderOption = (
        service: 'strike' | 'coinos',
        selected: boolean,
        onPress: () => void,
        disabled: boolean,
    ) => (
        <GradientView
            onPress={disabled ? undefined : onPress}
            style={styles.cardGradientStyle}
            linearGradientStyle={styles.cardOuterShadow}
            topShadowStyle={[
                styles.cardTopShadow,
                !selected && { shadowColor: colors.gray.disable },
            ]}
            bottomShadowStyle={[
                styles.cardInnerShadow,
                !selected && { shadowColor: colors.gray.disable },
            ]}
            linearGradientStyleMain={styles.cardGradientMainStyle}
            gradiantColors={[colors.black.bg, colors.black.bg]}
        >
            <View style={[styles.optionContent, disabled && { opacity: 0.4 }]}>
                <Image
                    source={service === 'strike' ? StrikeFull : CoinOS}
                    style={styles.logoImage}
                    resizeMode="contain"
                />
            </View>
        </GradientView>
    );

    return (
        <LinearGradient
            start={{ x: 0, y: 1 }}
            end={{ x: 1, y: 1 }}
            colors={[colors.pink.gradient1, colors.pink.gradient2]}
            style={styles.gradientLine}
        >
            <LinearGradient
                start={{ x: 1, y: 0 }}
                end={{ x: 1, y: 1 }}
                colors={[colors.black.gradientTop2, colors.black.default]}
                style={styles.containerGradientView}
            >
                <Text h2 bold style={styles.sectionTitle}>
                    SWAP FROM
                </Text>
                <View style={styles.row}>
                    {renderOption('strike', swapFrom === 'strike', () => handleSelectFrom('strike'), !isStrikeAuth)}
                    {renderOption('coinos', swapFrom === 'coinos', () => handleSelectFrom('coinos'), !isAuth)}
                </View>

                <Text h2 bold style={styles.sectionTitle}>
                    SEND TO
                </Text>
                <View style={styles.row}>
                    {renderOption('strike', sendTo === 'strike', () => handleSelectTo('strike'), !isStrikeAuth)}
                    {renderOption('coinos', sendTo === 'coinos', () => handleSelectTo('coinos'), !isAuth)}
                </View>

                <TouchableOpacity
                    onPress={handleNext}
                    disabled={!canProceed}
                    style={[
                        styles.nextBtn,
                        !canProceed && { backgroundColor: colors.gray.disable },
                    ]}
                >
                    <Text h3>Next</Text>
                </TouchableOpacity>
            </LinearGradient>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    gradientLine: {
        width: "100%",
        borderRadius: 30,
        paddingTop: 3,
        flex: 1,
    },
    containerGradientView: {
        width: SCREEN_WIDTH,
        flex: 1,
        backgroundColor: colors.black.dark,
        borderRadius: 30,
    },
    sectionTitle: {
        alignSelf: "center",
        marginTop: 23,
    },
    row: {
        paddingHorizontal: 30,
        marginTop: 20,
        flexDirection: "row",
        justifyContent: "space-evenly",
        alignItems: "center",
    },
    cardGradientStyle: {
        shadowColor: "#040404",
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        height: 67,
        width: SCREEN_WIDTH * 0.4,
    },
    cardOuterShadow: {
        shadowColor: "#27272C",
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        flex: 1,
    },
    cardGradientMainStyle: {
        borderRadius: 25,
        height: 67,
        justifyContent: "center",
        alignItems: "center",
        width: SCREEN_WIDTH * 0.4,
    },
    cardInnerShadow: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 0.64,
        shadowColor: colors.pink.shadowBottom,
        borderRadius: 25,
        width: SCREEN_WIDTH * 0.4,
        height: 67,
        justifyContent: "center",
        position: "absolute",
    },
    cardTopShadow: {
        shadowOffset: { width: 3, height: 3 },
        shadowColor: colors.pink.shadowTopNew,
        shadowRadius: 2,
        borderRadius: 25,
        width: SCREEN_WIDTH * 0.4,
        height: 67,
        justifyContent: "center",
    },
    optionContent: {
        alignItems: "center",
        justifyContent: "center",
    },
    logoImage: {
        width: 80,
        height: 35,
    },
    nextBtn: {
        backgroundColor: colors.pink.light,
        height: 47,
        width: '80%',
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        marginTop: 40,
    },
});
