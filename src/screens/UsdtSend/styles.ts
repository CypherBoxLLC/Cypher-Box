import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

/**
 * One screen for a whole send, so everything above the keypad has to earn its
 * height: an amount, a balance row, an address field and a single line that is
 * either the fee note or whatever is wrong.
 *
 * The amount is smaller than the swap flow's, which had the screen to itself,
 * and the spacer is what absorbs the difference on a tall phone. The keypad
 * keeps CustomKeyboard's geometry, three 33% columns and 24pt digits, so it
 * reads as the app's own keypad; CustomKeyboard itself is sats and fiat only
 * and has no decimal point.
 *
 * Every text style sets its own lineHeight: the shared Text's base is 18pt,
 * which clips the tops of anything set larger.
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
    field: ViewStyle;
    fieldGood: ViewStyle;
    input: TextStyle;
    fieldButton: ViewStyle;
    fieldButtonText: TextStyle;
    scanIcon: any;
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
        paddingBottom: 24,
    },
    amountBox: {
        marginTop: 18,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    amount: {
        fontSize: 40,
        lineHeight: 50,
        color: colors.white,
        flexShrink: 1,
    },
    unit: {
        fontSize: 20,
        lineHeight: 28,
        marginLeft: 8,
        marginBottom: 7,
        color: colors.usdt.light,
    },
    balanceRow: {
        marginTop: 10,
        minHeight: 30,
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
    field: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        paddingLeft: 12,
        paddingRight: 6,
        height: 52,
    },
    /** A recognised address, so the field says so without a second line. */
    fieldGood: {
        borderColor: colors.usdt.light,
    },
    input: {
        flex: 1,
        color: colors.white,
        fontSize: 14,
        paddingVertical: 0,
    },
    fieldButton: {
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.usdt.light,
        marginLeft: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fieldButtonText: {
        color: colors.usdt.light,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: 'Lato-Bold',
    },
    scanIcon: {
        width: 16,
        height: 16,
        tintColor: colors.usdt.light,
    },
    hint: {
        marginTop: 10,
        minHeight: 38,
        fontSize: 13,
        lineHeight: 19,
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
        marginBottom: 14,
    },
    key: {
        width: '33%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 9,
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
