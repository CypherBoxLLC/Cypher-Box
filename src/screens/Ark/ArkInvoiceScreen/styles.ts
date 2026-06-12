import { StyleSheet, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
    },
});
