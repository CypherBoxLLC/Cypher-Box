import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

/**
 * The keypad keeps CustomKeyboard's geometry (three 33% columns, 24pt digits)
 * so it reads as the app's own keypad; CustomKeyboard itself is sats and fiat
 * only and has no decimal point. Every text style sets its lineHeight, since
 * the shared Text's 18pt base clips anything set larger.
 */
interface Style {
    main: ViewStyle;
    amountBox: ViewStyle;
    amount: TextStyle;
    unit: TextStyle;
    balanceRow: ViewStyle;
    balance: TextStyle;
    allButton: ViewStyle;
    allButtonText: TextStyle;
    hint: TextStyle;
    hintWarning: TextStyle;
    spacer: ViewStyle;
    keypad: ViewStyle;
    key: ViewStyle;
    keyText: TextStyle;
    continueButton: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 30,
    },
    amountBox: {
        marginTop: 30,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    amount: {
        fontSize: 48,
        lineHeight: 58,
        color: colors.white,
        flexShrink: 1,
    },
    unit: {
        fontSize: 22,
        lineHeight: 30,
        marginLeft: 8,
        marginBottom: 8,
        color: colors.usdt.light,
    },
    balanceRow: {
        marginTop: 14,
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    balance: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.gray.light,
    },
    allButton: {
        marginLeft: 12,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.usdt.light,
    },
    allButtonText: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.usdt.light,
    },
    hint: {
        marginTop: 12,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: colors.white,
    },
    hintWarning: {
        color: colors.redLight,
    },
    spacer: {
        flex: 1,
    },
    keypad: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 16,
    },
    key: {
        width: '33%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
    },
    keyText: {
        fontSize: 24,
        lineHeight: 32,
        fontFamily: 'Lato-Medium',
    },
    continueButton: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
});
