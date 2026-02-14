import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    linearGradient: ViewStyle;
    keypad: ViewStyle;
    key: ViewStyle;
    keyText: TextStyle;
    invoiceButton: ViewStyle;
    maxButton: ViewStyle;
    maxText: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 40
    },
    linearGradient: {
        height: 2,
        width: '100%',
    },
    keypad: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    keyText: {
        fontSize: 24,
        lineHeight: 32,
        fontFamily: 'Lato-Medium',
    },
    key: {
        width: '33%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
    },
    invoiceButton: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
    maxButton: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
    },
    maxText: {
        color: '#FFFFFF',
        fontSize: 14,
    },
})
