import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    header: TextStyle;
    line: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flexDirection: 'row',
        flex: 1,
        alignItems: 'center',
        alignSelf: 'center',
        marginTop: 10,
    },
    header: {
        marginHorizontal: 40,
    },
    line: {
        height: 1,
        width: '15%',
        backgroundColor: colors.white,
    },
});
