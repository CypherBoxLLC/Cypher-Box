import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    content: ViewStyle;
    title: TextStyle;
    spinner: ViewStyle;
    detail: TextStyle;
    notice: TextStyle;
    steps: ViewStyle;
    step: ViewStyle;
    dot: ViewStyle;
    dotDone: ViewStyle;
    dotActive: ViewStyle;
    dotPending: ViewStyle;
    stepLabel: TextStyle;
    stepLabelPending: TextStyle;
    references: ViewStyle;
    referenceLabel: TextStyle;
    referenceValue: TextStyle;
    supportLine: TextStyle;
    copyHint: TextStyle;
    spacer: ViewStyle;
    footer: ViewStyle;
    button: ViewStyle;
    secondButton: ViewStyle;
    textButton: ViewStyle;
    textButtonLabel: TextStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 24,
    },
    content: {
        paddingTop: 24,
        paddingBottom: 16,
    },
    title: {
        fontSize: 22,
        lineHeight: 28,
        textAlign: 'center',
        color: colors.white,
    },
    spinner: {
        marginTop: 14,
    },
    detail: {
        marginTop: 14,
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
        color: colors.white,
    },
    notice: {
        marginTop: 12,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: colors.yellow2,
    },
    steps: {
        marginTop: 28,
        alignSelf: 'center',
    },
    step: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    dot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
        marginRight: 12,
    },
    dotDone: {
        backgroundColor: colors.usdt.light,
        borderColor: colors.usdt.light,
    },
    dotActive: {
        backgroundColor: 'transparent',
        borderColor: colors.usdt.light,
    },
    dotPending: {
        backgroundColor: 'transparent',
        borderColor: colors.gray.disable,
    },
    stepLabel: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.white,
    },
    stepLabelPending: {
        color: colors.gray.light,
    },
    references: {
        marginTop: 24,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
    },
    referenceLabel: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
    },
    referenceValue: {
        marginTop: 2,
        marginBottom: 10,
        fontSize: 12,
        lineHeight: 18,
        fontFamily: 'monospace',
        color: colors.white,
    },
    supportLine: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.usdt.light,
    },
    copyHint: {
        marginTop: 8,
        fontSize: 12,
        lineHeight: 16,
        color: colors.gray.light,
    },
    spacer: {
        flex: 1,
    },
    footer: {
        paddingBottom: 30,
        paddingTop: 8,
    },
    button: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
    secondButton: {
        marginTop: 12,
    },
    textButton: {
        marginTop: 14,
        alignSelf: 'center',
        padding: 6,
    },
    textButtonLabel: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.gray.light,
        textDecorationLine: 'underline',
    },
});
