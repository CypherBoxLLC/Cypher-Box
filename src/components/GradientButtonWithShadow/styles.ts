import { colors, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, ViewStyle } from "react-native";

interface Style {
    linearGradient: ViewStyle;
    shadow: any;
    innerShadow: any;
    pureview: ViewStyle;
    arrowLeft: ImageStyle;
    arrowRight: ImageStyle;
    border: ViewStyle;
}

export default StyleSheet.create<Style>({
    linearGradient: {
        borderRadius: 25,
        height: 47,
        justifyContent: 'center',
        width: (widths / 2) - 60,
    },
    shadow: {
        shadowOffset: { width: 2, height: 2 },
        // shadowOpacity: 0.56,
        shadowColor: '#555555',
        shadowRadius: 2,
        borderRadius: 25,
        width: (widths / 2) - 60,
        height: 47,
        justifyContent: 'center',
    },
    innerShadow: {
        shadowOffset: { width: -2, height: -2 },
        // shadowOpacity: 0.64,
        shadowColor: '#333333', //neutral shadow
        shadowRadius: 2,
        borderRadius: 25,
        width: (widths / 2) - 60,
        height: 47,
        justifyContent: 'center',
        position: 'absolute',
    },
    pureview: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-evenly'
    },
    arrowLeft: {
        width: 50,
        height: 50,
        position: 'absolute',
        left: 10,
        bottom: -5,
        transform: [{
            rotate: '270deg',
        }],
    },
    arrowRight: {
        width: 50,
        height: 50,
        position: 'absolute',
        top: -5,
        right: 10,
        transform: [{
            rotate: '90deg',
        }],
    },
    border: {
        borderWidth: 2,
        borderColor: colors.stroke,
    }
})