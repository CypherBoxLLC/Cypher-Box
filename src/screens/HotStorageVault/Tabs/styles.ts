import { colors, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    container: ViewStyle;
    inner: ViewStyle;
    icon: ImageStyle;
    text: TextStyle;
    coinos: ImageStyle;
    key: ImageStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flexDirection: 'row',
        alignSelf: 'center',
        justifyContent: 'center',
    },
    container: {
        alignItems: 'center',
    },
    inner: {
        // No static outline. The unselected tabs used to carry a 1px green
        // border, which is the "ugly outline" this removes; selection is
        // carried by the fill alone, matching components/Tabs (the Bark vault
        // menu), where the same border was removed. The selected tab sets its
        // own border inline, in its own fill colour, so it never reads as a
        // separate edge. borderRadius stays: the rounded shape is the fill's.
        borderRadius: 10,
        width: widths / 4 - 35,
        height: widths / 4 - 45,
        marginTop: 10,
        marginHorizontal: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    icon: {
        width: 35,
        height: 35,
        tintColor: colors.gray.text,
    },
    text: {
        marginTop: 5,
        color: colors.gray.text,
    },
    coinos: {
        width: 50,
        height: 50,
        bottom: -4,
    },
    key: {
        width: 25,
        height: 25,
    },
});
