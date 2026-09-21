import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    scrollContent: ViewStyle;
    title: TextStyle;
    sectionTitle: TextStyle;
    description: TextStyle;
    path: TextStyle;
    link: TextStyle;
    addressBox: ViewStyle;
    address: TextStyle;
    copyHint: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
    },
    innerView: {
        flex: 1,
        paddingTop: 10,
        paddingHorizontal: 15,
    },
    scrollContent: {
        paddingBottom: 60,
    },
    title: {
        textAlign: 'center',
        color: colors.usdt.light,
    },
    sectionTitle: {
        marginTop: 22,
        color: colors.usdt.light,
        fontSize: 15,
    },
    description: {
        marginTop: 8,
        color: colors.white,
        lineHeight: 22,
        fontSize: 14,
    },
    path: {
        color: colors.gray.light,
        fontSize: 13,
        marginTop: 8,
    },
    link: {
        marginTop: 12,
        color: colors.usdt.light,
        fontSize: 14,
    },
    addressBox: {
        marginTop: 12,
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
})
