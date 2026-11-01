import { colors } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

export default StyleSheet.create({
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 24,
        // clears the back arrow, which ScreenLayout draws over the top of the content
        paddingTop: 48,
        paddingBottom: 40,
    },
    title: {
        fontSize: 18,
        lineHeight: 24,
        fontFamily: 'Archivo-SemiBold',
        marginBottom: 12,
    },
    body: {
        fontSize: 14,
        lineHeight: 20,
        color: '#CCC',
        marginBottom: 16,
    },
    online: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
        marginBottom: 12,
    },
    // the content already has its side padding
    seedWarning: {
        marginHorizontal: 0,
        marginTop: 0,
        marginBottom: 16,
    },
    note: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
        marginTop: 12,
    },
    error: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.redLight,
        marginTop: 12,
    },
    success: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.green,
        marginTop: 12,
    },
    primary: {
        height: 47,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 14,
        backgroundColor: colors.blueText,
    },
    secondary: {
        height: 47,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 14,
        borderWidth: 1,
        borderColor: colors.blueText,
    },
    link: {
        marginTop: 18,
        alignSelf: 'center',
    },
    linkText: {
        color: colors.blueText,
        textDecorationLine: 'underline',
        fontSize: 14,
    },
    input: {
        borderWidth: 1,
        borderColor: '#444',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: colors.white,
        fontSize: 15,
        marginTop: 14,
    },
    words: {
        minHeight: 96,
        textAlignVertical: 'top',
    },
    row: {
        borderTopWidth: 1,
        borderTopColor: '#2A2A2A',
        paddingVertical: 12,
    },
    rowLabel: {
        fontSize: 13,
        color: colors.gray.light,
    },
    rowAddress: {
        fontSize: 13,
        color: colors.white,
        marginTop: 2,
    },
    rowValue: {
        fontSize: 16,
        color: colors.white,
        marginTop: 4,
    },
    qr: {
        alignItems: 'center',
        marginBottom: 8,
    },
});
