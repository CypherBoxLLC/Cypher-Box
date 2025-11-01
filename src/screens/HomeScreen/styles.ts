import { colors, heights, shadow, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    container2: ViewStyle;
    container3: ViewStyle;
    container4: ViewStyle;
    title: ViewStyle;
    imageView: ViewStyle;
    imageViews: ViewStyle;
    image: ImageStyle;
    arrow: ImageStyle;
    arrow2: ImageStyle;
    arrow3: ImageStyle;
    linearGradient: ViewStyle;
    createView: ViewStyle;
    bitcointext: TextStyle;
    middle: TextStyle;
    text: TextStyle;
    login: TextStyle;
    view: ViewStyle;
    showLine: ViewStyle;
    linearGradient2: ViewStyle;
    box: ViewStyle;
    check: TextStyle;
    sats: TextStyle;
    alert: TextStyle;
    alertGrey: TextStyle;
    blink: ImageStyle;
    btnView: ViewStyle;
    current: ImageStyle;
    bottominner: ViewStyle;
    bitcoinimg: ImageStyle;
    row: ViewStyle;
    row2: ViewStyle;
    alreadyView: ViewStyle;
    createAccount: ViewStyle;
    scan: ImageStyle;
    shadow: TextStyle;
    shadowTop: any;
    shadow10: any;
    shadow11: any;
    shadowBottom: any;
    savingHeight?: ViewStyle;
    shadowView: ViewStyle;
    shadowTopBottom: any;
    shadowTopBottom2: any;
    shadowBottomBottom: any;
    shadowViewBottom: ViewStyle;
    height: ViewStyle;
    top: ViewStyle;
    storageText: TextStyle;
    main: ViewStyle;
    circle: ViewStyle;
    inside: ViewStyle;
    gradient: ViewStyle;
    view2: ViewStyle;
    bottomSheet: ViewStyle;


    image2: ImageStyle;
    image3: ImageStyle;
    title2: TextStyle;
    desc: TextStyle;
    view3: ViewStyle;
    height2: ViewStyle;
    background: ViewStyle;
    extra: ViewStyle;
    closeIcon: ImageStyle;
    subview: ViewStyle;
    bottomtext: TextStyle;
    closeView: ViewStyle;
    bottom: ViewStyle;
    line: ViewStyle;
    descption: TextStyle;
    price: TextStyle;
    priceusd: TextStyle;
    totalsats: TextStyle;
    list: ViewStyle;
    arrowLeft: ImageStyle;
    arrowRight: ImageStyle;
    topup: ViewStyle;
    shadowButton: any;
    innerShadowStyle: any;
    outerShadowStyle: any;
    mainShadowStyle?: ViewStyle;
    linearGradientStyle?: ViewStyle;
    savingVault?: ViewStyle;
    bitcoinText?: TextStyle;
    linearGradientbottom?: ViewStyle;
    bottomBtn: ViewStyle;
    createVault: ViewStyle;
    createVaultText: TextStyle;
    advancedText: TextStyle;
    createVaultContainer: ViewStyle;
    addView: ViewStyle;
    subView: ViewStyle;
    add: TextStyle;
    sub: TextStyle;
    addSats: TextStyle;
    refresh: ViewStyle;
    shadowTop2: ViewStyle;
    shadowBottom2: ViewStyle;
    circularView: ViewStyle;
    innerContainer: ViewStyle;
    checkingaccContainer: ViewStyle;
    plusImage: ImageStyle;
    linearFirstStyle: ViewStyle;
    linearSecondStyle: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        backgroundColor: colors.primary,
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 60,
        overflow: 'visible'
        //zIndex:999
    },
    container2: {
        flex: 1,
    },
    addView: {
        height: 40,
        width: 40,
        marginTop: 10,
        marginBottom: 16,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderColor: colors.pink.default
    },
    subView: {
        height: 40,
        width: 40,
        marginTop: 10,
        marginLeft: 10,
        marginBottom: 16,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderColor: colors.pink.default
    },
    sub: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#ffffff'
    },
    add: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#ffffff'
    },
    addSats: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#ffffff'
    },
    container3: {
        // height: 62,
        // marginTop: 10,
        // marginBottom: 16,
        opacity: 0.5,
        justifyContent: 'center',
        // backgroundColor:'red'
    },
    container4: {
        backgroundColor: colors.gray.dark,
        flex: 1,
        borderRadius: 26,
        justifyContent: 'center',
        flexDirection: 'row',
    },
    createAccount: {
        flexDirection: 'column',
        marginTop: 10,
        alignSelf: 'center'
    },
    descption: {
        fontFamily: 'Archivo-SemiBold',
        color: colors.pink.light,
        margin: 8,
        fontSize: 13,
    },
    alreadyView: {
        flexDirection: 'row',
        marginTop: 10,
        alignSelf: 'center',
        height: 25,
    },
    title: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    imageView: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        // alignSelf: 'flex-end',
        marginEnd: 10,
    },
    imageViews: {
        width: 55,
        height: 55,
        alignItems: 'center',
        justifyContent: 'center',
    },
    linearGradient: {
        marginTop: 20,
        height: 132,
        justifyContent: 'flex-start',
    },
    createView: {
        marginTop: 20,
        backgroundColor: 'transparent'
    },
    image: {
        width: 33,
        height: 33,
    },
    scan: {
        width: 51,
        height: 51,
    },
    middle: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf:'flex-start',
        justifyContent:'flex-start',
        flex: 1
    },
    text: {
        fontSize: 18,
        textAlign: 'center'
    },
    login: {
        fontSize: 18,
        color: colors.pink.light,
        textAlign: 'center',
        marginStart: 5,

    },
    bitcointext: {
        marginEnd: 7,
        ...shadow.text25,
    },
    arrow: {
        width: 50,
        height: 50,
        left: -5,
        top: 10,
    },
    arrow2: {
        width: 30,
        height: 30,
        top: 7.5,
    },
    arrow3: {
        width: 30,
        height: 30,
        bottom: 7.5, transform: [{ rotate: '180deg' }]
    },
    view: {
        flexDirection: 'row',
        paddingTop: 15,
        // paddingHorizontal: 20,
        justifyContent: 'space-between',
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
    blink: {
        width: 75,
        height: 20,
        marginTop: 10,
        // marginEnd: 15,
    },
    check: {
        // marginStart: 10,
        ...shadow.text25,
    },
    sats: {
        // marginStart: 25,
        ...shadow.text25,
        fontSize: 18
    },
    alert: {
        color: colors.green,
        marginHorizontal: 20,
    },
    alertGrey: {
        color: colors.gray.light,
        marginBottom: 12
    },
    btnView: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginVertical: 10,
    },
    current: {
        position: 'absolute',
        top: -10,
        right: -5,
        width: 40,
        height: 40,
        zIndex: 1,
    },
    bottominner: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    bitcoinimg: {
        width: 35,
        height: 35,
        transform: [{ rotate: '30deg' }]
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        // marginTop: 2,
    },
    row2: {
        flexDirection: 'row',
        justifyContent: 'center',
        // backgroundColor:'red',
        marginVertical: 15,
        // height: 40,
    },
    shadow: {
        ...shadow.text25,
    },
    shadowTop: {
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.7,
        shadowColor: colors.white,
        shadowRadius: 2,
        borderRadius: 24,
        width: widths - 40,
        height: 128,
        backgroundColor: colors.primary,
        padding: 15,
        paddingHorizontal: 30,
    },
    shadow10: {
        // shadowOffset: { width: 3, height: 4 },
        // shadowOpacity: 0.25,
        // shadowColor: '#484848',
        // shadowRadius: 16,
        // borderRadius: 15,
        width: widths,
        height: heights / 2 + 80,
        backgroundColor: colors.black.dark,
        // padding: 15,
        // paddingHorizontal: 30,
        // shadowOffset: { width: 3, height: 4 },
        // shadowOpacity: 0.25,
        // shadowColor: '#484848',
        // shadowRadius: 16,
        // borderRadius: 15,
        // width: widths,
        // height: heights / 2,
        // backgroundColor: colors.primary,
        // padding: 15,
        // paddingHorizontal: 30,
    },
    shadowTopBottom: {
        // shadowOffset: { width: 4, height: 4 },
        // shadowOpacity: 1,
        // shadowColor: "#FFFFFF",
        // shadowRadius: 2,
        borderRadius: 25,
        width: widths - 40,
        height: 113,
        backgroundColor: colors.tundora,
        padding: 15,
        paddingStart: 20,
        paddingEnd: 10,
    },
    shadowTopBottom2: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#ffffff',
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        backgroundColor: '#111111',
        padding: 15,
        paddingStart: 20,
        paddingEnd: 10,
    },
    shadowBottom: {
        shadowOffset: { width: -3, height: -3 },
        shadowOpacity: 1,
        shadowColor: '#000000',
        shadowRadius: 5,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        justifyContent: 'center',
        position: 'absolute',
    },
    shadow11: {
        shadowOffset: { width: -3, height: -4 },
        shadowOpacity: 0.25,
        shadowColor: '#484848',
        shadowRadius: 16,
        borderRadius: 15,
        width: widths,
        height: heights / 2,
        justifyContent: 'center',
        position: 'absolute',
    },
    shadowBottomBottom: {
        shadowOffset: { width: -3, height: -3 },
        shadowOpacity: 1,
        shadowColor: '#000000',
        shadowRadius: 2,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        justifyContent: 'center',
        position: 'absolute',
    },
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
    shadowViewBottom: {
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.71,
        shadowColor: '#0C0C0C',
        shadowRadius: 12,
        elevation: 24,
        borderRadius: 25,
        width: widths - 40,
        height: 130,
        marginTop: 10,
        borderColor: "transparent",
        backgroundColor: colors.tundora,
        opacity: 0.5,
    },
    height: {
        height: 132
    },
    top: {
        height: 132,
        justifyContent: 'flex-start',
    },
    storageText: {
        alignSelf: 'center',
        textAlign: 'center',
        flex: 1,
    },
    main: {
        borderRadius: 26,
        height: 52,
        padding: 2,
    },
    circle: {
        width: 62,
        height: 62,
        borderRadius: 31,
        borderWidth: 4,
        borderColor: colors.border,
        backgroundColor: colors.gray.dark,
        zIndex: 1,
        position: 'absolute',
        top: -5,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
    },
    inside: {
        flex: 1,
        backgroundColor: colors.gray.dark,
        borderRadius: 26,
        justifyContent: 'center',
    },
    gradient: {
        borderRadius: 26,
        height: 40,
        padding: 3,
    },
    view2: {
        flex: 1,
        margin: 4,
    },
    bottomSheet: {
        flex: 1,
        // paddingHorizontal: 20,
        // paddingVertical: 20,
        backgroundColor: '#232323',
        borderRadius: 15,
        height: heights / 2,
    },

    image2: {
        width: 25,
        height: 24,
    },
    image3: {
        width: 33,
        height: 33,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title2: {
        // backgroundColor:'red',
        // marginBottom: 5,
        // lineHeight: 25,
        ...shadow.text25
    },
    desc: {
        marginBottom: 5,
        // marginTop: 5,
        // backgroundColor: 'yellow',
        ...shadow.text25
    },
    view3: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flex: 1,
        marginHorizontal: 10,
        paddingStart: 10,
    },
    height2: {
        height: 86,
        zIndex: 1,
    },
    background: {
        backgroundColor: '#1e1e1e',
        flex: 1,
        margin: 1,
        borderRadius: 20
    },
    extra: {
        height: 20,
    },
    closeIcon: {
        // alignSelf: 'flex-end',
    },
    subview: {
        flex: 1,
        marginEnd: 5,
        // backgroundColor: 'green',
    },
    bottomtext: {
        alignSelf: 'center',
    },
    closeView: {
        width: 40,
        height: 40,
        // margin: 5,
        right: 0,
        alignSelf: 'center',
        justifyContent: 'center',
        position: 'absolute',
        // zIndex: 1,
    },
    bottom: {
        // opacity: 0.5,
        marginTop: 15,
        // top: heights * 0.01,
        top: heights * 0.06
    },
    line: {
        height: 2,
        width: '100%',
    },
    price: {
        marginStart: 2,
    },
    priceusd: {
        fontSize: 20,
        lineHeight: 24,
    },
    totalsats: {
        alignSelf: 'flex-end',
    },
    list: {
        paddingHorizontal: 30,
    },
    arrowLeft: {
        width: 30,
        height: 30,
        position: 'absolute',
        left: 10,
        // bottom: -2.5,
        transform: [{
            rotate: '270deg',
        }],
    },
    arrowRight: {
        width: 30,
        height: 30,
        position: 'absolute',
        // top: -2.5,
        right: 10,
        transform: [{
            rotate: '90deg',
        }],
    },
    topup: {
        borderRadius: 25,
        height: 47,
        justifyContent: 'center',
        width: (widths / 2) - 60,
        opacity: 0.5,
    },
    shadowButton: {
        shadowOffset: { width: 2, height: 2 },
        // shadowOpacity: 0.56,
        shadowColor: '#909090',
        shadowRadius: 2,
        borderRadius: 25,
        width: (widths / 2) - 60,
        height: 47,
        justifyContent: 'center',
    },
    outerShadowStyle: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 2,
        shadowColor: colors.greenShadow,
        borderRadius: 25,
        width: (widths / 2) - 60,
        height: 47,
        justifyContent: 'center',
    },
    innerShadowStyle: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 0.64,
        shadowColor: colors.greenShadowLight,
        borderRadius: 25,
        width: (widths / 2) - 60,
        height: 47,
        justifyContent: 'center',
        position: 'absolute',
    },
    mainShadowStyle: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    linearGradientStyle: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.80,
        shadowRadius: 16,
        elevation: 8,
    },
    savingVault: {
        width: widths - 40,
    },
    savingHeight: {
        height: 200
    },
    bitcoinText: {
        fontSize: 16,
    },
    linearGradientbottom: {
        flex: 1,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bottomBtn: {
        flex: 1,
        height: 40,
        alignSelf: 'center',
        // borderWidth: 2,
        // borderColor: colors.greenShadow,
        marginStart: 7.5,
        borderRadius: 25,
    },
    createVaultContainer: {
        // top: '-10%',
        // paddingHorizontal: 5,
    },
    createVault: {
        borderRadius: 25,
        marginTop: 13,
        height: 132,
        justifyContent: 'center',
        alignItems: 'center',
    },
    createVaultText: {
        textAlign: 'center'
    },
    advancedText: {
        margin: 10
    },
    refresh: {
        height: 47,
        width: 47,
    },
    shadowTop2: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 2,
        shadowColor: colors.pink.shadowTop,
        borderRadius: 25,
        width: 47,
        height: 47,
        justifyContent: 'center',
        alignItems: 'center'
    },
    shadowBottom2: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 0.64,
        shadowColor: colors.pink.shadowBottom,
        borderRadius: 25,
        width: 47,
        height: 47,
        justifyContent: 'center',
        position: 'absolute',
    },
    circularView: {
        flex: 1,
        paddingVertical: 40,
        marginTop: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    innerContainer: {
        marginTop: 16,
        shadowColor: '#040404CC',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.80,
        shadowRadius: 16,
        //elevation: 8,
    },
    checkingaccContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        // flex: 1,
        marginTop: 15,
        // marginBottom: 10,
        justifyContent: 'space-between',
    },
    plusImage: {
        width: 10,
        height: 17,
    },
    linearFirstStyle: {
        height: 32,
        width: widths / 3 + 15,
        borderRadius: 10,
        marginEnd: 5,
    },
    linearSecondStyle: {
        height: 30,
        width: widths / 3 + 13,
        borderRadius: 10,
        flexDirection: 'row'
    },
});
