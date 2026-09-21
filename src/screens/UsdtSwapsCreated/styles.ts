import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    title: TextStyle;
    inner: ViewStyle;
    sectionTitle: TextStyle;
    row: ViewStyle;
    rowLabel: TextStyle;
    rowValue: TextStyle;
    description: TextStyle;
    note: TextStyle;
    scrollContent: ViewStyle;
    button: ViewStyle;
    btnText: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
    },
    title: {
        textAlign: 'center',
        color: colors.usdt.light,
        fontSize: 22,
        fontFamily: 'Archivo-Bold',
        marginBottom: 10,
    },
    inner: {
        flex: 1,
    },
    sectionTitle: {
        marginTop: 20,
        color: colors.usdt.light,
        fontSize: 15,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginTop: 10,
    },
    rowLabel: {
        color: colors.white,
        fontSize: 14,
        flex: 1,
        paddingRight: 12,
    },
    rowValue: {
        color: colors.usdt.light,
        fontSize: 14,
        textAlign: 'right',
    },
    description: {
        marginTop: 10,
        color: colors.white,
        lineHeight: 22,
        fontSize: 14,
    },
    note: {
        marginTop: 10,
        color: colors.gray.light,
        lineHeight: 20,
        fontSize: 13,
    },
    scrollContent: {
        paddingBottom: 100,
    },
    button: {
        backgroundColor: colors.usdt.main,
        borderWidth: 0,
    },
    btnText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 16,
    },
})
