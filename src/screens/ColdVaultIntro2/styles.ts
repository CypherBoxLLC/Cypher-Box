import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";
import { View } from "react-native-reanimated/lib/typescript/Animated";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    descption: TextStyle;
    guideText: TextStyle;
    title: TextStyle;
    button: ViewStyle;
    btnText: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingBottom: 65,
    },
    innerView: {
        flex: 1,
        paddingBottom: 40,
        paddingTop: 10,
        paddingHorizontal: 25,
        alignItems: 'center',
    },
    descption: {
        fontFamily: 'Archivo-Regular',
        marginVertical: 30,
        color: colors.white,
        lineHeight: 24,
    },
    guideText: {
        fontFamily: 'Archivo-Regular',
        fontSize: 14,
        color: colors.white,
    },
    title: {
        color: colors.coldGreen,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 18,
    },
    button: {
        backgroundColor: colors.coldGreen,
        borderWidth: 0,
        marginHorizontal: 20,
    },
    btnText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 16,
    },
})
