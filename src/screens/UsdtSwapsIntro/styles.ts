import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    title: TextStyle;
    description: TextStyle;
    sectionTitle: TextStyle;
    caution: TextStyle;
    button: ViewStyle;
    btnText: TextStyle;
    linearGradient: ViewStyle;
    buttonText: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 65,
    },
    innerView: {
        flex: 1,
        paddingBottom: 20,
        paddingTop: 10,
        paddingHorizontal: 25,
    },
    title: {
        textAlign: 'center',
        color: colors.usdt.light,
    },
    description: {
        marginTop: 16,
        color: colors.white,
        lineHeight: 22,
        fontSize: 14,
    },
    sectionTitle: {
        marginTop: 22,
        color: colors.usdt.light,
        fontSize: 15,
    },
    caution: {
        color: '#FFC92C',
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
    linearGradient: {
        paddingLeft: 15,
        paddingRight: 15,
        borderRadius: 25,
        marginTop: 20,
    },
    buttonText: {
        fontFamily: 'Archivo-Medium',
        textAlign: 'center',
        padding: 10,
        color: colors.usdt.light,
    },
})
