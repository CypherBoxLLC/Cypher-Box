import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { colors } from '@Cypher/style-guide';

interface Style {
    main: ViewStyle;
    valueView: ViewStyle;
    kindIcon: ImageStyle;
    sats: TextStyle;
    description: TextStyle;
    button: ViewStyle;
    buttonText: TextStyle;
    debugFooter: ViewStyle;
    debugText: TextStyle;
}

// Styles intentionally mirror src/screens/Invoice/styles.ts — same paddings,
// same amount font size — so jumping between the Strike/CoinOS details screen
// and the Ark details screen feels continuous. Only additions are the
// kind-icon above the amount, the single-line description, and the muted
// debug footer (which the Strike screen doesn't need because its payload is
// strongly typed server-side).
export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 25,
    },
    valueView: {
        alignSelf: 'center',
        alignItems: 'center',
        marginTop: 10,
        marginBottom: 30,
    },
    kindIcon: {
        width: 34,
        height: 34,
        marginBottom: 10,
    },
    sats: {
        fontSize: 45,
        lineHeight: 60,
    },
    description: {
        marginTop: 6,
        color: colors.gray.light,
        fontSize: 14,
    },
    button: {
        backgroundColor: colors.black.default,
        borderRadius: 20,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: colors.gray.light,
        marginTop: 20,
        marginHorizontal: 5,
    },
    buttonText: {
        fontSize: 18,
    },
    debugFooter: {
        marginTop: 30,
        alignItems: 'center',
        opacity: 0.6,
    },
    debugText: {
        fontSize: 11,
        color: colors.gray.light,
        fontStyle: 'italic',
    },
});
