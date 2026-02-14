import { colors, widths } from "@Cypher/style-guide";
import screenWidth from "@Cypher/style-guide/screenWidth";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    title: TextStyle;
    titleVault: TextStyle;
    savingVault: ViewStyle;
    bitcoinText: TextStyle;
    bitcoinImage: ImageStyle;
    coinselected: TextStyle;
    editAmount: ViewStyle;
    priceView: ViewStyle;
    value: TextStyle;
    fees: TextStyle;
    recipientView: ViewStyle;
    recipientTitle: TextStyle;
    nextBtn: ViewStyle;
    noteInput: TextStyle;
    button: ViewStyle;
    qrcode: ImageStyle;
    feesDropDown: ViewStyle;
    middleText: ViewStyle;
    first: ViewStyle;
    second: ViewStyle;
    third: ViewStyle;
    fourth: ViewStyle;
    border: ViewStyle;
    pasteview: ViewStyle;
    tabs: ViewStyle;
    checkView: ViewStyle;
    checkImage: ImageStyle;
    editImage: ImageStyle;
    cardListContainer: ViewStyle;
    cardGradientStyle: ViewStyle;
    cardOuterShadow: ViewStyle;
    cardGradientMainStyle: ViewStyle;
    cardInnerShadow: ViewStyle;
    cardTopShadow: ViewStyle;
    logoImage: ImageStyle;
    vaultIconImage: ImageStyle;
    coldVaultIconImage: ImageStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingBottom: 30,
    },
    title: {
        fontSize: 18,
        fontFamily: 'Archivo-SemiBold',
        marginBottom: 20,
    },
    titleVault: {
        fontSize: 18,
    },
    editImage: {
        width: 22,
        height: 22
    },
    savingVault: {
        width: widths - 40,
        height: 143,
    },
    bitcoinText: {
        fontSize: 16,
    },
    bitcoinImage: {
        width: 37,
        height: 33,
    },
    coinselected: {
        fontSize: 18,
    },
    editAmount: {
        // width: 103,
        height: 38,
        borderWidth: 3,
        borderRadius: 15,
        borderColor: '#B6B6B6',
        padding: 5,
        paddingHorizontal: 10,
        marginStart: 25,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.gray.dark,
    },
    priceView: {
        flexDirection: 'row',
        marginTop: 15,
    },
    value: {
        color: colors.green,
        fontSize: 18,
        marginTop: 5,
    },
    fees: {
        fontSize: 18,
        marginTop: 5,
    },
    tabs: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        width: screenWidth * 0.17,
        // justifyContent: 'space-between',
        marginRight: 2,
        marginLeft: 2,
    },
    recipientView: {
        padding: 20,
        paddingHorizontal: 40,
        flex: 1,
    },
    recipientTitle: {
        fontSize: 18,
        marginTop: 10,
    },
    nextBtn: {
        backgroundColor: colors.green,
        height: 47,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 30,
    },
    noteInput: {
        borderWidth: 3,
        borderColor: '#B6B6B6',
        width: '50%',
        height: 35,
        borderRadius: 15,
        color: '#FFFFFF',
        textAlign: 'center',
        marginTop: 10,
    },
    checkView: {
        borderWidth: 1,
        borderColor: colors.coldGreen,
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
    qrcode: {
        width: 40,
        height: 40,
    },
    feesDropDown: {
        backgroundColor: colors.primary,
        borderWidth: 3,
        borderRadius: 10,
        borderColor: colors.green,
        position: 'absolute',
        alignSelf: 'center',
        // width: 138,
        // height: 121,
        start: widths / 3 + 20,
        top: -75,
        end: 0,
        zIndex: 1,
    },
    middleText: {
        height: 31,
        backgroundColor: colors.black.default,
        alignItems: 'center',
        justifyContent: 'center',
    },
    first: {
        backgroundColor: colors.primary,
        height: 31,
        borderTopStartRadius: 10,
        borderTopEndRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    second: {
        height: 31,
        backgroundColor: colors.black.default,
        alignItems: 'center',
        justifyContent: 'center',
    },
    third: {
        height: 31,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fourth: {
        backgroundColor: colors.black.default,
        height: 31,
        borderBottomEndRadius: 10,
        borderBottomStartRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    border: {
        borderWidth: 1,
        borderRadius: 12.5,
        borderColor: colors.white,
        paddingHorizontal: 10,
        paddingVertical: 2,
    },
    pasteview: {
        flexDirection: 'row',
        marginTop: 20,
        alignItems: 'center'
    },  
    cardListContainer: {
        marginVertical: 20,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    logoImage: {
        width: 80,
        height: 35,
        // alignSelf: "center",
    },
    cardGradientStyle: {
        shadowColor: "#040404",
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        height: 60,
        marginTop: 15,
        width: widths * 0.3,
    },
    cardOuterShadow: {
        shadowColor: "#27272C",
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        flex: 1,
    },
    cardGradientMainStyle: {
        borderRadius: 20,
        height: 60,
        justifyContent: "center",
        // width: widths - 40,
        width: widths * 0.3,
    },
    cardInnerShadow: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 0.64,
        shadowColor: colors.pink.shadowBottom,
        borderRadius: 20,
        // width: widths - 40,
        width: widths * 0.3,
        height: 60,
        justifyContent: "center",
        position: "absolute",
    },
    cardTopShadow: {
        shadowOffset: { width: 3, height: 3 },
        shadowColor: colors.pink.shadowTopNew,
        shadowRadius: 2,
        borderRadius: 20,
        // width: widths - 40,
        width: widths * 0.3,
        height: 60,
        justifyContent: "center",
    },
    vaultIconImage: {
        width: 12,
        height: 10,
        marginEnd: 5,
        marginStart: 5,
    },
    coldVaultIconImage: {
        width: 39,
        height: 29,
        marginEnd: 5,
    },
})
