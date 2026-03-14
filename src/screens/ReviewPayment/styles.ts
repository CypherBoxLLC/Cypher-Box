import { colors, shadow, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    topView: ViewStyle;
    text: TextStyle;
    linearGradient: ViewStyle;
    linearGradient2: ViewStyle;
    linearGradient4: ViewStyle;
    showLine: ViewStyle;
    container: ViewStyle;
    invoiceButton: ViewStyle;
    background: ViewStyle;
    linearGradientStroke: ViewStyle;
    linearGradient3: ViewStyle;
    feesView: ViewStyle;
    modal: ViewStyle;
    background2: ViewStyle;
    row: ViewStyle;
    heigth: ViewStyle;
    heigth2: TextStyle;
    main: ViewStyle;
    alert: TextStyle;
    view: ViewStyle;
    check: TextStyle;
    blink: ImageStyle;
    box: ViewStyle;
    top2: any;
    height: ViewStyle;
    top: ViewStyle;
    bottom: ViewStyle;
    sats: ViewStyle;
    middle: ViewStyle;
    price: TextStyle;
    checkView: ViewStyle;
    checkImage: ImageStyle;
    editImage: ImageStyle;
}

export default StyleSheet.create<Style>({
    topView: {
        flex: 1,
    },
    checkView: {
        borderWidth: 1,
        borderColor: colors.blueText,
        width: 27,
        height: 25,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 3,
    },
    checkImage: {
        width: 16,
        height: 15
    },
    editImage: {
        width: 22,
        height: 22
    },
    text: {
        alignSelf: 'flex-end',
        marginEnd: 37.5,
        bottom: 10
    },
    linearGradient: {
        marginTop: 30,
        height: 140,
        justifyContent: 'flex-start',
        alignSelf: 'center',
    },
    showLine: {
        // borderWidth: 1,
        // borderColor: colors.white,
        position: 'absolute',
        width: '100%',
        backgroundColor: '#5F5F5F',
        height: 5,
        // padding: 5,
        borderRadius: 5,
        marginVertical: 10,
        // marginStart: 25,
        // marginHorizontal: 20
    },
    box: {
        position: 'absolute',
        top: 10,
        height: 5,
        width: 4,
        backgroundColor: colors.white,
        zIndex: 100,
        // alignSelf: 'flex-end',
        // marginEnd: 25,
    },
    linearGradient2: {
        width: '100%',
        // paddingLeft: 15,
        // paddingRight: 15,
        borderRadius: 5,
        height: 5,
        alignSelf: 'flex-start',
        marginVertical: 10,
        zIndex: 99
    },
    container: {
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 40
    },
    invoiceButton: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
    heigth: {
        // height: 84
    },
    heigth2: {
        fontSize: 14,
    },
    main: {
        width: '50%',
        // alignSelf: 'center',
        marginHorizontal: 30,
        marginTop: 10,
        marginBottom: 40
    },
    alert: {
        marginBottom: 10
    },
    view: {
        flexDirection: 'row',
        padding: 15,
        paddingHorizontal: 20,
        justifyContent: 'space-between',
    },
    check: {
        marginStart: 10,
        ...shadow.text25,
    },
    blink: {
        width: 75,
        height: 20,
        marginTop: 10,
        marginEnd: 15,
    },
    background: {
        backgroundColor: colors.gray.dark,
        flex: 1,
        margin: 2,
        borderRadius: 18,
        paddingHorizontal: 15,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    linearGradientStroke: {
        height: 45,
        width: '40%',
        marginLeft: 10,
        marginTop: -30,
        // marginVertical: 20,
        borderRadius: 18,
    },
    linearGradient3: {
        height: 45,
        borderRadius: 18
    },
    feesView: {
        flexDirection: 'row',
        alignItems: 'center',
        marginStart: 25,
        marginTop: 15,
    },
    top2: {
        shadowOffset: { width: 0, height: 3 },
        shadowColor: "#FFFFFF80",
        shadowRadius: 4,
        width: widths - 60,
        height: 5,
        justifyContent: 'center',
    },
    height: {
        height: 140,
    },
    top: {
        justifyContent: 'flex-start',
        height: 140,
        shadowColor: colors.pink.shadowTop,
    },
    bottom: {
        justifyContent: 'flex-start',
        height: 140,
        shadowColor: colors.pink.shadowBottom,
    },
    sats: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        top: 8,
        marginHorizontal: 30,
    },
    middle: {
        marginHorizontal: 20,
        marginTop: 20,
    },
    price: {
        color: colors.white,
        fontWeight: 'bold'
    },
    modal: {
        height: 200,
        width: '45%',
        marginVertical: 20,
        borderRadius: 25,
        alignSelf: 'center',
    },
    background2: {
        backgroundColor: colors.gray.dark,
        flex: 1,
        margin: 2,
        borderRadius: 25,
        paddingHorizontal: 3,
    },
    row: {
        backgroundColor: colors.black.default,
        flexDirection: 'row',
        height: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    linearGradient4: {
        height: 200,
        borderRadius: 25
    },
})
