import { widths } from "@Cypher/style-guide";
import { StyleSheet, ViewStyle } from "react-native";

interface Style {
    gradientBorder: ViewStyle;
    gradientBackground: ViewStyle;
}

export default StyleSheet.create<Style>({
    gradientBorder: {
        borderRadius: 25,
        height: 85,
        width: widths - 40,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    gradientBackground: {
        height: 80,
        width: widths - 46,
        borderRadius: 23,
        justifyContent: 'center',
        alignItems: 'center',
    },
})