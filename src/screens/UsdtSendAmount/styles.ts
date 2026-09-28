import { colors } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

/**
 * The scan row, the one thing this screen has that the swap flow's amount step
 * does not. Everything else comes from that screen's sheet, which this one
 * shares so the two stay identical.
 *
 * It sits in the empty space between the hint and the keypad, which was dead
 * area, and it is a full row rather than an icon because the address is
 * usually what a user has in front of them and hunting for a small glyph is
 * how the scan on the next step went unnoticed.
 */
export const scan = StyleSheet.create({
    button: {
        marginTop: 22,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '92%',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: colors.usdt.light,
    },
    /** Once something is scanned the row states it, so it reads as filled in. */
    buttonFilled: {
        backgroundColor: 'rgba(63, 217, 180, 0.12)',
    },
    icon: {
        width: 18,
        height: 18,
        marginRight: 8,
        tintColor: colors.usdt.light,
    },
    label: {
        flexShrink: 1,
        fontSize: 14,
        lineHeight: 19,
        color: colors.usdt.light,
    },
});
