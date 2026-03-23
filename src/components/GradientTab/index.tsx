import React, { ReactNode } from "react";
import { ImageSourcePropType, ImageStyle, StyleSheet, TextStyle, TouchableOpacity, View } from "react-native"
import GradientCard from "../GradientCard";
import ImageText from "../ImageText";
import styles from "./styles";
import { colors } from "@Cypher/style-guide";

interface Props {
    isSats: boolean;
    setIsSats(value: boolean): void;
    firstTabImg: ImageSourcePropType;
    secondTabImg: ImageSourcePropType | ReactNode;
    tab1: string;
    tab2: string;
    isTextAfter?: boolean;
    textStyle?: TextStyle;
    imageStyle?: ImageStyle;
    color_?: any;
    tabColor_?: any;
}

export default function GradientTab({ isSats, setIsSats, tab1, tab2, firstTabImg, secondTabImg, isTextAfter = false, textStyle, imageStyle, color_,tabColor_ = [colors.pink.extralight, colors.pink.default] }: Props) {
    return (
        <GradientCard
            colors_={color_ ? color_ : ['#383A46', '#464D6840']}
            style={styles.linearGradientStroke} linearStyle={styles.linearGradient}>
            <View style={styles.background}>
                <View style={styles.main}>
                    {isSats ?
                        <GradientCard
                            colors_={tabColor_}
                            // colors_={isSats ? color_ ? color_ : ['#383A46', '#464D6840'] : [colors.primary, colors.primary]}
                            style={styles.linearGradientInside}
                            linearStyle={styles.linearStyle}
                            onPress={() => setIsSats(true)}>
                            <View style={styles.insideView}>
                                <ImageText source={firstTabImg} text={tab1} imageStyle={StyleSheet.flatten([styles.image, imageStyle && imageStyle])}
                                    textStyle={StyleSheet.flatten([styles.textStyle, textStyle && textStyle])} isTextAfter={isTextAfter} />
                            </View>
                        </GradientCard>
                        :
                        <TouchableOpacity
                            style={styles.linearGradientInside}
                            onPress={() => setIsSats(true)}>
                            <ImageText source={firstTabImg} text={tab1} imageStyle={StyleSheet.flatten([styles.image, { tintColor: colors.gray.placeholder }, imageStyle && imageStyle])}
                                textStyle={StyleSheet.flatten([styles.textStyle, { color: colors.gray.placeholder }, textStyle && textStyle])} isTextAfter={isTextAfter} />
                        </TouchableOpacity>
                    }
                    {!isSats ?
                        <GradientCard
                            colors_={tabColor_}
                            // colors_={!isSats ? color_ ? color_ : ['#464D6840', '#383A46'] : [colors.primary, colors.primary]}
                            style={styles.linearGradientInside}
                            linearStyle={styles.linearStyle}
                            onPress={() => setIsSats(false)}>
                            <View style={styles.insideView}>
                                <ImageText source={secondTabImg} text={tab2} imageStyle={styles.image2}
                                    textStyle={StyleSheet.flatten([styles.textStyle, textStyle && textStyle])} isTextAfter={isTextAfter} />
                            </View>
                        </GradientCard>
                        :
                        <TouchableOpacity
                            style={styles.linearGradientInside}
                            onPress={() => setIsSats(false)}>
                            <ImageText source={secondTabImg} text={tab2} imageStyle={styles.image2}
                                textStyle={StyleSheet.flatten([styles.textStyle, { color: colors.gray.placeholder }, textStyle && textStyle])} isTextAfter={isTextAfter} />
                        </TouchableOpacity>
                    }
                </View>
            </View>
        </GradientCard>
    )
}
