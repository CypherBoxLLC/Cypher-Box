import { colors, textSizes } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    button: ViewStyle;
    textContainer: ViewStyle;
    checkBoxContainer: ViewStyle;
    btnContainer: ViewStyle;
    linearGradientbottom: ViewStyle;
    bottomBtn: ViewStyle;
    textStyle: ViewStyle;
    start: ImageStyle;
    container4: ViewStyle;
    gradient: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        paddingHorizontal: 25,
    },
    btnContainer: {
        backgroundColor: 'transparent',
    },
    button: {
        backgroundColor: colors.black.default,
        borderRadius: 20,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: colors.gray.light
    },
    textContainer: {
        marginVertical: 5,
    },
    checkBoxContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        columnGap: 20,
        top: '10%'
    },
    linearGradientbottom: {
        flex: 1,
        borderRadius: 10,
        height: 70,
    },
    bottomBtn: {
        backgroundColor: colors.pink.light,
        width: 190,
        height: 70,
        borderRadius: 10,
        top: '9%'
    },
    textStyle: {
        fontSize: textSizes.h3,
        lineHeight: 24,
    },
    start: {
        width: 190,
        height: 70,
        alignSelf: 'center'
    },

    container4: {
        padding: 2,
        backgroundColor: '#171717',
        flex: 1,
        borderRadius: 10,
        justifyContent: 'center',
        flexDirection: 'row',
    },

    gradient: {
        top: '9%',
        backgroundColor: 'red',

    },

})
