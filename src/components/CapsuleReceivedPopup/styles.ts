import { I18nManager, StyleSheet } from 'react-native';
import { colors } from '@Cypher/style-guide';

export default StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 10000,
        elevation: 10000,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.shadow75,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    card: {
        width: '100%',
        maxWidth: 420,
        alignSelf: 'center',
        backgroundColor: colors.gray.dark,
        borderRadius: 20,
        borderWidth: 1,
        padding: 20,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
        elevation: 12,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    shield: {
        width: 30,
        height: 30,
        marginEnd: 12,
    },
    headerText: {
        flex: 1,
    },
    // the Text component's default lineHeight is 18, so larger text sets its own
    title: {
        fontSize: 20,
        lineHeight: 26,
        color: colors.white,
    },
    vault: {
        fontSize: 14,
        lineHeight: 20,
        marginTop: 2,
    },
    count: {
        fontSize: 13,
        color: colors.gray.light,
        marginStart: 10,
    },
    capsuleRow: {
        alignItems: 'center',
        marginTop: 22,
        marginBottom: 20,
    },
    // VaultCapsules draws the slot exactly as on the vault card; its own style
    // keeps a 10pt end margin, which the start padding balances.
    capsuleSlot: {
        flexDirection: 'row',
        width: 110,
        paddingStart: 10,
    },
    amount: {
        fontSize: 24,
        lineHeight: 32,
        color: colors.white,
        marginTop: 10,
    },
    input: {
        height: 46,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.gray.disable,
        backgroundColor: colors.primary,
        color: colors.white,
        fontSize: 16,
        fontFamily: 'Lato-Regular',
        paddingHorizontal: 14,
        // isRTL only changes after a restart, so it can be read once here
        textAlign: I18nManager.isRTL ? 'right' : 'left',
    },
    presets: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 12,
        marginBottom: 20,
    },
    chip: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.gray.default,
        paddingHorizontal: 14,
        paddingVertical: 7,
        marginEnd: 8,
        marginBottom: 8,
    },
    chipText: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.white,
    },
    chipTextSelected: {
        color: colors.primary,
    },
    secondaryRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 6,
    },
    secondaryButton: {
        paddingVertical: 10,
        paddingHorizontal: 16,
    },
    secondaryText: {
        fontSize: 16,
        lineHeight: 22,
        color: colors.gray.light,
    },
});
