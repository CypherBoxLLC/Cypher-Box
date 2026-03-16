import { colors, shadow, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerContainer: ViewStyle;
    shadowTopBottom: any;
    shadowBottomBottom: any;
    bottominner: ViewStyle;
    bitcointext: TextStyle;
    bitcoinimg: ImageStyle;
    row: ViewStyle;
    tabs: ViewStyle;
    tab: ViewStyle;
    bitcoin: ViewStyle;
    progressbar: ImageStyle;
}

export default StyleSheet.create<Style>({
    container: {
        shadowOffset: { width: 8, height: 8 },
        shadowRadius: 18,
        shadowOpacity: 0.8,
        shadowColor: '#040404',
        elevation: 24,
        borderRadius: 25,
        width: widths - 80,
        height: 128,
        marginTop: 16,
        borderColor: "transparent",
        backgroundColor: colors.primary,
        alignSelf: "center",
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
        shadowOpacity: 1,
        shadowColor: colors.greenShadow,
        borderRadius: 25,
        width: widths - 80,
        height: 128,
        backgroundColor: colors.primary,
        padding: 15,
        paddingStart: 20,
        paddingEnd: 10,
    },
    shadowBottomBottom: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: colors.greenShadowLight,
        borderRadius: 25,
        width: widths - 80,
        height: 128,
        justifyContent: 'center',
        position: 'absolute',
    },
    bottominner: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    bitcointext: {
        marginEnd: 5,
        ...shadow.text25,
    },
    bitcoinimg: {
        width: 35,
        height: 35,
    },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tabs: {
        flexDirection: 'row',
        flex: 1,
        alignItems: 'flex-end',
    },
    tab: {
        flex: 1,
        height: 12,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.white,
        justifyContent: 'center',
        marginEnd: 10,
        // flex: 1,
        // borderRadius: 2.5,
        // borderWidth: 1,
        // borderColor: colors.white,
        // height: 10,
        // marginBottom: 5,
        // marginEnd: 10,
        // justifyContent: 'center',
    },
    bitcoin: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginTop: 15,
    },
    progressbar: {
        height: 6,
        width: undefined,
        marginHorizontal: 2,
        justifyContent: 'center',
    },
})