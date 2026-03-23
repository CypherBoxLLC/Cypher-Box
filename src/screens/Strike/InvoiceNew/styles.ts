import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    main: ViewStyle;
    sats: ViewStyle;
    valueView: ViewStyle;
    bottomView: ViewStyle;
    button: ViewStyle;
    text: TextStyle;
    fees: TextStyle;
    textInput: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingTop: 40,
    },
    main: {
        flex: 1,
        justifyContent: 'space-between',
        paddingHorizontal: 25,
    },
    sats: {
        fontSize: 45,
        lineHeight: 60,
    },
    valueView: {
        alignSelf: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    bottomView: {
        alignItems: 'center',
        marginBottom: 25,
        // borderTopWidth: 2,
        borderTopColor: colors.black.gradientTop,
        padding: 30,
        // position: 'absolute',
        // bottom: 0,
        alignSelf: 'center',
    },
    button: {
        backgroundColor: '#E5DEDE',
        borderRadius: 12,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: colors.black.default,
        marginBottom: 40
    },
    text: {
        fontSize: 18,
    },
    fees: {
        fontSize: 18, marginBottom: 30,
        marginStart: 15,
        marginEnd: 10,
    },
    textInput: {
        borderWidth: 3,
        borderColor: '#B6B6B6',
        width: '50%',
        height: 51,
        borderRadius: 15,
        color: '#FFFFFF',
        textAlign: 'center',
        marginTop: 10,
        fontFamily: 'Lato-Italic',
        fontSize: 14,
        marginStart: 15,
    },
})
