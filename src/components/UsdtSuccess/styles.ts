import { StyleSheet } from 'react-native';

/**
 * Built from LightningSendSuccess's sheet, which is the treatment Bam picked,
 * with three differences:
 *
 *   - the title is tinted by the caller, so the asset that arrived is what the
 *     screen reads as, green for USDT and orange for bitcoin;
 *   - `value` is a little smaller, because a USDT figure carries decimals and a
 *     sats figure carries thousands separators, and both are longer than the
 *     "1,234 sats" that sheet was sized for;
 *   - `note` exists at all. That is the caveat line an on-chain payout needs
 *     and the Lightning view has nowhere to put.
 *
 * Every text style sets its own lineHeight: the shared Text's base is 18pt,
 * which clips the tops of anything set larger.
 */
export default StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        marginHorizontal: 20,
    },
    title: {
        fontSize: 34,
        lineHeight: 44,
        marginBottom: 24,
        textAlign: 'center',
    },
    value: {
        fontSize: 38,
        lineHeight: 48,
        textAlign: 'center',
    },
    secondary: {
        fontSize: 26,
        lineHeight: 34,
        color: '#AAAAAA',
        textAlign: 'center',
    },
    animationContainer: {
        width: 200,
        height: 200,
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 16,
    },
    ring: {
        position: 'absolute',
        width: 150,
        height: 150,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ringImage: {
        width: 150,
        height: 150,
    },
    glyph: {
        width: 78,
        height: 84,
        zIndex: 10,
    },
    detail: {
        alignItems: 'center',
        marginVertical: 16,
    },
    network: {
        fontSize: 20,
        lineHeight: 28,
        color: '#AAAAAA',
        textAlign: 'center',
    },
    /**
     * The "not settled yet" line. Deliberately quiet and directly under the
     * network label, so it reads as part of what just happened rather than as
     * a warning about something going wrong.
     */
    note: {
        marginTop: 10,
        fontSize: 14,
        lineHeight: 20,
        color: '#AAAAAA',
        textAlign: 'center',
        marginHorizontal: 10,
    },
    homeButton: {
        marginTop: 32,
        marginBottom: 10,
        width: '80%',
    },
    homeButtonGradient: {
        borderRadius: 25,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    homeText: {
        fontSize: 18,
        lineHeight: 24,
        color: '#FFFFFF',
    },
});
