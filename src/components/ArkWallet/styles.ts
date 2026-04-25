import { colors, shadow, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    createView: ViewStyle;
    middle: ViewStyle;
    arrow: ImageStyle;
    shadow: TextStyle;
    createAccount: ViewStyle;
    text: TextStyle;
    login: TextStyle;
    alert: TextStyle;
    experimental: TextStyle;
}

/**
 * Yellow palette — distinguishes Ark (non-custodial) from
 * Strike/CoinOS (pink, custodial). The CTA box uses an outline-only
 * yellow border on a transparent fill, mirroring the SavingVault hot
 * vault visual language ("self-custody = outlined; custodial = filled").
 */
export default StyleSheet.create<Style>({
    createView: {
        // Outline-only yellow box — matches SavingVault.shadowTopBottom
        // pattern (border 1.5px on a primary-colored body).
        marginTop: 20,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        backgroundColor: colors.primary,
        padding: 15,
        paddingStart: 20,
        paddingEnd: 10,
        borderWidth: 1.5,
        borderColor: colors.ark.light,
        alignSelf: "center",
        justifyContent: "center",
        // iOS soft glow
        shadowColor: colors.ark.shadowTopNew,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 4,
        shadowOpacity: 0.4,
    },
    middle: {
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
    },
    arrow: {
        width: 50,
        height: 50,
        left: -5,
        top: 10,
        tintColor: colors.ark.light,
    },
    shadow: {
        ...shadow.text25,
        color: colors.ark.light,
    },
    createAccount: {
        flexDirection: "column",
        marginTop: 10,
        alignSelf: "center",
    },
    text: {
        fontSize: 16,
        textAlign: "center",
        color: colors.whiteText,
    },
    login: {
        fontSize: 14,
        color: colors.ark.light,
        textAlign: "center",
        marginTop: 4,
    },
    alert: {
        color: colors.green,
        marginHorizontal: 20,
    },
    experimental: {
        color: colors.ark.light,
        fontSize: 12,
        textAlign: "center",
        marginBottom: 4,
    },
});
