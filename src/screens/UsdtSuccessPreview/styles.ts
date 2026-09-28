import { colors } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

/** Development only, alongside the screen it belongs to. Delete both together. */
export default StyleSheet.create({
    switcher: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginHorizontal: 16,
        marginBottom: 8,
    },
    tab: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginHorizontal: 4,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.gray.disable,
    },
    tabActive: {
        borderColor: colors.usdt.light,
    },
    tabLabel: {
        fontSize: 12,
        lineHeight: 16,
        color: colors.gray.light,
    },
    tabLabelActive: {
        color: colors.usdt.light,
    },
    label: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.gray.light,
        textAlign: 'center',
    },
    value: {
        fontSize: 13,
        lineHeight: 18,
        color: colors.white,
        textAlign: 'center',
        marginTop: 2,
        marginHorizontal: 20,
    },
});
