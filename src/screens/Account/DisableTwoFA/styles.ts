import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    warningText: TextStyle;
    description: TextStyle;
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
    warningText: {
        color: colors.pink.light,
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 10,
    },
    description: {
        color: colors.gray.thin2,
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 20,
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
