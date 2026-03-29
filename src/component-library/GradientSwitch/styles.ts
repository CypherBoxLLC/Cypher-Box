import { StyleSheet, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    knob: ViewStyle;
    containerOff: ViewStyle;
    containerOn: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        width: 50,
        height: 24,
        borderRadius: 20,
        padding: 4,
        justifyContent: 'center',
    },
    knob: {
        width: 17,
        height: 17,
        backgroundColor: 'white',
        borderRadius: 15,
    },
    containerOff: {
        backgroundColor: '#ccc',
    },
    containerOn: {
        backgroundColor: 'transparent',
    },
});