import React from "react";
import { ButtonProps, Image, StyleSheet, TextStyle, TouchableOpacity, TouchableOpacityProps } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { colors, shadow } from "@Cypher/style-guide";
import styles from "./styles";
import { Copy } from "@Cypher/assets/images";
import { Text } from "@Cypher/component-library";

interface Props extends ButtonProps, TouchableOpacityProps {
    onPress?(): void;
    title: string;
    disabled?: boolean;
    isShadow?: boolean;
    isTextShadow?: boolean;
    isIcon?: boolean;
    textStyle?: TextStyle;
    isError?: boolean;
}

export default function GradientButton({ onPress, disabled = false, title, style, isShadow, isTextShadow, isIcon = false, textStyle, isError = false }: Props) {
    return (
        <TouchableOpacity style={[styles.linearGradient, isShadow && shadow.shadow25, style]}
            onPress={onPress}
            activeOpacity={0.7}
            disabled={disabled}>

            <LinearGradient start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} colors={disabled ? [colors.gray.disable, colors.gray.disable] : isError ? [colors.yellow2, colors.yellow2] : [colors.pink.light, colors.pink.default]} style={[styles.linearGradient, isIcon && styles.pureview, style]}>
                <Text h3 center style={StyleSheet.flatten([styles.buttonText, isTextShadow && shadow.text25, isError && {color:colors.black.default},textStyle])}>{title}</Text>
                {isIcon &&
                    <Image source={Copy} resizeMode="contain" />
                }
            </LinearGradient>
        </TouchableOpacity>
    );
};