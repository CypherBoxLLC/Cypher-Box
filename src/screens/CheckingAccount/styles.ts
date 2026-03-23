import { colors, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    bottomView: ViewStyle;
    lineView: ViewStyle;
    line: ImageStyle;
    main: ViewStyle;
    reserve: ViewStyle;
    image: ImageStyle;
    usd: TextStyle;
    linearGradientStroke: ViewStyle;
    modal: ViewStyle;
    linearGradient: ViewStyle;
    linearGradient2: ViewStyle;
    background: ViewStyle;
    background2: ViewStyle;
    priceView: ViewStyle;
    text: TextStyle;
    straightLine: ViewStyle;
    row: ViewStyle;
    gradientText: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
    },
    innerView: {
        paddingHorizontal: 25,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: '#333333',
    },
    bottomView: {
        alignItems: 'center',
        marginBottom: 25,
        borderTopWidth: 2,
        borderTopColor: '#333333',
        padding: 30,
    },
    lineView: {
        height: 10,
        width: 36,
        borderRadius: 4,
        borderWidth: 1,
        paddingStart: 1,
        borderColor: colors.gray.placeholder,
        justifyContent: "center",
    },
    line: {
        height: 6,
        width: 27,
    },
    main: {
        paddingHorizontal: 30,
    },
    reserve: {
        flexDirection: 'row',
        marginTop: 20,
    },
    image: {
        width: 19,
        height: 20,
        marginBottom: 20,
        marginStart: 5
    },
    usd: {
        fontSize: 18,
    },
    background: {
        backgroundColor: colors.gray.dark,
        flex: 1,
        margin: 2,
        borderRadius: 15,
        paddingHorizontal: 3,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    background2: {
        backgroundColor: colors.gray.dark,
        flex: 1,
        margin: 2,
        borderRadius: 25,
        paddingHorizontal: 3,
    },
    linearGradientStroke: {
        height: 67,
        width: '80%',
        marginLeft: 30,
        marginVertical: 20,
        borderRadius: 15,
    },
    modal: {
        height: 450,
        width: '70%',
        marginVertical: 20,
        borderRadius: 25,
        alignSelf: 'center',
    },
    linearGradient: {
        height: 67,
        borderRadius: 15
    },
    linearGradient2: {
        height: 450,
        borderRadius: 25
    },
    priceView: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
    },
    text: {
        fontSize: 25,
        lineHeight: 33,
        marginStart: 10,
    },
    straightLine: {
        width: 2,
        backgroundColor: colors.white,
        height: 26,
        marginHorizontal: 20,
    },
    row: {
        backgroundColor: colors.black.default,
        flexDirection: 'row',
        height: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gradientText: { 
        textAlign: 'center',
        marginTop: 20,
     },
})
