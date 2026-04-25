import { StyleSheet, TextStyle, ViewStyle } from 'react-native';

import { colors } from '@Cypher/style-guide';

interface Style {
    main: ViewStyle;
    destLabel: TextStyle;
    destInputWrap: ViewStyle;
    destInput: TextStyle;
    pasteBtn: ViewStyle;
    pasteBtnText: TextStyle;
    kindPill: ViewStyle;
    kindPillText: TextStyle;
    feePreviewBox: ViewStyle;
    feeRow: ViewStyle;
    feeLabel: TextStyle;
    feeValue: TextStyle;
    estimateBtn: ViewStyle;
    estimateBtnText: TextStyle;
    confirmBtn: ViewStyle;
    confirmBtnText: TextStyle;
    error: TextStyle;
    footer: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 16,
    },
    destLabel: {
        color: colors.white,
        fontSize: 13,
        marginBottom: 6,
        marginLeft: 4,
    },
    destInputWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        paddingHorizontal: 12,
        minHeight: 50,
        marginBottom: 8,
    },
    destInput: {
        flex: 1,
        color: colors.white,
        fontSize: 14,
        paddingVertical: 10,
    },
    pasteBtn: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.ark.light,
        marginLeft: 8,
    },
    pasteBtnText: {
        color: colors.ark.light,
        fontSize: 12,
        fontFamily: 'Lato-Bold',
    },
    kindPill: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 10,
        borderWidth: 1,
        marginBottom: 16,
        marginLeft: 4,
    },
    kindPillText: {
        fontSize: 11,
        fontFamily: 'Lato-Bold',
    },
    feePreviewBox: {
        backgroundColor: '#111',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2a2a2a',
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginTop: 8,
        marginBottom: 14,
    },
    feeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 4,
    },
    feeLabel: {
        color: colors.gray.light,
        fontSize: 13,
    },
    feeValue: {
        color: colors.white,
        fontSize: 13,
        fontFamily: 'Lato-Bold',
    },
    estimateBtn: {
        backgroundColor: 'transparent',
        borderRadius: 20,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
        borderColor: colors.ark.light,
        marginTop: 6,
    },
    estimateBtnText: {
        color: colors.ark.light,
        fontSize: 14,
        fontFamily: 'Lato-Bold',
    },
    confirmBtn: {
        backgroundColor: colors.ark.light,
        borderRadius: 20,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 10,
    },
    confirmBtnText: {
        color: colors.black.default,
        fontSize: 15,
        fontFamily: 'Lato-Bold',
    },
    error: {
        color: '#FF7A68',
        fontSize: 13,
        marginTop: 8,
        marginHorizontal: 4,
    },
    footer: {
        paddingBottom: 20,
    },
});
