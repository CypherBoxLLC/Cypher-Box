import { colors, shadow, widths } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

/**
 * Two cards in one sheet.
 *
 * The unlocked balance card borrows StrikeView's geometry so the USDT slide
 * sits at the same height as the fiat slide in the carousel: same 121pt
 * columns, same 33pt buttons, same 25pt radii. Changing those here resizes the
 * carousel slot around this slide.
 *
 * The locked card borrows ArkWallet's create-state instead: an outline-only
 * box on a transparent body, which is the app's existing visual language for
 * something the user has yet to turn on, rather than for a balance.
 */
const styles = StyleSheet.create({
    container: {
        marginTop: 15,
    },
    rowContainer: {
        flexDirection: 'row',
        marginTop: 5,
    },
    usdtRow: {
        flexDirection: 'row',
        flex: 1,
    },
    sideContainer: {
        flex: 1,
    },
    balanceBox: {
        width: 121,
        height: 94,
        margin: 20,
        marginBottom: 10,
        marginTop: 30,
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateY: -10 }],
    },
    balanceLabel: {
        fontSize: 17,
        color: colors.usdt.light,
    },
    balanceAmount: {
        fontSize: 17,
    },
    balanceSub: {
        fontSize: 12,
        color: colors.gray.light,
        marginTop: 2,
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
    // The two action buttons differ only in their vertical offset: Receive
    // aligns with the balance box, Send sits a button-gap below it. Held here
    // rather than inline so the lint rule that bans inline styles stays clean.
    receiveButton: {
        marginTop: 30,
    },
    sendButton: {
        marginTop: 10,
    },
    actionGradientMain: {
        borderRadius: 25,
        height: 33,
        width: 121,
        justifyContent: 'center',
    },

    // Locked state, mirroring ArkWallet's createView.
    lockedCard: {
        marginTop: 20,
        borderRadius: 25,
        width: widths - 40,
        height: 128,
        backgroundColor: colors.primary,
        padding: 15,
        paddingStart: 20,
        paddingEnd: 10,
        borderWidth: 1.5,
        borderColor: colors.usdt.light,
        alignSelf: "center",
        justifyContent: "center",
        shadowColor: colors.usdt.shadowTopNew,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 4,
        shadowOpacity: 0.4,
    },
    lockedMiddle: {
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
    },
    lockedArrow: {
        width: 50,
        height: 50,
        left: -5,
        top: 10,
        tintColor: colors.usdt.light,
    },
    lockedTitle: {
        ...shadow.text25,
        color: colors.usdt.light,
    },
    lockedFooter: {
        flexDirection: "column",
        marginTop: 10,
        alignSelf: "center",
    },
    lockedSubtitle: {
        fontSize: 16,
        textAlign: "center",
        color: colors.whiteText,
    },
    lockedHint: {
        fontSize: 14,
        color: colors.usdt.light,
        textAlign: "center",
        marginTop: 4,
    },
});

export default styles;
