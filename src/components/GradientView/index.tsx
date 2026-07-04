import { colors, shadow } from "@Cypher/style-guide";
import React, { ReactNode } from "react";
import {
    StyleSheet,
    TouchableOpacity,
    TouchableOpacityProps,
    View,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { Shadow } from "react-native-neomorph-shadows";
import styles from "./styles";

interface Props extends TouchableOpacityProps {
    onPress?(): void;
    isShadowTopColor?: boolean;
    isShadowBottomColor?: boolean;
    children: ReactNode;
    topShadowStyle: any;
    bottomShadowStyle: any;
    linearGradientStyle?: any;
    linearGradientStyleMain?: any;
    gradiantColors?: string[];
    isShadow?: boolean;
}

export default function GradientView({
    onPress,
    disabled = false,
    style,
    children,
    topShadowStyle,
    bottomShadowStyle,
    linearGradientStyle,
    linearGradientStyleMain,
    isShadow = false,
    gradiantColors = [colors.black.gradientTop, colors.black.gradientBottom],
}: Props) {
    return (
        <TouchableOpacity
            style={[styles.linearGradient, isShadow && shadow.shadow25, style]}
            onPress={onPress}
            disabled={disabled}
        >
            <View style={linearGradientStyle}>
                <LinearGradient
                    start={{ x: 1, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    colors={
                        disabled
                            ? [colors.gray.light, colors.gray.light]
                            : gradiantColors
                    }
                    style={[styles.linearGradient, linearGradientStyleMain]}
                >
                    <Shadow
                        inner // <- enable inner shadow
                        useArt // <- set this prop to use non-native shadow on ios
                        style={StyleSheet.flatten([styles.shadow, topShadowStyle])}
                    >
                        {/* Inner Shadow renders BEFORE children so the children
                            paint on top. Under RN 0.77 Fabric the
                            react-native-neomorph-shadows `useArt` fallback no
                            longer renders a vector inset rim (ART module is
                            gone in New Arch) — instead the Shadow paints a
                            solid translucent overlay across its bounds.
                            Painting it before children stops the colored tint
                            from sitting on top of the button text (the
                            blueish/greenish glow on the labels). */}
                        <Shadow
                            inner // <- enable inner shadow
                            useArt // <- set this prop to use non-native shadow on ios
                            style={StyleSheet.flatten([styles.innerShadow, bottomShadowStyle])} />
                        {children}
                    </Shadow>
                </LinearGradient>
            </View>
        </TouchableOpacity>
    );
}
