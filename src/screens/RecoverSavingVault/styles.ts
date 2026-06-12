import { colors, widths, shadow, heights } from "@Cypher/style-guide";
import { StyleProp, ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    shadowView: StyleProp<ViewStyle>;
    shadowTop: any;
    shadowBottom: any;
    shadowViewBottom: StyleProp<ViewStyle>;
    shadowTopBottom: ViewStyleWithShadow | undefined;
    bottominner: StyleProp<ViewStyle>;
    row: StyleProp<ViewStyle>;
    bitcoinimg: StyleProp<ImageStyle>;
    container: ViewStyle;
    title: ViewStyle;
    linearGradient: ViewStyle;
    createView: ViewStyle;
    bitcointext: TextStyle;
    middle: TextStyle;
    text: TextStyle;
    login: TextStyle;
    alreadyView: ViewStyle;
    inputsContainer: ViewStyle;
    inputStyle: ViewStyle;
    column: ViewStyle;
    labelText: TextStyle;
    textInputStyle: ViewStyle;
    button: ViewStyle;
    btnText: ViewStyle;
    keychainSection: ViewStyle;
    keychainTitle: TextStyle;
    keychainSub: TextStyle;
    keychainButton: ViewStyle;
    keychainButtonText: TextStyle;
    keychainDivider: ViewStyle;
    keychainDividerLine: ViewStyle;
    keychainDividerText: TextStyle;
    keychainRowWrap: ViewStyle;
    keychainRow: ViewStyle;
    keychainRowInfo: ViewStyle;
    keychainRowDate: TextStyle;
    keychainRowId: TextStyle;
    keychainRowCta: TextStyle;
    keychainRowDelete: ViewStyle;
    keychainRowDeleteText: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        backgroundColor: colors.primary,
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    bottominner: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },

    inputsContainer: {
        flexDirection: 'col',
        width: '100%',
        marginVertical: 20
    },
    column: {
        flexDirection: 'column',
        width: '45%',
        justifyContent: 'center',
        alignItems: 'center'
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginVertical: 3,
        flexWrap: 'wrap',
    },
    inputColumn:
    {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between'
    },

    inputStyle: {
        width: 120,
        height: 40,
        borderWidth: 1,
        borderRadius: 30,
        borderColor: '#23C47F',
    },
    labelText: {
        width: 30,
        marginRight: 10,
        textAlign: 'auto',
    },
    textInputStyle: {
        width: '100%',
        height: '100%',
        borderRadius: 30,
        fontSize: 16
    },
    button: {
        width: '100%',
        backgroundColor: colors.green,
        borderWidth: 0,
        marginHorizontal: 40,
        top: heights * 0.32
    },
    btnText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 14,
    },
    keychainSection: {
        width: '100%',
        paddingHorizontal: 4,
        marginTop: 12,
        marginBottom: 4,
    },
    keychainTitle: {
        color: colors.white,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 15,
        marginBottom: 4,
    },
    keychainSub: {
        color: 'rgba(255, 255, 255, 0.7)',
        fontFamily: 'Archivo-Regular',
        fontSize: 12,
        lineHeight: 17,
        marginBottom: 12,
    },
    keychainButton: {
        backgroundColor: colors.green,
        borderRadius: 24,
        paddingVertical: 12,
        paddingHorizontal: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
        minHeight: 44,
    },
    keychainButtonText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 14,
    },
    keychainDivider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 14,
        marginBottom: 4,
    },
    keychainDividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
    keychainDividerText: {
        color: 'rgba(255, 255, 255, 0.5)',
        fontFamily: 'Archivo-Regular',
        fontSize: 11,
        marginHorizontal: 10,
    },
    // Multi-backup picker row. Wrap = row container that stacks the recover
    // target and the remove button side-by-side. The inner `keychainRow` is
    // the big tappable area; `keychainRowDelete` is a smaller neighbour so a
    // mis-aimed tap on the trash doesn't accidentally recover the wrong vault.
    keychainRowWrap: {
        flexDirection: 'row',
        alignItems: 'stretch',
        marginBottom: 8,
    },
    keychainRow: {
        flex: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderWidth: 1,
        borderColor: 'rgba(35, 196, 127, 0.4)',
        borderRadius: 14,
        paddingVertical: 10,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 56,
    },
    keychainRowInfo: {
        flex: 1,
        flexDirection: 'column',
        paddingRight: 8,
    },
    keychainRowDate: {
        color: colors.white,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 13,
        marginBottom: 2,
    },
    keychainRowId: {
        color: 'rgba(255, 255, 255, 0.55)',
        fontFamily: 'Archivo-Regular',
        fontSize: 11,
    },
    keychainRowCta: {
        color: colors.green,
        fontFamily: 'Archivo-Bold',
        fontSize: 13,
    },
    keychainRowDelete: {
        marginLeft: 8,
        paddingHorizontal: 12,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 80, 80, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(255, 80, 80, 0.35)',
    },
    keychainRowDeleteText: {
        color: '#FF7A7A',
        fontFamily: 'Archivo-SemiBold',
        fontSize: 12,
    },
});
