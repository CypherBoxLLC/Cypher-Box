import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    code: ViewStyle;
    container: ViewStyle;
    innerView: ViewStyle;
    image: ImageStyle;
    maintitle: TextStyle;
    imageView: ImageStyle;
    usd: TextStyle;
    homeButton: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
    },
    innerView: {
        flex: 1,
        paddingBottom: 40,
        paddingTop: 20,
        paddingHorizontal: 25,
        alignItems: 'center',
    },
    image: {
        width: 248,
        height: 249,
        marginTop: 20,
    },
    maintitle: {
        // marginTop: 20,
        marginHorizontal: 30,
    },
    imageView: {
        flexDirection: 'row',
        width: '95%',
        justifyContent: 'space-evenly',
        marginTop: 15,
        marginBottom: 10,
    },
    code: {
        fontSize: 18,
        lineHeight: 26,
        marginVertical: 10,
    },
    usd: {
        fontSize: 25,
        lineHeight: 34,
        marginTop: 20,
    },
    homeButton: {
        width: '90%',
        marginTop: 24,
    },
})
