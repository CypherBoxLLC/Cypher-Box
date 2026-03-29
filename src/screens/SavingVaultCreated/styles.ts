import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";
import { View } from "react-native-reanimated/lib/typescript/Animated";

interface Style {
    container: ViewStyle;
    inner: ViewStyle;
    descption: TextStyle;
    title: TextStyle;
    button: ViewStyle;
    btnText: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
    },
    inner: {
        flex: 1,
        marginTop: 40,
    },
    descption: {
        fontFamily: 'Archivo-Regular',
        marginTop: 30,
        marginHorizontal: 30,
        lineHeight: 24,
    },
    title: {
        color: colors.green,
        fontFamily: 'Archivo-SemiBold',
        fontSize: 18,
    },
    button: {
        backgroundColor: colors.green,
        position: 'absolute',
        borderWidth: 0,
        width: '85%',
        alignSelf: 'center',
        bottom: 55,
    },
    btnText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 16,
    }
})
