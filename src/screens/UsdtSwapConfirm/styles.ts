import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    content: ViewStyle;
    center: ViewStyle;
    quiet: TextStyle;
    refusalTitle: TextStyle;
    refusal: TextStyle;
    row: ViewStyle;
    rowLabel: TextStyle;
    rowValue: TextStyle;
    rowValueEmphasis: TextStyle;
    rowNote: TextStyle;
    destinationLabel: TextStyle;
    destinationBox: ViewStyle;
    destinationValue: TextStyle;
    countdown: TextStyle;
    countdownExpired: TextStyle;
    footer: ViewStyle;
    caution: TextStyle;
    button: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 24,
    },
    content: {
        paddingTop: 16,
        paddingBottom: 16,
    },
    center: {
        marginTop: 60,
        alignItems: 'center',
    },
    quiet: {
        marginTop: 14,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: colors.gray.light,
    },
    refusalTitle: {
        fontSize: 20,
        lineHeight: 26,
        color: colors.usdt.light,
    },
    refusal: {
        marginTop: 12,
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
        color: colors.white,
    },
    row: {
        marginTop: 18,
    },
    rowLabel: {
        fontSize: 15,
        lineHeight: 20,
        color: colors.gray.light,
    },
    rowValue: {
        marginTop: 4,
        fontSize: 17,
        lineHeight: 23,
        color: colors.white,
    },
    rowValueEmphasis: {
        fontSize: 22,
        lineHeight: 28,
    },
    rowNote: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
    },
    destinationLabel: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        color: colors.usdt.light,
    },
    destinationBox: {
        marginTop: 8,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderWidth: 1.5,
        borderColor: colors.usdt.light,
        borderRadius: 14,
    },
    destinationValue: {
        fontSize: 12,
        lineHeight: 18,
        fontFamily: 'monospace',
        color: colors.white,
    },
    countdown: {
        marginTop: 24,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        color: colors.usdt.light,
    },
    countdownExpired: {
        color: colors.redLight,
    },
    footer: {
        paddingBottom: 30,
        paddingTop: 8,
    },
    caution: {
        marginHorizontal: 30,
        marginBottom: 12,
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
        color: colors.white,
    },
    button: {
        width: '90%',
        alignSelf: 'center',
        borderRadius: 10,
    },
});

/**
 * The wallet picker on the review screen.
 *
 * Tile geometry matches the buy flow's deposit picker (44pt tall, 14pt radius,
 * 2pt ring) so the two screens read as the same control.
 */
export const picker = StyleSheet.create({
    container: {
        marginTop: 22,
    },
    title: {
        color: '#888',
        fontSize: 11,
        lineHeight: 16,
        letterSpacing: 0.6,
        marginBottom: 8,
        marginLeft: 2,
    },
    row: {
        flexDirection: 'row',
        gap: 8 as any,
    },
    spacer: {
        flex: 1,
    },
    tile: {
        flex: 1,
        height: 44,
        paddingHorizontal: 8,
        borderRadius: 14,
        borderWidth: 2,
        backgroundColor: colors.black.bg,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    tileInner: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tileLabel: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.white,
    },
    logo: {
        width: 60,
        height: 22,
    },
    icon: {
        marginRight: 4,
    },
    iconBolt: {
        width: 12,
        height: 16,
        tintColor: colors.white,
    },
    iconHot: {
        width: 22,
        height: 30,
    },
    iconCold: {
        width: 30,
        height: 22,
    },
});

/** The card-driven review: the two amounts, the fee breakdown, the destination. */
export const review = StyleSheet.create({
    amounts: {
        marginTop: 8,
        paddingVertical: 16,
        paddingHorizontal: 18,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#3A3A4A',
        backgroundColor: colors.black.bg,
    },
    amountLabel: {
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.6,
        color: '#888',
    },
    amountValue: {
        marginTop: 4,
        fontSize: 24,
        lineHeight: 30,
        color: colors.white,
    },
    amountSub: {
        marginTop: 2,
        fontSize: 12,
        lineHeight: 16,
        color: colors.gray.light,
    },
    arrow: {
        marginVertical: 12,
        fontSize: 13,
        lineHeight: 18,
        color: colors.usdt.light,
    },
    rateLine: {
        marginTop: 14,
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
    },
    feeRow: {
        marginTop: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    feeLabel: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
        flexShrink: 1,
        paddingRight: 10,
    },
    feeValue: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.white,
    },
    section: {
        marginTop: 22,
    },
    sectionTitle: {
        color: '#888',
        fontSize: 11,
        lineHeight: 16,
        letterSpacing: 0.6,
        marginBottom: 8,
        marginLeft: 2,
    },
    addressBox: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderWidth: 1.5,
        borderColor: colors.usdt.light,
        borderRadius: 14,
    },
    addressValue: {
        fontSize: 12,
        lineHeight: 18,
        fontFamily: 'monospace',
        color: colors.white,
    },
});
