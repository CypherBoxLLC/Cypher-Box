import React, { ReactNode } from "react";
import { TouchableOpacity, View, ViewStyle } from "react-native";
import styles from "./styles";
import LinearGradient from "react-native-linear-gradient";

interface Props {
    colors_: string[];
    style: ViewStyle;
    children: ReactNode;
    onPress: () => void;
}

export default function GradientButton({ style, colors_, children, onPress }: Props) {
    return (
        <TouchableOpacity onPress={onPress}>
            <LinearGradient
                colors={['#6D2158', '#D617A1']} // Border gradient
                style={[styles.gradientBorder, style]}
                start={{ x: 0, y: 1 }}
                end={{ x: 1, y: 1 }}
            >
                <View style={styles.innerContainer}>
                    <LinearGradient
                        colors={colors_}
                        style={styles.gradientBackground}
                        start={{ x: 0, y: 1 }}
                        end={{ x: 1, y: 1 }}
                    >
                        {children}
                    </LinearGradient>
                </View>
            </LinearGradient>
        </TouchableOpacity>
    );
};
