import { StyleSheet, TextStyle, ViewStyle } from "react-native";
import { colors } from "@Cypher/style-guide";

interface Style {
    container: ViewStyle;
    scroll: ViewStyle;
    content: ViewStyle;
    headerNote: TextStyle;
    warnTitle: TextStyle;
    warnBody: TextStyle;
    gridWrap: ViewStyle;
    grid: ViewStyle;
    word: ViewStyle;
    wordText: TextStyle;
    blurOverlay: ViewStyle;
    revealOverlay: ViewStyle;
    revealCenter: ViewStyle;
    revealTitle: TextStyle;
    revealDetail: TextStyle;
    revealBtn: ViewStyle;
    revealBtnText: TextStyle;
    divider: ViewStyle;
    sectionTitle: TextStyle;
    sectionSub: TextStyle;
    keychainRow: ViewStyle;
    keychainLabel: TextStyle;
    keychainSub: TextStyle;
    backupOption: ViewStyle;
    backupOptionSelected: ViewStyle;
    backupRadioOuter: ViewStyle;
    backupRadioOuterSelected: ViewStyle;
    backupRadioInner: ViewStyle;
    backupOptionTextWrap: ViewStyle;
    backupOptionLabel: TextStyle;
    backupOptionDetail: TextStyle;
    backupTagRecommended: TextStyle;
    backupTagOptIn: TextStyle;
    backupTagWarn: TextStyle;
    warnPanel: ViewStyle;
    warnPanelTitle: TextStyle;
    warnPanelBody: TextStyle;
    button: ViewStyle;
    btnText: TextStyle;
    cancelText: TextStyle;
    loadingContainer: ViewStyle;
    loadingText: TextStyle;
    statusOk: TextStyle;
    statusErr: TextStyle;
}

// Fixed dimensions — BlurView (native UIVisualEffectView) needs explicit
// width/height for absolute-positioned overlays to render reliably on iOS.
// 320×260 fits 12 word boxes at ~30% width × 4 rows comfortably.
const GRID_W = 320;
const GRID_H = 320;

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        backgroundColor: colors.primary,
        paddingBottom: 40,
    },
    scroll: {
        flexGrow: 1,
        paddingBottom: 24,
    },
    content: {
        paddingHorizontal: 24,
        paddingTop: 16,
    },
    headerNote: {
        color: colors.gray.light,
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 14,
    },
    warnTitle: {
        color: colors.ark.light,
        fontSize: 15,
        fontWeight: "bold",
        marginBottom: 6,
    },
    warnBody: {
        color: colors.whiteText,
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 4,
    },
    gridWrap: {
        alignItems: "center",
        marginTop: 8,
        marginBottom: 14,
    },
    grid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        alignContent: "center",
        width: GRID_W,
        height: GRID_H,
        paddingVertical: 10,
        paddingHorizontal: 6,
        borderColor: colors.ark.dark,
        borderWidth: 1,
        borderRadius: 12,
        position: "relative",
    },
    word: {
        width: GRID_W * 0.3,
        height: 36,
        margin: 4,
        borderColor: colors.ark.dark,
        borderWidth: 1,
        borderRadius: 8,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "rgba(255, 198, 0, 0.04)",
    },
    wordText: {
        fontFamily: "Archivo-Bold",
        fontSize: 13,
        color: colors.white,
    },
    blurOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        width: GRID_W,
        height: GRID_H,
        borderRadius: 12,
        overflow: "hidden",
    },
    // Sibling overlay above the BlurView. Holds the interactive reveal CTA.
    // pointerEvents="box-none" on this lets touches pass through the empty
    // padding to whatever's underneath, while still capturing taps on the
    // TouchableOpacity itself.
    revealOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        width: GRID_W,
        height: GRID_H,
        alignItems: "center",
        justifyContent: "center",
    },
    revealCenter: {
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 20,
    },
    revealTitle: {
        fontFamily: "Archivo-Bold",
        fontSize: 14,
        textAlign: "center",
        color: colors.white,
    },
    revealDetail: {
        fontFamily: "Archivo-Regular",
        fontSize: 12,
        marginTop: 10,
        textAlign: "center",
        color: colors.gray.light,
    },
    revealBtn: {
        backgroundColor: colors.ark.light,
        width: 130,
        height: 46,
        borderRadius: 30,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        marginTop: 22,
    },
    revealBtnText: {
        fontFamily: "Archivo-Bold",
        fontSize: 15,
        color: colors.black.default,
        marginStart: 6,
    },
    divider: {
        height: 1,
        backgroundColor: colors.gray.disable,
        marginVertical: 18,
        opacity: 0.5,
    },
    sectionTitle: {
        color: colors.white,
        fontSize: 15,
        fontWeight: "bold",
        marginBottom: 4,
    },
    sectionSub: {
        color: colors.gray.light,
        fontSize: 12,
        lineHeight: 17,
        marginBottom: 10,
    },
    keychainRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 8,
    },
    keychainLabel: {
        color: colors.white,
        fontSize: 14,
    },
    keychainSub: {
        color: colors.gray.light,
        fontSize: 12,
        marginTop: 2,
        paddingRight: 12,
    },
    backupOption: {
        flexDirection: "row",
        alignItems: "flex-start",
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.gray.disable,
        marginBottom: 8,
    },
    backupOptionSelected: {
        borderColor: colors.ark.light,
        backgroundColor: "rgba(255, 198, 0, 0.06)",
    },
    backupRadioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: colors.gray.light,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 2,
        marginRight: 12,
    },
    backupRadioOuterSelected: {
        borderColor: colors.ark.light,
    },
    backupRadioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.ark.light,
    },
    backupOptionTextWrap: {
        flex: 1,
    },
    backupOptionLabel: {
        color: colors.white,
        fontSize: 14,
        fontWeight: "bold",
    },
    backupOptionDetail: {
        color: colors.gray.light,
        fontSize: 12,
        lineHeight: 17,
        marginTop: 3,
    },
    backupTagRecommended: {
        color: colors.ark.light,
        fontSize: 11,
        fontStyle: "italic",
        marginTop: 4,
    },
    backupTagOptIn: {
        color: colors.gray.light,
        fontSize: 11,
        fontStyle: "italic",
        marginTop: 4,
    },
    backupTagWarn: {
        color: colors.redLight,
        fontSize: 11,
        fontStyle: "italic",
        marginTop: 4,
    },
    // Lost-device footgun panel — bordered red so it visually outranks the
    // two normal "always on" / "recommended" rows above it.
    warnPanel: {
        marginTop: 14,
        borderWidth: 1,
        borderColor: colors.redLight,
        backgroundColor: "rgba(255, 80, 80, 0.06)",
        borderRadius: 12,
        padding: 12,
    },
    warnPanelTitle: {
        color: colors.redLight,
        fontSize: 13,
    },
    warnPanelBody: {
        color: "#cdd",
        fontSize: 12,
        lineHeight: 17,
        marginTop: 4,
    },
    button: {
        backgroundColor: colors.ark.light,
        marginHorizontal: 24,
        marginBottom: 12,
        marginTop: 4,
    },
    btnText: {
        color: colors.black.default,
        fontFamily: "Archivo-Bold",
        fontSize: 16,
    },
    cancelText: {
        color: colors.gray.light,
        textAlign: "center",
        fontSize: 14,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    loadingText: {
        marginTop: 15,
        fontSize: 16,
        color: colors.white,
    },
    statusOk: {
        color: colors.ark.light,
        fontSize: 12,
        fontStyle: "italic",
        marginTop: 6,
    },
    statusErr: {
        color: colors.redLight,
        fontSize: 12,
        fontStyle: "italic",
        marginTop: 6,
    },
});
