import { colors, widths } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    button: ViewStyle;
    buttonText: ViewStyle;
    viewStyle: ViewStyle;
    hideView: ViewStyle;
    hideOverlay: ViewStyle;
    title: TextStyle;
    detail: TextStyle;
    viewBtn: TextStyle;
    centerView: ViewStyle;
    tabs: ViewStyle;
    tab: ViewStyle;
    tabOn: ViewStyle;
    tabText: TextStyle;
    seedQR: ViewStyle;
    seedQRWarning: TextStyle;
    seedQRNote: TextStyle;
    checkBtn: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        borderColor: colors.gray.disable,
        borderWidth: 1,
        width: 300,
        height: 300,
        alignSelf: 'center',
        alignItems: 'center',
        alignContent: 'center',
        borderRadius: 10,
    },
    button: {
        width: widths * 30 / 100,
        height: 30,
        margin: '2.5%',
        borderColor: colors.green,
        borderWidth: 1,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        fontFamily: 'Archivo-Bold',
    },
    viewStyle: {
        backgroundColor: colors.black.light,
        width: 102,
        height: 56,
        borderRadius: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        marginTop: 30,
    },
    hideView: {
        position: 'absolute',
        width: 300,
        height: 300,
        borderWidth: 1,
        borderColor: colors.gray.disable,
        borderRadius: 10,
        alignSelf: 'center',
        alignItems: 'center',
        alignContent: 'center',
        justifyContent: 'center',
    },
    hideOverlay: {
        // Near-opaque dark surface that stands in for the BlurView we
        // removed. 0.97 alpha keeps a hair of see-through so the grid
        // border line behind still registers subconsciously as "there's
        // something beneath this panel" — matches the previous
        // blurType="dark" visual weight without the native-view cost.
        backgroundColor: 'rgba(34, 37, 49, 0.97)',
    },
    title: {
        fontFamily: 'Archivo-Bold',
        fontSize: 14,
    },
    detail: {
        fontFamily: 'Archivo-Regular',
        fontSize: 12,
        marginTop: 15,
    },
    viewBtn: {
        fontFamily: 'Archivo-Bold',
        marginStart: 5,
    },
    centerView: {
        justifyContent: 'center',
    },
    // Words / SeedQR: two views of the same backup
    tabs: {
        flexDirection: 'row',
        alignSelf: 'center',
        marginBottom: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.gray.disable,
        padding: 3,
    },
    tab: {
        paddingHorizontal: 22,
        paddingVertical: 7,
        borderRadius: 17,
    },
    tabOn: {
        backgroundColor: colors.green,
    },
    tabText: {
        fontSize: 14,
        lineHeight: 18,
    },
    seedQR: {
        alignSelf: 'center',
        width: 300,
    },
    seedQRWarning: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.redLight,
        marginBottom: 10,
    },
    seedQRNote: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
        marginTop: 12,
    },
    checkBtn: {
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.blueText,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
    },
})
