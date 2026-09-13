import { colors } from "@Cypher/style-guide";
import { StyleProp, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    inputsContainer: ViewStyle;
    inputColumn: ViewStyle;
    inputContainer: ViewStyle;
    inputStyle: ViewStyle;
    labelText: TextStyle;
    textInputStyle: ViewStyle;
    button: StyleProp<ViewStyle>;
    btnText: TextStyle;
    introTitle: TextStyle;
    introBody: TextStyle;
    error: TextStyle;
    loadingText: TextStyle;
    loadingContainer: ViewStyle;
    seedOnlyLink: ViewStyle;
    seedOnlyLinkText: TextStyle;
}

/**
 * Layout cloned from RecoverSavingVault (hot-vault recovery) so the two
 * "type your 12 words" screens feel identical to the user. Only the accent
 * colour swaps from `colors.green` (Bitcoin / hot vault) to `colors.ark.light`
 * (Ark / Second.tech) to signal which wallet type they're restoring.
 */
export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        backgroundColor: colors.primary,
        alignItems: "center",
        paddingHorizontal: 20,
    },
    inputsContainer: {
        // RN doesn't accept "col" — kept "column" so it actually wraps.
        flexDirection: "column",
        width: "100%",
        marginVertical: 20,
    },
    inputColumn: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
    },
    inputContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginVertical: 3,
        flexWrap: "wrap",
    },
    inputStyle: {
        width: 120,
        height: 40,
        borderWidth: 1,
        borderRadius: 30,
        borderColor: colors.ark.light,
    },
    labelText: {
        width: 30,
        marginRight: 10,
        textAlign: "auto",
    },
    textInputStyle: {
        width: "100%",
        height: "100%",
        borderRadius: 30,
        fontSize: 16,
    },
    /**
     * Primary CTA. This used to carry `top: heights * 0.18` with no `position`
     * key, so the default `relative` made it a PAINT-ONLY offset: the button
     * was drawn ~144 to 154dp below its flow slot while its siblings stayed
     * put, which meant the filled white pill was painted straight over the
     * secondary CTAs rendered after it. Worst case, `colors.ark.light` is
     * `#FFFFFF`, the same as this background, so an overlapped link was white
     * on white and invisible rather than merely ugly. The screen sets
     * `disableScroll`, so there was no scrolling out from under it either.
     * `marginTop` consumes flow instead of faking it, which is what was
     * actually wanted. Note this style is shared with ChooseView.
     */
    button: {
        width: "100%",
        backgroundColor: colors.ark.light,
        borderWidth: 0,
        marginHorizontal: 40,
        marginTop: 24,
    },
    btnText: {
        fontFamily: "Archivo-Bold",
        color: colors.black.default,
        fontSize: 14,
    },
    introTitle: {
        color: colors.white,
        fontFamily: "Archivo-SemiBold",
        fontSize: 15,
        marginBottom: 6,
        marginTop: 4,
        alignSelf: "flex-start",
    },
    introBody: {
        color: "rgba(255, 255, 255, 0.7)",
        fontFamily: "Archivo-Regular",
        fontSize: 12,
        lineHeight: 17,
        alignSelf: "flex-start",
    },
    error: {
        color: "#FF7A68",
        fontFamily: "Archivo-Regular",
        fontSize: 12,
        marginTop: 10,
        alignSelf: "flex-start",
    },
    loadingText: {
        color: colors.white,
        marginTop: 12,
        fontFamily: "Archivo-Regular",
        fontSize: 14,
    },
    loadingContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    /**
     * Seed-only CTA in TypeSeedView. Its own tier: ark-coloured like the two
     * restore CTAs above it (it is a real branch, not a refinement) but a link
     * rather than a button, so it stays subordinate to the .cbark paths, which
     * restore more. Not `styles.button`, in keeping with every other secondary
     * CTA on this screen being a hand-rolled TouchableOpacity.
     */
    seedOnlyLink: {
        alignSelf: "center",
        marginTop: 14,
        paddingVertical: 8,
    },
    seedOnlyLinkText: {
        color: colors.ark?.light ?? colors.pink.default,
        fontSize: 13,
        textDecorationLine: "underline",
    },
});
