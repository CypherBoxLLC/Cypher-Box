import { colors, widths, shadow } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    container2: ViewStyle;
    innerView: ViewStyle;
    image: ImageStyle;
    title: TextStyle;
    desc: TextStyle;
    view: ViewStyle;
    height: ViewStyle;
    background: ViewStyle;
    extra: ViewStyle;
    loadingOverlay: ViewStyle;
    loadingText: TextStyle;
    errorText: TextStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 65,
    },
    container2: {
        flex: 1,
    },
    innerView: {
        flex: 1,
        paddingBottom: 40,
        paddingHorizontal: 25,
        alignItems: 'center',
    },
    image: {
        width: 40,
        height: 40,
    },
    title: {
        marginStart: 10,
        color: colors.ark.light,
        ...shadow.text25,
    },
    desc: {
        marginTop: 15,
        ...shadow.text25,
    },
    view: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flex: 1,
        margin: 10,
        paddingStart: 10,
        width: widths - 80,
    },
    height: {
        height: 120,
    },
    background: {
        backgroundColor: colors.gray.dark,
        flex: 1,
        margin: 3,
        borderRadius: 17.5,
    },
    extra: {
        height: 16,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    loadingText: {
        marginTop: 14,
        color: colors.white,
        fontSize: 14,
    },
    errorText: {
        color: colors.red,
        fontSize: 13,
        marginTop: 10,
        textAlign: 'center',
    },
});
