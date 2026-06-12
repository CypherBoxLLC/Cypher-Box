import { StyleSheet, TextStyle, ViewStyle } from "react-native";
import { colors } from "@Cypher/style-guide";

interface Style {
    container: ViewStyle;
    content: ViewStyle;
    warnTitle: TextStyle;
    warnBody: TextStyle;
    sectionTitle: TextStyle;
    toggleRow: ViewStyle;
    toggleLabel: TextStyle;
    toggleSub: TextStyle;
    infoText: TextStyle;
    bullet: TextStyle;
    divider: ViewStyle;
    button: ViewStyle;
    btnText: TextStyle;
    cancelText: TextStyle;
    loadingContainer: ViewStyle;
    loadingText: TextStyle;
    errorText: TextStyle;
    resetText: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        backgroundColor: colors.primary,
        paddingBottom: 40,
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 20,
    },
    warnTitle: {
        color: colors.ark.light,
        fontSize: 16,
        fontWeight: "bold",
        marginBottom: 6,
    },
    warnBody: {
        color: colors.whiteText,
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 8,
    },
    sectionTitle: {
        color: colors.white,
        fontSize: 15,
        fontWeight: "bold",
        marginBottom: 10,
        marginTop: 4,
    },
    toggleRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
    },
    toggleLabel: {
        color: colors.white,
        fontSize: 14,
    },
    toggleSub: {
        color: colors.gray.light,
        fontSize: 12,
        marginTop: 2,
        paddingRight: 12,
    },
    infoText: {
        color: colors.gray.light,
        fontSize: 12,
        lineHeight: 17,
        marginTop: 6,
        fontStyle: "italic",
    },
    bullet: {
        color: colors.gray.light,
        fontSize: 13,
        lineHeight: 20,
        marginBottom: 2,
    },
    divider: {
        height: 1,
        backgroundColor: colors.gray.disable,
        marginVertical: 18,
        opacity: 0.5,
    },
    button: {
        backgroundColor: colors.ark.light,
        marginHorizontal: 24,
        marginBottom: 12,
    },
    btnText: {
        color: colors.black.default,
        fontFamily: "Archivo-Bold",
        fontSize: 16,
    },
    cancelText: {
        color: colors.gray.light,
        textAlign: "center",
        fontSize: 14,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    loadingText: {
        marginTop: 15,
        fontSize: 16,
        color: colors.white,
    },
    errorText: {
        color: colors.red,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 10,
    },
    resetText: {
        color: colors.red,
        textAlign: "center",
        fontSize: 13,
        marginBottom: 14,
        textDecorationLine: "underline",
    },
});
