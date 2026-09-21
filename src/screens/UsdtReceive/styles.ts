import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    title: TextStyle;
    qrBox: ViewStyle;
    addressBox: ViewStyle;
    address: TextStyle;
    copyHint: TextStyle;
    label: TextStyle;
    description: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 65,
    },
    innerView: {
        flex: 1,
        paddingTop: 10,
        paddingHorizontal: 15,
    },
    title: {
        textAlign: 'center',
        color: colors.usdt.light,
    },
    qrBox: {
        alignSelf: 'center',
        backgroundColor: colors.white,
        padding: 12,
        borderRadius: 12,
        marginTop: 20,
    },
    addressBox: {
        marginTop: 16,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.usdt.light,
    },
    address: {
        color: colors.white,
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 20,
    },
    copyHint: {
        color: colors.usdt.light,
        fontSize: 12,
        textAlign: 'center',
        marginTop: 6,
    },
    label: {
        marginTop: 20,
        color: colors.usdt.light,
        fontSize: 15,
    },
    description: {
        marginTop: 8,
        color: colors.white,
        lineHeight: 22,
        fontSize: 14,
    },
})
