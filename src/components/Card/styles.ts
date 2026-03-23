import { colors, shadow, widths } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    shadowView: ViewStyle;
    shadowTop: any;
    view: ViewStyle;
    check: TextStyle;
    blink: ViewStyle;
    sats: TextStyle;
    shadowBottom: ViewStyle;
    linearGradient2: ViewStyle;
    showLine: ViewStyle;
    box: ViewStyle;
    btnView: ViewStyle;
}
export default StyleSheet.create({
    shadowView: {
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowColor: '#27272C',
        shadowRadius: 12,
        elevation: 24,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        marginTop: 15,
        borderColor: "transparent",
        backgroundColor: colors.white,
    },
    shadowTop: {
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 2,
        borderRadius: 24,
        width: widths - 40,
        height: 128,
        backgroundColor: colors.primary,
        paddingHorizontal: 30,
        shadowColor: colors.pink.shadowTop,
        padding: 0
    },
    view: {
        flexDirection: 'row',
        paddingTop: 15,
        justifyContent: 'space-between',
    },
    check: {
        ...shadow.text25,
    },
    blink: {
        width: 75,
        height: 20,
        marginTop: 10,
    },
    sats: {
        ...shadow.text25,
        fontSize: 18
    },
    totalsats: {
        alignSelf: 'flex-end',
    },
    shadowBottom: {
        shadowOffset: { width: -3, height: -3 },
        shadowOpacity: 1,
        shadowRadius: 2,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        justifyContent: 'center',
        position: 'absolute',
        shadowColor: colors.pink.shadowBottom
    },
    linearGradient2: {
        width: '100%',
        borderRadius: 5,
        height: 5,
        alignSelf: 'flex-start',
        marginVertical: 10,
        zIndex: 99
    },
    showLine: {
        position: 'absolute',
        width: '100%',
        backgroundColor: '#5F5F5F',
        height: 5,
        borderRadius: 5,
        marginVertical: 10,
    },
    box: {
        position: 'absolute',
        top: 10,
        height: 5,
        width: 4,
        backgroundColor: colors.white,
        zIndex: 100,
    },
    btnView: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginVertical: 10,
    },
})