import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    content: ViewStyle;
    center: ViewStyle;
    quiet: TextStyle;
    refusalTitle: TextStyle;
    refusal: TextStyle;
    row: ViewStyle;
    rowLabel: TextStyle;
    rowValue: TextStyle;
    rowValueEmphasis: TextStyle;
    rowNote: TextStyle;
    destinationLabel: TextStyle;
    destinationBox: ViewStyle;
    destinationValue: TextStyle;
    countdown: TextStyle;
    countdownExpired: TextStyle;
    footer: ViewStyle;
    caution: TextStyle;
    button: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 24,
    },
    content: {
        paddingTop: 16,
        paddingBottom: 16,
    },
    center: {
        marginTop: 60,
        alignItems: 'center',
    },
    quiet: {
        marginTop: 14,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: colors.gray.light,
    },
    refusalTitle: {
        fontSize: 20,
        lineHeight: 26,
        color: colors.usdt.light,
    },
    refusal: {
        marginTop: 12,
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
        color: colors.white,
    },
    row: {
        marginTop: 18,
    },
    rowLabel: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.gray.light,
    },
    rowValue: {
        marginTop: 4,
        fontSize: 17,
        lineHeight: 23,
        color: colors.white,
    },
    rowValueEmphasis: {
        fontSize: 22,
        lineHeight: 28,
    },
    rowNote: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
    },
    destinationLabel: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        color: colors.usdt.light,
    },
    destinationBox: {
        marginTop: 8,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderWidth: 1.5,
        borderColor: colors.usdt.light,
        borderRadius: 14,
    },
    destinationValue: {
        fontSize: 12,
        lineHeight: 18,
        fontFamily: 'monospace',
        color: colors.white,
    },
    countdown: {
        marginTop: 24,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: colors.usdt.light,
    },
    countdownExpired: {
        color: colors.redLight,
    },
    footer: {
        paddingBottom: 30,
        paddingTop: 8,
    },
    caution: {
        marginHorizontal: 30,
        marginBottom: 12,
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
        color: colors.white,
    },
    button: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
});
