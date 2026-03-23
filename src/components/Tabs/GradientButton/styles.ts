import { widths } from "@Cypher/style-guide";
import { StyleSheet, ViewStyle } from "react-native";

interface Style {
    gradientBorder: ViewStyle;
    innerContainer: ViewStyle;
    gradientBackground: ViewStyle;
}

export default StyleSheet.create<Style>({
    gradientBorder: {
        borderRadius: 12,
    },
    innerContainer: {
        borderRadius: 9,
        overflow: 'hidden', // Important to ensure gradient is clipped
    },
    gradientBackground: {
        width: widths / 4 - 38,
        height: widths / 4 - 48,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
