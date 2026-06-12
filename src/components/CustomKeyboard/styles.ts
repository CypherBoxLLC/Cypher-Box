import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    linearGradient: ViewStyle;
    keypad: ViewStyle;
    key: ViewStyle;
    keyText: TextStyle;
    invoiceButton: ViewStyle;
    maxButton: ViewStyle;
    maxText: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 40
    },
    linearGradient: {
        height: 2,
        width: '100%',
    },
    keypad: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    keyText: {
        fontSize: 24,
        lineHeight: 32,
        fontFamily: 'Lato-Medium',
    },
    key: {
        width: '33%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
    },
    invoiceButton: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
    // MAX button — designed as a compact CTA pill that reads as a real
    // keypad action key (not a tight pill, not a giant gradient block).
    //
    // Design rationale:
    // - The numeric keys have heavy visual weight (fontSize 24 / lineHeight
    //   32). We don't want MAX to compete on raw size with digits — it's
    //   an ACTION, not a numeric input, so it gets a different visual
    //   language: gradient-filled pill with a small, letter-spaced label.
    // - Pill dimensions ~108×52: roughly matches a numeric key's tap area
    //   so the row doesn't feel uneven, but the rounded gradient distinguishes
    //   the action from numeric keys.
    // - Text 14px with letterSpacing 1.5: short labels like "MAX" read well
    //   at smaller font sizes when spaced out — it scans as a button label,
    //   not as a digit. The (already-applied) `bold` prop on the Text adds
    //   weight without bumping fontSize.
    // - Explicit lineHeight 20 + textAlignVertical center: avoids Fabric's
    //   tighter content-measurement clipping the bold glyphs vertically.
    // MAX button — explicit width/height (NOT padding-based) because the
    // LinearGradient was auto-sizing to a single clipped glyph under
    // Fabric. With explicit dimensions, the pill is guaranteed to render
    // at intended size regardless of how its child text measures.
    maxButton: {
        width: 72,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    maxText: {
        color: '#000000',
        fontSize: 13,
        lineHeight: 18,
        letterSpacing: 0.8,
        includeFontPadding: false,
    },
})
