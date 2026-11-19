import { colors, widths } from "@Cypher/style-guide";
import { mirrorTransform } from "@Cypher/style-guide/rtl";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    main: ViewStyle;
    innerView: ViewStyle;
    descption: TextStyle;
    title: TextStyle;
    button: ViewStyle;
    btnText: ViewStyle;
    linearGradient: ViewStyle;
    innerContainer: ViewStyle;
    buttonText: TextStyle;
    shadowTopBottom: any;
    shadowBottomBottom: any;
    image: ImageStyle;
    middle: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 65,
    },
    main: {
        shadowOffset: { width: 8, height: 8 },
        shadowRadius: 16,
        shadowOpacity: 0.8,
        shadowColor: '#040404',
        elevation: 24,
        borderRadius: 25,
        width: widths - 80,
        height: 147,
        marginTop: 16,
        borderColor: "transparent",
        backgroundColor: colors.primary,
        alignSelf: "center",
    },
    innerView: {
        flex: 1,
        paddingBottom: 40,
        paddingTop: 10,
        paddingHorizontal: 25,
        alignItems: 'center',
    },
    descption: {
        marginVertical: 30,
        color: colors.white,
        lineHeight: 24,
    },
    title: {
        marginBottom: 30,
    },
    button: {
        backgroundColor: colors.green,
        borderWidth: 0,
    },
    btnText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 16,
    },
    linearGradient: {
        flex: 1,
        // paddingLeft: 15,
        // paddingRight: 15,
        borderRadius: 25,
        // marginTop: 20,
    },
    buttonText: {
        textAlign: 'center',
        color: '#FFD00F',
        position: 'absolute',
        top: 15,
        start: 35,
    },
    innerContainer: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    shadowTopBottom: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 0.56,
        shadowColor: '#27272C',
        borderRadius: 25,
        width: widths - 80,
        height: 147,
        backgroundColor: colors.primary,
        // padding: 15,
        // paddingStart: 20,
        // paddingEnd: 10,
    },
    shadowBottomBottom: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 0.56,
        shadowColor: '#040404',
        borderRadius: 25,
        width: widths - 80,
        height: 147,
        justifyContent: 'center',
        position: 'absolute',
    },
    image: {
        width: 41,
        height: 31,
        transform: [{ rotate: '180deg' }, ...mirrorTransform]
    },
    middle: {
        flex: 1,
        paddingStart: 40,
        paddingEnd: 20,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
    }
})
