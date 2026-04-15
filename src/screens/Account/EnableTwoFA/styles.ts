import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    description: TextStyle;
    featureList: ViewStyle;
    featureItem: TextStyle;
    qrContainer: ViewStyle;
    secretLabel: TextStyle;
    secretText: TextStyle;
    textInput: TextStyle;
    extra: ViewStyle;
    space: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 65
    },
    innerView: {
        flex: 1,
        paddingBottom: 40,
        paddingTop: 10,
        paddingHorizontal: 25,
        alignItems: 'center',
    },
    description: {
        color: colors.gray.thin2,
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 22,
    },
    featureList: {
        marginTop: 20,
        width: '100%',
    },
    featureItem: {
        color: colors.white,
        fontSize: 15,
        marginBottom: 12,
        lineHeight: 22,
    },
    qrContainer: {
        backgroundColor: colors.white,
        padding: 20,
        borderRadius: 16,
        marginVertical: 20,
        alignItems: 'center',
    },
    secretLabel: {
        color: colors.gray.thin2,
        fontSize: 12,
        marginBottom: 8,
    },
    secretText: {
        color: colors.pink.default,
        fontSize: 14,
        fontFamily: 'monospace',
        textAlign: 'center',
        letterSpacing: 1,
    },
    textInput: {
        textAlign: 'center',
    },
    extra: {
        height: 15,
    },
    space: {
        height: 30,
    },
})
