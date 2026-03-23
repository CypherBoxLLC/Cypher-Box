import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    image: ImageStyle;
    title: TextStyle;
    value: TextStyle;
    to: TextStyle;
    accType: TextStyle;
    close: ImageStyle;
    closeContainer: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        alignItems: 'center',
        marginHorizontal: 20,
    },
    image: {
        width: 224,
        height: 224,
    },
    title: {
        fontSize: 40,
        lineHeight: 50,
        // marginTop: 30,
        marginBottom: 60,
    },
    value: {
        fontSize: 42,
        lineHeight: 52,
    },
    to: {
        fontSize: 22,
        lineHeight: 30,
        marginVertical: 40,
    },
    accType: {
        fontSize: 30,
        lineHeight: 40,
        marginTop: 30
    },
    close: {
        width: 19,
        height: 19,
    },
    closeContainer: {
        width: 24,
        height: 24,
        position: 'absolute',
        right: 30,
        zIndex: 1,
    },
})