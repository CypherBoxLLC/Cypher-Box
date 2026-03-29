import { widths } from "@Cypher/style-guide";
import { StyleSheet, ViewStyle } from "react-native";

interface Style {
    gradientBorder: ViewStyle;
    innerContainer: ViewStyle;
    gradientBackground: ViewStyle;
}

export default StyleSheet.create<Style>({
    gradientBorder: {
        borderRadius: 25,
        height: 184,
        width: widths - 114,
        marginEnd: 7,
    },
    innerContainer: {
        borderRadius: 9,
        height: 184,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    gradientBackground: {
        height: 180,
        width: widths - 118,
        borderRadius: 23,
    },
})