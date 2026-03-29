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
    gradientBorder: ViewStyle;
    innerContainer: ViewStyle;
    gradientBackground: ViewStyle;
    selectedtext: TextStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flexDirection: 'row',
        alignSelf: 'center',
        justifyContent: 'space-between',
        // borderWidth: 1,
        width: '95%',
    },
    container: {
        alignItems: 'center',
        marginTop: 20,
    },
    inner: {
        // borderWidth: 1,
        // borderColor: colors.green,
        // borderRadius: 10,
        width: widths / 4 - 35,
        height: widths / 4 - 45,
        marginTop: 10,
        marginHorizontal: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    icon: {
        width: 27,
        height: 26,
        // tintColor: colors.gray.text,
        tintColor: colors.white,
    },
    text: {
        marginTop: 5,
        color: colors.white,
    },
    coinos: {
        width: 50,
        height: 50,
        bottom: -4,
    },
    key: {
        width: 25,
        height: 25,
        tintColor: colors.white,
    },
    gradientBorder: {
        // padding: 2, // Border thickness
        borderRadius: 12,
    },
    innerContainer: {
        borderRadius: 9,
        overflow: 'hidden', // Important to ensure gradient is clipped
    },
    gradientBackground: {
        width: widths / 4 - 38,
        height: widths / 4 - 48,
        // marginTop: 10,
        // marginHorizontal: 15,
        // height: 100,
        // width: 180,
        borderRadius: 10,
        // flex:1,
        // width: widths / 4 - 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    selectedtext:{
        marginTop: 5,
        fontSize: 12,
    }
});
