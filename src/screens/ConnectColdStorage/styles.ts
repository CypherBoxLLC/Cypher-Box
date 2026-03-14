import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    button: ViewStyle;
    qrimage: ImageStyle;
    descption: TextStyle;
    innerView: ViewStyle;
    pasteview: ViewStyle;
    qrcode: ImageStyle;
    title: TextStyle;
    importBtn: ViewStyle;
    linearGradientInside: ViewStyle;
    linearStyle: ViewStyle;
    insideView: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
    },
    button: {
        backgroundColor: colors.gray.dark,
        borderRadius: 15,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 3,
        borderColor: '#B6B6B6',
        flex: 1,
        marginEnd: 10,
    },
    innerView: {
        flex: 1,
        paddingBottom: 40,
        paddingTop: 10,
        paddingHorizontal: 25,
        alignItems: 'center',
    },
    title: {
        color: colors.coldGreen,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 18,
    },
    descption: {
        fontFamily: 'Archivo-Regular',
        marginTop: 30,
        marginHorizontal: 22,
        color: colors.white,
        lineHeight: 30,
    },
    pasteview: {
        // flexDirection: 'row',
        // marginHorizontal: 30,
        // marginTop: 300,
        marginTop: 10,
        justifyContent: 'center',
        alignItems: 'center'
    },
    qrcode: {
        width: 40,
        height: 40,
    },
    importBtn: {
        backgroundColor: colors.coldGreen,
        height: 47,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 30,
        marginTop: 100
    },
    linearGradientInside: {
        height: 54,
        width: 190,
        borderRadius: 8,
        marginTop: 20,
    },
    linearStyle: {
        height: 54,
        width: 190,
        borderRadius: 8,
    },
    insideView: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.gray.dark,
        margin: 1,
        borderRadius: 8,
    },
    qrimage: {
        width: 30,
        height: 30,
        marginEnd: 10
    },
})
