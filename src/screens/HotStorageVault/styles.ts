import { colors, widths } from "@Cypher/style-guide";
import { Dimensions, ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    main: ViewStyle;
    flex: ViewStyle;
    savingVault: ViewStyle;
    bitcoinText: TextStyle;
    bitcoinImage: ImageStyle;
    title: TextStyle;
    innerShadowStyle: any;
    outerShadowStyle: any;
    linearGradientStyle: ViewStyle;
    mainShadowStyle?: ViewStyle;
    base: ViewStyle;
    linearGradientStyleMain: ViewStyle;
    info: ImageStyle;
    textInfo: TextStyle;
    qrcode: ViewStyle;
    qrcodeImage: ImageStyle;
    copyImage: ImageStyle;
    codeViewMain: ViewStyle;
    codeView: ViewStyle;
    shareImage: ImageStyle;
    infoText: TextStyle;
    text: TextStyle;
    line: ViewStyle;
    linebottom: ViewStyle;
    backbtn: ImageStyle;
    settingView: ViewStyle;
    settingView2: ViewStyle;
    typeText: TextStyle;
    typeView: ViewStyle;
    infoView: ViewStyle;
    backupView: ViewStyle;
    titleBackup: TextStyle;
    titleStyle: ViewStyle;
    coin: TextStyle;
    size: TextStyle;
    label: TextStyle;
    select: TextStyle;
    scrollview: ViewStyle;
    desc: ViewStyle;
    address: TextStyle;
    contentStyle: ViewStyle;
    separator: ViewStyle;
    tabs: ViewStyle;
    bottomview: ViewStyle;
    bottomView: ViewStyle;
    blankspace: ViewStyle;
    rowview: ViewStyle;
    tips: TextStyle;
    priceView: ViewStyle;
    card: ViewStyle;
    lGradient: ViewStyle;
    input: TextStyle;
    bottomViewNew: TextStyle;
    border: ViewStyle;
    modalContent: ViewStyle;
    capsuleOuterShadowStyle: ViewStyle;
    capsuleInnerShadowStyle: ViewStyle;
    capsuleLinearGradientStyle: ViewStyle;
    capsuleMainShadowStyle: ViewStyle;
    capsuleLinearGradientStyleMain: ViewStyle;
}

export default StyleSheet.create<Style>({
    flex: {
        flex: 1,
        flexDirection:'column',
        alignContent: 'center',
        justifyContent: 'center',
        paddingBottom: 20
        // paddingBottom: 40,
    },
    container: {
        flex: 1,
    },
    main: {
        // flex: 1,
        // paddingTop: 50,
        // flexDirection: 'row',
        flexDirection: 'row',
        justifyContent: 'center',
        // backgroundColor: 'green',
    },
    modalContent: {
        padding: 22,
        justifyContent: 'center',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderColor: 'rgba(0, 0, 0, 0.1)',
    },
    savingVault: {
        width: widths - 40,
        height: 130,
    },
    bitcoinText: {
        fontSize: 16,
    },
    bitcoinImage: {
        width: 37,
        height: 33,
    },
    title: {
        fontSize: 18,
    },
    outerShadowStyle: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 2,
        shadowColor: colors.greenShadow,
        borderRadius: 25,
        width: widths - 40,

        height: 47,
        // flex: 1,
        justifyContent: 'center',
        // backgroundColor: 'blue'
    },
    innerShadowStyle: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 0.64,
        shadowColor: colors.greenShadowLight,
        borderRadius: 25,
        width: widths - 40,

        height: 47,
        // flex: 1,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyle: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.80,
        shadowRadius: 16,
        elevation: 8,
        //flex: 1,
        marginHorizontal: 20,

        // alignItems: 'center',
        // backgroundColor: 'blue',
        // marginHorizontal: 0
    },
    mainShadowStyle: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        flex: 1,

        // backgroundColor: 'green'
    },
    base: {
        flexDirection: 'column',
        flex: 1,
        marginTop: 20,
        justifyContent:'center'
        // backgroundColor: 'red',
        // justifyContent: 'space-between'
        // alignSelf: 'center',
    },
    linearGradientStyleMain: {
        borderRadius: 25,

        height: 47,
        justifyContent: 'center',
        width: widths - 40,
        // width: (widths / 1) - 30,
    },
    info: {
        width: 17,
        height: 18,
        marginEnd: 10
    },
    textInfo: {
        textDecorationLine: 'underline',
    },
    qrcode: {
        borderColor: colors.greenShadow,
        borderWidth: 2,
        borderRadius: 30,
        width: "62%",
        aspectRatio:1,
        //height: "36%",
        alignSelf: 'center',
        marginTop: 20,
        backgroundColor: colors.white
    },
    qrcodeImage: {
        borderColor: colors.greenShadow,
        borderWidth: 4,
        borderRadius: 40,
        width: widths - 150,
        height: widths - 150,
        alignSelf: 'center',
    },
    codeViewMain: {
        flexDirection: 'row',
        marginTop: 15,
        // backgroundColor: 'red',
        alignItems: 'center',
        justifyContent: 'center',
        // backgroundColor: 'red',
        // borderRadius: 10,
        // borderWidth: 2,
        // borderColor: colors.greenShadow,

    },
    codeView: {
        flexDirection: 'row',
        borderRadius: 21,
        borderWidth: 3,
        borderColor: colors.greenShadow,
        width: widths - 80,
        alignItems: 'center',
        justifyContent: 'center',
        // marginStart: 35,
        height: 44,
    },
    copyImage: {
        width: 22,
        height: 15,
    },
    shareImage: {
        width: 25,
        height: 23,
        marginStart: 10,
        justifyContent: 'center',
        // backgroundColor: 'green',
    },
    infoText: {
        marginHorizontal: 40,
        marginTop: 10,
    },
    text: {
        fontSize: 18,
        marginStart: 20,
        marginVertical: 10,
    },
    line: {
        height: 1,
        backgroundColor: colors.white,
    },
    linebottom: {
        height: 1,
        backgroundColor: colors.white,
        marginTop: 7.5,
    },
    backbtn: {
        width: 20,
        height: 20,
        left: -20
    },
    settingView: {
        flex: 1,
        marginTop: 50,
    },
    settingView2: {
        flex: 1,
        marginTop: 30,
        position: 'absolute',
        right: -Dimensions.get('screen').width - 7.5,
    },
    typeText: {
        fontSize: 18,
    },
    typeView: {
        marginTop: 30,
    },
    infoView: {
        flex: 1,
        position: 'absolute',
        paddingHorizontal: 40,
        // right: -Dimensions.get('screen').width - 7.5,
        // marginTop: 30,
        // backgroundColor: 'red',
    },
    backupView: {
        flexDirection: 'row',
        marginBottom: 20,
    },
    titleBackup: {
        fontFamily: 'Archivo-SemiBold',
    },
    titleStyle: {
        flexDirection: 'row',
        marginTop: 5,
        marginStart: 20,
        marginEnd: 15,
        backgroundColor: colors.primary,
        // backgroundColor: 'red',
        // width: '100%',
        height: 40,
        alignItems: 'center',
    },
    coin: {
        flex: 1.8,
        fontSize: 18,
        paddingStart: 30,
    },
    size: {
        flex: 1.8,
        fontSize: 18,
        // backgroundColor: 'red'
    },
    label: {
        flex: 1,
        fontSize: 18,
        textAlign: 'center',
        marginEnd: 5,
        // backgroundColor: 'red'
    },
    select: {
        flex: 1,
        fontSize: 18,
        textAlign: 'center',
        // backgroundColor: 'red'
    },
    scrollview: {
        flex: 1,
    },
    desc: {
        marginHorizontal: 20,
        marginTop: 10,
    },
    address: {
        fontSize: 18,
        marginStart: 10,
    },
    contentStyle: {
        borderTopColor: colors.white,
        borderTopWidth: 1,
        borderBottomColor: colors.white,
        borderBottomWidth: 1,
        paddingBottom: 5,
        marginTop: 5,
    },
    separator: {
        height: 1,
        backgroundColor: '#ccc',
    },
    tabs: {
        backgroundColor: colors.primary,
        height: 50,
        width: '100%',
        position: 'absolute',
        top: 0,
    },
    bottomview: {
        marginBottom: 40,
        flex: 1,
    },
    bottomView: {
        flexDirection: 'row',
        alignItems: 'center',
        // marginBottom: 25,
        borderTopWidth: 0.5,
        borderTopColor: '#5E5E5E',
        height: 130,
        // padding: 50,
    },
    blankspace: {
        flex: 1,
        height: 23,
        backgroundColor: colors.white,
        borderRadius: 5,
        marginHorizontal: 20
    },
    rowview: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tips: {
        fontSize: 15,
        marginBottom: 15,
        marginTop: 10,
    },
    priceView: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 10,
        alignItems: 'center',
    },
    card: {
        width: '60%',
        alignSelf: 'center',
        height: 84,
    },
    lGradient: {
        height: 84,
    },
    input: {
        width: 162,
        // height: 49,
        borderRadius: 21,
        marginStart: 100,
        borderWidth: 1,
        // marginBottom: 20,
        fontSize: 16,
        fontFamily: 'Lato-Bold',
    },
    bottomViewNew: {
        // marginBottom: 10,
        paddingTop: 10,
        // paddingBottom: 15,
        borderTopWidth: 0.5,
        borderTopColor: '#5E5E5E',
    },
    border: {
        borderTopWidth: 0.5,
        borderTopColor: '#5E5E5E',
    },
    capsuleOuterShadowStyle: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 2,
        shadowColor: colors.greenShadow,
        borderRadius: 25,
        width: (widths / 2) - 30,
        height: 47,
        justifyContent: 'center',
    },
    capsuleInnerShadowStyle: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 0.64,
        shadowColor: colors.greenShadowLight,
        borderRadius: 25,
        width: (widths / 2) - 30,
        height: 47,
        justifyContent: 'center',
        position: 'absolute',
    },
    capsuleLinearGradientStyle: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.80,
        shadowRadius: 16,
        elevation: 8,
        marginHorizontal: 20,

    },
    capsuleMainShadowStyle: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        flex: 1,
    },

    capsuleLinearGradientStyleMain: {
        borderRadius: 25,
        height: 47,
        justifyContent: 'center',
        width: (widths / 2) - 30,
    },
});
