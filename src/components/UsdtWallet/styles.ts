import { colors } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

/**
 * The card sits in LinearBorderView's fixed frame (180pt tall inside), the
 * same one StrikeView uses, so the USDT slide matches the fiat slide's height
 * in the carousel. Two columns: the balance with Receive under it, and Swap
 * stacked on Send. Both columns are bottom-aligned, which puts Receive and
 * Send on the card's bottom edge. The pill buttons keep StrikeView's 121 by
 * 33pt geometry.
 *
 * Every text style sets its own lineHeight: the shared Text's base style is
 * 18pt, which clips the tops of anything set larger.
 */
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
        flexDirection: 'row',
        paddingHorizontal: 6,
        paddingTop: 14,
        paddingBottom: 14,
    },
    column: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
    },
    balanceBlock: {
        flex: 1,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 17,
        lineHeight: 22,
        color: colors.usdt.light,
    },
    balanceAmount: {
        fontSize: 17,
        lineHeight: 22,
        marginTop: 4,
        textAlign: 'center',
    },
    balanceSpinner: {
        marginTop: 6,
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
    actionButton: {
        shadowColor: '#040404',
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
        alignSelf: 'center',
        width: 121,
    },
    // Swap sits directly on Send, one gap apart.
    actionButtonSpaced: {
        marginBottom: 10,
    },
    actionGradient: {
        shadowColor: '#27272C',
        shadowOffset: { width: -8, height: -8 },
        shadowOpacity: 0.48,
        shadowRadius: 12,
        elevation: 8,
        width: 121,
    },
    topShadow: {
        shadowOffset: { width: 2, height: 2 },
        shadowRadius: 2,
        shadowOpacity: 0.6,
        shadowColor: '#000000',
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
    },
    bottomShadow: {
        shadowOffset: { width: -2, height: -2 },
        shadowRadius: 2,
        shadowOpacity: 1,
        shadowColor: '#030303',
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
        position: 'absolute',
    },
    actionGradientMain: {
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
    },
});

export default styles;
