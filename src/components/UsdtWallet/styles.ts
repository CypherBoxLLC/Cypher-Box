import { colors, widths } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

/**
 * The USDT card is a converter, so it is taller than the other wallet cards.
 *
 * Every other card fits LinearBorderView's shared 184pt frame. This one holds
 * a balance, two amount fields with a flip button between them, a price line
 * and three buttons, which does not. It passes its own height to
 * LinearBorderView instead of the shared one, and the constants below add up
 * to exactly that height so the content cannot outgrow the frame unnoticed:
 * change a height here and change CARD_HEIGHT by the same amount.
 *
 * The carousel auto-sizes to its tallest slide, so this height is also what
 * the USDT slide adds to Home. The shared Send/Receive row that spans the
 * other slides is faded out on this one (see WalletsView), which is why
 * Receive and Send live inside the card rather than under it.
 *
 * Every text style sets its own lineHeight: the shared Text's base is 18pt,
 * which clips the tops of anything set larger.
 */

/** The frame's inner width, from LinearBorderView's gradientBackground. */
const CARD_INNER_WIDTH = widths - 118;

const PADDING_H = 14;
const PADDING_V = 10;

/** The width the card's rows have to work with. */
const CONTENT_WIDTH = CARD_INNER_WIDTH - PADDING_H * 2;

/** Receive and Send sit side by side with this between them. */
const PAIR_GAP = 12;
const PAIR_WIDTH = Math.floor((CONTENT_WIDTH - PAIR_GAP) / 2);

const LABEL_ROW_HEIGHT = 20;
const BALANCE_HEIGHT = 24;
const FIELD_HEIGHT = 42;
/** The gap the flip button straddles. */
const FIELD_GAP = 10;
const NOTE_HEIGHT = 16;
const NOTE_MARGIN = 4;
const BUTTON_HEIGHT = 33;
const SWAP_MARGIN = 8;
const PAIR_MARGIN = 8;

const FIELDS_HEIGHT = FIELD_HEIGHT * 2 + FIELD_GAP;
const FLIP_SIZE = 30;

/** What the card asks LinearBorderView for. The sum of everything above. */
export const CARD_HEIGHT =
    PADDING_V * 2 +
    LABEL_ROW_HEIGHT +
    BALANCE_HEIGHT +
    FIELDS_HEIGHT +
    NOTE_MARGIN +
    NOTE_HEIGHT +
    SWAP_MARGIN +
    BUTTON_HEIGHT +
    PAIR_MARGIN +
    BUTTON_HEIGHT;

const styles = StyleSheet.create({
    container: {
        marginTop: 15,
    },
    rowContainer: {
        flexDirection: 'row',
        marginTop: 5,
    },
    card: {
        flex: 1,
        paddingHorizontal: PADDING_H,
        paddingVertical: PADDING_V,
    },
    labelRow: {
        height: LABEL_ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.usdt.light,
    },
    balanceAmount: {
        height: BALANCE_HEIGHT,
        fontSize: 18,
        lineHeight: 24,
    },
    balanceSpinner: {
        height: BALANCE_HEIGHT,
        alignSelf: 'flex-start',
    },
    // A drawn question mark: the app ships no question-mark asset, and its
    // info glyphs are an "i", which is not what this opens.
    helpButton: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 1.5,
        borderColor: colors.usdt.light,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
    },
    helpText: {
        fontSize: 11,
        lineHeight: 13,
        color: colors.usdt.light,
        textAlign: 'center',
    },

    /* The two amount fields, and the flip button between them. */
    fields: {
        height: FIELDS_HEIGHT,
        justifyContent: 'space-between',
    },
    field: {
        height: FIELD_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#3A3A4A',
        backgroundColor: colors.black.bg,
    },
    // The field being typed into is the one that reads as active.
    fieldActive: {
        borderColor: colors.usdt.light,
    },
    fieldInput: {
        flex: 1,
        fontSize: 20,
        lineHeight: 26,
        padding: 0,
        color: colors.white,
        fontFamily: 'Lato-Bold',
    },
    // The worked-out side, which is read rather than typed.
    fieldValue: {
        flex: 1,
        fontSize: 20,
        lineHeight: 26,
        color: colors.white,
    },
    fieldValueQuiet: {
        color: colors.gray.light,
    },
    fieldUnit: {
        fontSize: 14,
        lineHeight: 20,
        marginLeft: 8,
    },
    flipButton: {
        position: 'absolute',
        alignSelf: 'center',
        top: (FIELDS_HEIGHT - FLIP_SIZE) / 2,
        width: FLIP_SIZE,
        height: FLIP_SIZE,
        borderRadius: FLIP_SIZE / 2,
        borderWidth: 1,
        borderColor: colors.usdt.light,
        backgroundColor: colors.black.bg,
        alignItems: 'center',
        justifyContent: 'center',
    },

    /* The line under the fields: the price, or what is wrong with the amount. */
    note: {
        height: NOTE_HEIGHT,
        marginTop: NOTE_MARGIN,
        fontSize: 12,
        lineHeight: 16,
        color: colors.gray.light,
    },
    noteWarning: {
        color: colors.redLight,
    },

    /* Buttons. Swap spans the card; Receive and Send share the row below. */
    swapRow: {
        marginTop: SWAP_MARGIN,
    },
    pairRow: {
        marginTop: PAIR_MARGIN,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    actionButton: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        width: CONTENT_WIDTH,
    },
    actionGradient: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        width: CONTENT_WIDTH,
    },
    topShadow: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 0.6,
        shadowColor: '#000000',
        borderRadius: 25,
        height: BUTTON_HEIGHT,
        width: CONTENT_WIDTH,
        justifyContent: 'center',
    },
    bottomShadow: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 25,
        height: BUTTON_HEIGHT,
        width: CONTENT_WIDTH,
        justifyContent: 'center',
        position: 'absolute',
    },
    actionGradientMain: {
        borderRadius: 25,
        height: BUTTON_HEIGHT,
        width: CONTENT_WIDTH,
        justifyContent: 'center',
    },
    // The narrow pair. Same geometry, half the width.
    pairButton: {
        width: PAIR_WIDTH,
    },
    pairShadow: {
        width: PAIR_WIDTH,
    },
    buttonLabel: {
        fontSize: 15,
        lineHeight: 20,
    },
    buttonLabelDisabled: {
        color: colors.gray.light,
    },
});

export default styles;
