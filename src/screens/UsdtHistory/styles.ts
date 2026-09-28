import { colors } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

/**
 * A list of what the wallet's USDT has done. Rows carry a title, a detail line
 * and an amount, with a day heading above the first row of each day.
 *
 * The amount's colour is the only thing that tells direction at a glance, so
 * the three cases are deliberately distinct: green in, white out, and the USDT
 * teal for a swap, which is money leaving that bought something rather than
 * money simply gone.
 *
 * Every text style sets its own lineHeight: the shared Text's base is 18pt,
 * which clips the tops of anything set larger.
 */
export default StyleSheet.create({
    list: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 20,
        paddingBottom: 30,
        flexGrow: 1,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 60,
        paddingHorizontal: 20,
    },
    day: {
        marginTop: 18,
        marginBottom: 6,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.6,
        color: '#888',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#232336',
    },
    rowLeft: {
        flex: 1,
        paddingRight: 12,
    },
    rowTitle: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.white,
    },
    rowDetail: {
        marginTop: 2,
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
    },
    amount: {
        fontSize: 15,
        lineHeight: 20,
    },
    amountIn: {
        color: colors.green,
    },
    amountOut: {
        color: colors.white,
    },
    amountSwap: {
        color: colors.usdt.light,
    },
    /** Shown above the list when the last read failed, with whatever was read still below it. */
    problem: {
        marginTop: 14,
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
        color: colors.redLight,
    },
    empty: {
        fontSize: 18,
        lineHeight: 24,
        color: colors.white,
    },
    emptyDetail: {
        marginTop: 8,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: colors.gray.light,
    },
});
