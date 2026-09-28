import { widths } from "@Cypher/style-guide";
import { StyleSheet, ViewStyle } from "react-native";

/**
 * The frame every wallet card in the carousel has used, and what a caller gets
 * without asking for another. Exported so a card that overrides either one can
 * say what it is overriding.
 */
export const CARD_FRAME_HEIGHT = 184;
export const CARD_FRAME_WIDTH = widths - 114;

/**
 * How much smaller the inner gradient is than the frame, on each axis.
 *
 * Children are laid out inside that inner gradient, so a card sizing itself
 * must budget for the frame it asks for minus this, not the frame itself.
 */
export const INNER_INSET = 4;

interface Style {
    gradientBorder: ViewStyle;
    innerContainer: ViewStyle;
    gradientBackground: ViewStyle;
}

export default StyleSheet.create<Style>({
    gradientBorder: {
        borderRadius: 25,
        height: CARD_FRAME_HEIGHT,
        width: CARD_FRAME_WIDTH,
        marginEnd: 7,
    },
    innerContainer: {
        borderRadius: 9,
        height: CARD_FRAME_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    gradientBackground: {
        height: CARD_FRAME_HEIGHT - INNER_INSET,
        width: CARD_FRAME_WIDTH - INNER_INSET,
        borderRadius: 23,
    },
})
