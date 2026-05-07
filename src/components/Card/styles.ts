import { colors, shadow, widths } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    shadowView: ViewStyle;
    shadowViewArk: ViewStyle;
    shadowTop: any;
    view: ViewStyle;
    check: TextStyle;
    blink: ViewStyle;
    sats: TextStyle;
    shadowBottom: ViewStyle;
    linearGradient2: ViewStyle;
    showLine: ViewStyle;
    box: ViewStyle;
    btnView: ViewStyle;
}
export default StyleSheet.create({
    shadowView: {
        // Original Strike/CoinOS card shadow: a soft top-left rim highlight
        // (#27272C @ -8/-8 / opacity .48 / radius 12). Kept as-is so the
        // Lightning cards retain their established look.
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowColor: '#27272C',
        shadowRadius: 12,
        elevation: 24,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        marginTop: 5,
        borderColor: "transparent",
        // colors.primary (dark) instead of colors.white — see same
        // comment in StrikeWallet/styles.ts shadowView. The 1pt
        // borderRadius gap between this wrapper (25) and the pink
        // gradient ring inside (24) leaked white at the corners
        // under Fabric and read as an unwanted white border.
        backgroundColor: colors.primary,
    },
    shadowViewArk: {
        // Ark card adopts the vault-style drop shadow used across Hot
        // Vault, Cold Storage, Create Vault, etc — bottom-right black
        // drop at 8/8 / opacity .7 / radius 16 — to feel like it belongs
        // to the same visual system as the vaults. Strike/CoinOS keep
        // their original `shadowView` rim highlight (above).
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.7,
        shadowColor: '#000000',
        shadowRadius: 16,
        elevation: 14,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        marginTop: 5,
        borderColor: "transparent",
        // Same fix as shadowView above — primary instead of white.
        backgroundColor: colors.primary,
    },
    shadowTop: {
        borderRadius: 24,
        width: widths - 40,
        height: 128,
        backgroundColor: colors.primary,
        paddingHorizontal: 30,
        padding: 0
    },
    // 1.5px-padding wrapper for Strike/CoinOS Lightning cards. The wrapping
    // <LinearGradient> gets the pink gradient and acts as the visible
    // outline; `shadowTopInner` sits inside and paints the actual card
    // surface, leaving a 1.5px ring of gradient around the perimeter.
    shadowTopGradientOutline: {
        borderRadius: 24,
        width: widths - 40,
        height: 128,
        padding: 1.5,
    },
    shadowTopInner: {
        flex: 1,
        borderRadius: 22.5,
        backgroundColor: colors.primary,
        paddingHorizontal: 30,
        padding: 0,
    },
    view: {
        flexDirection: 'row',
        paddingTop: 15,
        justifyContent: 'space-between',
    },
    check: {
        ...shadow.text25,
    },
    blink: {
        width: 75,
        height: 20,
        marginTop: 10,
    },
    sats: {
        ...shadow.text25,
        fontSize: 18
    },
    totalsats: {
        alignSelf: 'flex-end',
    },
    shadowBottom: {
        shadowOffset: { width: -3, height: -3 },
        shadowOpacity: 1,
        shadowRadius: 2,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        justifyContent: 'center',
        position: 'absolute',
        shadowColor: colors.pink.shadowBottom
    },
    linearGradient2: {
        width: '100%',
        borderRadius: 5,
        height: 5,
        alignSelf: 'flex-start',
        marginVertical: 10,
        zIndex: 99
    },
    showLine: {
        position: 'absolute',
        width: '100%',
        backgroundColor: '#5F5F5F',
        height: 5,
        borderRadius: 5,
        marginVertical: 10,
    },
    box: {
        position: 'absolute',
        top: 10,
        height: 5,
        width: 4,
        backgroundColor: colors.white,
        zIndex: 100,
    },
    btnView: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginVertical: 10,
    },
})