import { colors, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    gradientBorder: ViewStyle;
    innerContainer: ViewStyle;
    gradientBackground: ViewStyle;
    strikeRow: ViewStyle;
    sideContainer: ViewStyle;
    fiatBalanceBox: ViewStyle;
    fiatBalanceBox2: ViewStyle;
    fiatBalanceBox3: ViewStyle;
    sellBuyButton: ViewStyle;
    sellBuyGradient: ViewStyle;
    topShadow: ViewStyle;
    bottomShadow: ViewStyle;
    linearGradientStyleMain: ViewStyle;
    sellBuyButton2: ViewStyle;
    sellBuyGradient2: ViewStyle;
    topShadow2: ViewStyle;
    bottomShadow2: ViewStyle;
    linearGradientStyleMain2: ViewStyle;
    sellBuyButton3: ViewStyle;
    sellBuyGradient3: ViewStyle;
    topShadow3: ViewStyle;
    bottomShadow3: ViewStyle;
    linearGradientStyleMain3: ViewStyle;
    sellBuyButton4: ViewStyle;
    sellBuyGradient4: ViewStyle;
    topShadow4: ViewStyle;
    bottomShadow4: ViewStyle;
    linearGradientStyleMain4: ViewStyle;
    rowContainer: ViewStyle;
    progressBarImage: ImageStyle;
    minusButton: ViewStyle;
    bottomButtonsContainer: ViewStyle;
    bitcoinPriceContainer: ViewStyle;
    bitcoinPriceText: TextStyle;
    strikeLogo: ImageStyle;
}

export default StyleSheet.create<Style>({
    container: {
        marginTop: 14,
    },
    gradientBorder: {
        borderRadius: 12,
    },
    innerContainer: {
        borderRadius: 9,
        overflow: 'hidden',
    },
    gradientBackground: {
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    strikeRow: {
        flexDirection: 'row',
        flex: 1,
    },
    sideContainer: {
        flex: 1,
    },
    fiatBalanceBox: {
        width: 121,
        height: 94,
        margin: 20,
        marginBottom: 10,
        alignSelf: 'flex-start',
        alignItems: 'center',
    },
    fiatBalanceBox2: {
        width: 121,
        height: 94,
        margin: 20,
        marginBottom: 10,
        alignSelf: 'center',
        justifyContent: 'center',
        borderRadius: 20,
    },
    fiatBalanceBox3: {
        borderRadius: 18,
        width: 115,
        height: 88,
    },
    sellBuyButton: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        width: 121,
    },
    sellBuyGradient: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        width: 121,
    },
    topShadow: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 2,
        shadowColor: colors.greenShadow,
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
    },
    bottomShadow: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain: {
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
    },
    sellBuyButton2: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        height: 89,
        width: 67,
    },
    sellBuyGradient2: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    topShadow2: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        // shadowOpacity: 1,
        shadowColor: colors.greenShadow,
        borderRadius: 24,
        height: 89,
        width: 67,
        justifyContent: 'center',
        alignItems: 'center'
    },
    bottomShadow2: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 24,
        height: 89,
        width: 67,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain2: {
        borderRadius: 24,
        height: 89,
        width: 67,
        justifyContent: 'center',
        alignItems: 'center'
    },
    sellBuyButton3: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        height: 38,
        width: widths * 0.60,
    },
    sellBuyGradient3: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    topShadow3: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        // shadowOpacity: 1,
        shadowColor: colors.greenShadow,
        borderRadius: 24,
        height: 38,
        width: widths * 0.60,
        justifyContent: 'center',
        alignItems: 'center'
    },
    bottomShadow3: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 24,
        height: 38,
        width: widths * 0.60,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain3: {
        borderRadius: 24,
        height: 38,
        width: widths * 0.60,
        justifyContent: 'center',
        alignItems: 'center'
    },
    sellBuyButton4: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        height: 38,
        width: widths * 0.26,
        marginStart: 11
    },
    sellBuyGradient4: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
    },
    topShadow4: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        // shadowOpacity: 1,
        shadowColor: '#E85C5A',
        borderRadius: 24,
        height: 38,
        width: widths * 0.26,
        justifyContent: 'center',
        alignItems: 'center'
    },
    bottomShadow4: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 24,
        height: 38,
        width: widths * 0.26,
        justifyContent: 'center',
        position: 'absolute',
    },
    linearGradientStyleMain4: {
        borderRadius: 24,
        height: 38,
        width: widths * 0.26,
        justifyContent: 'center',
        alignItems: 'center'
    },
    rowContainer: {
        flexDirection: 'row'
    },
    progressBarImage: {
        width: 62,
        height: 15
    },
    minusButton: {
        marginTop: 5
    },
    bottomButtonsContainer: {
        flexDirection: 'row',
        marginTop: 15
    },
    bitcoinPriceContainer: {
        marginTop: 8,
    },
    bitcoinPriceText: {
        fontSize: 30,
        lineHeight: 40
    },
    strikeLogo: {
        width: 160,
        height: 50,
        marginTop: 40,
        alignSelf: 'center'
    },
});
