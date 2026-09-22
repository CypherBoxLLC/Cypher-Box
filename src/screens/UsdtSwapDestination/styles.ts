import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

/**
 * The destination field follows the Ark send screen's: a fixed-height box so
 * a long invoice scrolls inside it rather than growing the layout, with PASTE
 * and SCAN as a matched pair beside it.
 */
interface Style {
    main: ViewStyle;
    content: ViewStyle;
    heading: TextStyle;
    subheading: TextStyle;
    inputWrap: ViewStyle;
    input: TextStyle;
    fieldButton: ViewStyle;
    fieldButtonText: TextStyle;
    pill: ViewStyle;
    pillText: TextStyle;
    status: TextStyle;
    statusWarning: TextStyle;
    note: TextStyle;
    vaultButton: ViewStyle;
    vaultButtonText: TextStyle;
    footer: ViewStyle;
    continueButton: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 20,
    },
    content: {
        paddingTop: 20,
        paddingBottom: 12,
    },
    heading: {
        fontSize: 20,
        lineHeight: 26,
        color: colors.usdt.light,
        textAlign: 'center',
    },
    subheading: {
        marginTop: 6,
        fontSize: 14,
        lineHeight: 20,
        color: colors.gray.light,
        textAlign: 'center',
    },
    inputWrap: {
        marginTop: 24,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        paddingHorizontal: 12,
        height: 64,
        marginBottom: 10,
    },
    input: {
        flex: 1,
        color: colors.white,
        fontSize: 14,
        paddingVertical: 10,
        maxHeight: 44,
        textAlignVertical: 'top',
    },
    fieldButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.usdt.light,
        marginLeft: 6,
    },
    fieldButtonText: {
        color: colors.usdt.light,
        fontSize: 12,
        lineHeight: 16,
        fontFamily: 'Lato-Bold',
    },
    pill: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.usdt.light,
        marginLeft: 4,
    },
    pillText: {
        fontSize: 12,
        lineHeight: 16,
        fontFamily: 'Lato-Bold',
        color: colors.usdt.light,
    },
    status: {
        marginHorizontal: 4,
        fontSize: 13,
        lineHeight: 19,
        color: colors.gray.light,
    },
    statusWarning: {
        color: colors.redLight,
    },
    note: {
        marginTop: 14,
        marginHorizontal: 4,
        fontSize: 13,
        lineHeight: 19,
        color: colors.white,
    },
    vaultButton: {
        marginTop: 28,
        height: 44,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: colors.usdt.light,
        alignItems: 'center',
        justifyContent: 'center',
    },
    vaultButtonText: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.usdt.light,
    },
    footer: {
        paddingBottom: 30,
        paddingTop: 8,
    },
    continueButton: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
});
