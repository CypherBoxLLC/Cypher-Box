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
    keyKinds: TextStyle;
    node: ViewStyle;
    nodeMissing: ViewStyle;
    nodeConnected: ViewStyle;
    nodeText: ViewStyle;
    nodeTitle: TextStyle;
    nodeHint: TextStyle;
    nodeWarningTitle: TextStyle;
    nodeWarning: TextStyle;
    ignore: ViewStyle;
    checkbox: ViewStyle;
    checkboxTicked: ViewStyle;
    ignoreText: TextStyle;
    ignoreLabel: TextStyle;
    keyLocked: ViewStyle;
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
        // as wide as the node box above, so the labels with the key kinds fit on one line
        alignSelf: 'stretch',
        marginHorizontal: 22,
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
        borderRadius: 8,
        marginTop: 20,
    },
    linearStyle: {
        height: 54,
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
    keyKinds: {
        fontSize: 15,
        color: colors.gray.light,
    },
    qrimage: {
        width: 30,
        height: 30,
        marginEnd: 10
    },
    // the own-node box above the ways to load the key: yellow until a node is connected, then blue
    node: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        marginTop: 20,
        marginHorizontal: 22,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderRadius: 12,
    },
    nodeMissing: {
        borderColor: colors.yellow2,
    },
    nodeConnected: {
        borderColor: colors.blueText,
    },
    nodeText: {
        flex: 1,
        marginHorizontal: 12,
    },
    nodeTitle: {
        color: colors.white,
    },
    nodeHint: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
        marginTop: 2,
    },
    nodeWarningTitle: {
        color: colors.yellow2,
        fontFamily: 'Archivo-SemiBold',
    },
    nodeWarning: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.yellow2,
        marginTop: 2,
    },
    ignore: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        alignSelf: 'stretch',
        marginTop: 12,
        marginHorizontal: 22,
        paddingHorizontal: 14,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.white,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxTicked: {
        backgroundColor: colors.white,
    },
    ignoreText: {
        flex: 1,
        marginStart: 12,
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
    },
    ignoreLabel: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.white,
        fontFamily: 'Archivo-SemiBold',
    },
    // Scan, Paste and Import until there's a node or the user ticked "Ignore"
    keyLocked: {
        opacity: 0.4,
    },
})
