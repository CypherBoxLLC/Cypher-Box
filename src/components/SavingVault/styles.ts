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
        borderRadius: 25,
        height: 128,
        marginTop: 16,
        backgroundColor: colors.primary,
        alignSelf: "center",
    },
    innerContainer: {
    },
    shadowTopBottom: {
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        backgroundColor: colors.primary,
        padding: 15,
        paddingStart: 20,
        paddingEnd: 10,
        borderWidth: 1.5,
        borderColor: colors.greenShadow,
        // Angular bottom-right drop shadow at 8/8 — matches the app-wide
        // shadow convention (HotStorageVault / ColdStorage / CreateVault /
        // Card all use 8/8) so the Hot/Cold vault boxes are visually
        // consistent with neighbouring elevated surfaces.
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.7,
        shadowColor: '#000000',
        shadowRadius: 16,
        elevation: 14,
    },
    shadowBottomBottom: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: colors.greenShadowLight,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        justifyContent: 'center',
        position: 'absolute',
    },
    bottominner: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: -3,
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
        marginTop: 4,
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