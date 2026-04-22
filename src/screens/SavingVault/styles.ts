import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";
import { View } from "react-native-reanimated/lib/typescript/Animated";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    descption: TextStyle;
    title: TextStyle;
    button: ViewStyle;
    btnText: ViewStyle;
    keychainRow: ViewStyle;
    keychainTextWrap: ViewStyle;
    keychainLabel: TextStyle;
    keychainSub: TextStyle;
    keychainStatusOk: TextStyle;
    keychainStatusErr: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 65,
        // Explicit background so the screen renders as dark-grey the moment
        // React Navigation mounts it — NOT black. Without this, iOS briefly
        // shows the default black card background during the transition +
        // BlurView native-mount window, which reads as a "lag flash" to the
        // user. ScreenLayout itself sets this on its outer LinearGradient
        // but ours is a flex:1 child so we paint an opaque layer ourselves.
        backgroundColor: colors.primary,
    },
    innerView: {
        flex: 1,
        paddingBottom: 40,
        paddingTop: 10,
        paddingHorizontal: 25,
        alignItems: 'center',
    },
    descption: {
        fontFamily: 'Archivo-SemiBold',
        marginVertical: 30,
        color: colors.white,
        lineHeight: 24,
    },
    title: {
        color: colors.green,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 18,
    },
    button: {
        backgroundColor: colors.green,
        borderWidth: 0,
    },
    btnText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 16,
    },
    keychainRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 18,
        marginHorizontal: 20,
        marginTop: 12,
        marginBottom: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    keychainTextWrap: {
        flex: 1,
        paddingRight: 12,
    },
    keychainLabel: {
        color: colors.white,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 14,
    },
    keychainSub: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontFamily: 'Archivo-Regular',
        fontSize: 12,
        lineHeight: 16,
        marginTop: 2,
    },
    keychainStatusOk: {
        color: colors.green,
        fontFamily: 'Archivo-Regular',
        fontSize: 12,
        marginHorizontal: 20,
        marginTop: 4,
    },
    keychainStatusErr: {
        color: colors.red,
        fontFamily: 'Archivo-Regular',
        fontSize: 12,
        marginHorizontal: 20,
        marginTop: 4,
    },
})
