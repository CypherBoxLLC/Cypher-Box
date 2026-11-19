import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    linearGradient: ViewStyle;
    keypad: ViewStyle;
    key: ViewStyle;
    keyText: TextStyle;
    nextBtn: ViewStyle;
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
        // laid out like a phone keypad in every language: right-to-left put 3 2 1 on top and moved delete to the left
        direction: 'ltr',
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
    nextBtn: {
        backgroundColor: colors.green,
        height: 47,
        width: '80%',
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 30,
    },
})
