import { colors, widths } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

import { INNER_INSET } from "../StrikeView/LinearBorderView/styles";

/**
 * The USDT card: a balance with its own Receive and Send, a rule, then the
 * converter and its Swap button.
 *
 * Two things differ from every other wallet card, and both are passed to
 * LinearBorderView rather than changed in it, so the other cards keep the
 * frame they had:
 *
 *   - Width. The cards sit at widths - 114 inside a carousel slide that is
 *     screenWidth * 0.905 wide, which left this one visibly narrow beside the
 *     Total Assets card above it. It now fills the slide.
 *   - Height. A balance, two amount fields, a price and three buttons do not
 *     fit the shared 184pt.
 *
 * The constants below add up to CONTENT_HEIGHT, and the frame is that plus
 * INNER_INSET, because the children live inside LinearBorderView's inner
 * gradient which is INNER_INSET shorter than the frame. Sizing the frame to
 * the content instead is what clipped Receive and Send off the bottom.
 * Change a height here and CONTENT_HEIGHT follows on its own.
 *
 * Every text style sets its own lineHeight: the shared Text's base is 18pt,
 * which clips the tops of anything set larger.
 */

/** Fills the carousel slide, matching the Total Assets card above. */
export const CARD_WIDTH = widths - 40;

const PADDING_H = 14;
const PADDING_V = 12;

/** The width the card's rows have to work with, inside the inner gradient. */
const CONTENT_WIDTH = CARD_WIDTH - INNER_INSET - PADDING_H * 2;

const LABEL_ROW = 18;
const BALANCE_ROW = 34;
const BALANCE_MARGIN = 2;

const RULE_MARGIN = 10;
const RULE = 1;

const FIELD = 44;
/** The gap the flip button straddles. */
const FIELD_GAP = 8;
const FIELDS = FIELD * 2 + FIELD_GAP;
const FLIP = 30;

const RATE = 16;
const RATE_MARGIN = 6;

const SWAP_BUTTON = 36;
const SWAP_MARGIN = 10;

/** Receive and Send, side by side at the end of the balance row. */
const SMALL_BUTTON = 30;
const SMALL_GAP = 8;
const SMALL_WIDTH = 78;

const CONTENT_HEIGHT =
    PADDING_V * 2 +
    LABEL_ROW +
    BALANCE_MARGIN +
    BALANCE_ROW +
    RULE_MARGIN * 2 +
    RULE +
    FIELDS +
    RATE_MARGIN +
    RATE +
    SWAP_MARGIN +
    SWAP_BUTTON;

/** What the card asks LinearBorderView for. */
export const CARD_HEIGHT = CONTENT_HEIGHT + INNER_INSET;

const styles = StyleSheet.create({
    container: {
        marginTop: 15,
    },
    rowContainer: {
        flexDirection: 'row',
        marginTop: 5,
    },
    // LinearBorderView's own trailing margin would push the wider card past
    // the slide, so it is cancelled here.
    frame: {
        marginEnd: 0,
    },
    card: {
        flex: 1,
        paddingHorizontal: PADDING_H,
        paddingVertical: PADDING_V,
    },

    /* Section one: the balance, with Receive and Send beside it. */
    labelRow: {
        height: LABEL_ROW,
        flexDirection: 'row',
        alignItems: 'center',
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
    balanceRow: {
        height: BALANCE_ROW,
        marginTop: BALANCE_MARGIN,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    balanceBlock: {
        flex: 1,
        paddingRight: 10,
        justifyContent: 'center',
    },
    balanceLabel: {
        fontSize: 15,
        lineHeight: 18,
        color: colors.usdt.light,
    },
    balanceAmount: {
        fontSize: 19,
        lineHeight: 25,
    },
    // Shown instead of the balance when the read failed. Tapping retries.
    balanceProblem: {
        fontSize: 13,
        lineHeight: 17,
        color: colors.redLight,
    },
    smallButtons: {
        flexDirection: 'row',
    },
    rule: {
        height: RULE,
        marginVertical: RULE_MARGIN,
        backgroundColor: '#3A3A4A',
    },

    /* Section two: the converter. */
    fields: {
        height: FIELDS,
        justifyContent: 'space-between',
    },
    field: {
        height: FIELD,
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
        top: (FIELDS - FLIP) / 2,
        width: FLIP,
        height: FLIP,
        borderRadius: FLIP / 2,
        borderWidth: 1,
        borderColor: colors.usdt.light,
        backgroundColor: colors.black.bg,
        alignItems: 'center',
        justifyContent: 'center',
    },

    /* The line under the fields: the price, or what is wrong with the amount. */
    note: {
        height: RATE,
        marginTop: RATE_MARGIN,
        fontSize: 12,
        lineHeight: 16,
        color: colors.gray.light,
    },
    noteWarning: {
        color: colors.redLight,
    },

    swapRow: {
        marginTop: SWAP_MARGIN,
    },

    /* Button geometry. Swap spans the card; Receive and Send are the pair. */
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
        borderRadius: 18,
        height: SWAP_BUTTON,
        width: CONTENT_WIDTH,
        justifyContent: 'center',
    },
    bottomShadow: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 18,
        height: SWAP_BUTTON,
        width: CONTENT_WIDTH,
        justifyContent: 'center',
        position: 'absolute',
    },
    actionGradientMain: {
        borderRadius: 18,
        height: SWAP_BUTTON,
        width: CONTENT_WIDTH,
        justifyContent: 'center',
    },
    // The pair. Same shape, smaller, and the second one spaced off the first.
    smallSize: {
        width: SMALL_WIDTH,
        height: SMALL_BUTTON,
        borderRadius: 15,
    },
    smallSpaced: {
        marginLeft: SMALL_GAP,
    },
    buttonLabel: {
        fontSize: 15,
        lineHeight: 20,
    },
    smallLabel: {
        fontSize: 13,
        lineHeight: 17,
    },
    buttonLabelDisabled: {
        color: colors.gray.light,
    },
});

export default styles;
