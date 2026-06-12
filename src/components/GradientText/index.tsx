import React from "react";
import { Text } from "@Cypher/component-library";
import MaskedView from "@react-native-masked-view/masked-view";
import LinearGradient from "react-native-linear-gradient";
import { colors } from "@Cypher/style-guide";
import styles from "./styles";

// `colors_` lets callers override the default pink gradient (e.g. yellow for
// Ark-themed surfaces). Falls back to the historical pink gradient when omitted
// so existing call sites keep their look.
const GradientText = ({ colors_, ...props }: any) => {
    const gradientColors = colors_ ?? [colors.pink.light, colors.pink.default];
    return (
        <MaskedView maskElement={<Text {...props} style={[styles.text, props.style]} />}>
            <LinearGradient
                colors={gradientColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}>
                <Text {...props} style={[styles.title, props.style,]} />
            </LinearGradient>
        </MaskedView>
    );
};

export default GradientText;
