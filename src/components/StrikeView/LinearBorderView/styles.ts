import { widths } from "@Cypher/style-guide";
import { StyleSheet, ViewStyle } from "react-native";

/**
 * The height every wallet card in the carousel has used, and the one a caller
 * gets without asking for another. Exported so a card that overrides it can
 * still say what it is overriding.
 */
export const CARD_FRAME_HEIGHT = 184;

/** How much shorter the inner gradient is than the frame, top and bottom together. */
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
        width: widths - 114,
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
        width: widths - 118,
        borderRadius: 23,
    },
})
