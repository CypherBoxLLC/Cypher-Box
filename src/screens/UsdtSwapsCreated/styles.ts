import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    title: TextStyle;
    inner: ViewStyle;
    sectionTitle: TextStyle;
    description: TextStyle;
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
        lineHeight: 30,
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
    description: {
        marginTop: 10,
        color: colors.white,
        lineHeight: 22,
        fontSize: 14,
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
