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
        marginTop: 20,
    },
    descption: {
        fontFamily: 'Archivo-Regular',
        marginTop: 60,
        marginHorizontal: 10,
        lineHeight: 22,
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
        width: '70%',
        alignSelf: 'center',
        bottom: 40,
    },
    btnText: {
        fontFamily: 'Archivo-Bold',
        color: colors.white,
        fontSize: 16,
    }
})
