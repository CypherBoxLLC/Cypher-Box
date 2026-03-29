import { colors, shadow } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    container: ViewStyle;
    image: ImageStyle;
    gifImage: ImageStyle;
    card: ViewStyle;
    notification: ViewStyle;
    text: TextStyle;
    gradient: ViewStyle;
    circle: ViewStyle;
    gradientInner: ViewStyle;
    inner: ViewStyle;
    inside: ViewStyle;
    invoiceButton: ViewStyle;
    sats: ViewStyle;
    extra: ViewStyle;
    ringEffect: ImageStyle;
    imageContainer: ImageStyle;
    ringStyle: ViewStyle;
    strikeLogo: ImageStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flex: 1,
        paddingHorizontal: 30,
        paddingBottom: 30,
        backgroundColor: colors.primary,
    },
    container: {
        flex: 1,
        // backgroundColor: 'green',
    },
    image: {
        width: 91,
        height: 91,
        position:'absolute',
        alignSelf: 'center',
        // backgroundColor: 'green',
        // justifyContent: 'center',
        // position: 'absolute',
        // right: 0,
    },
    gifImage: {
        width: 220,
        height: 220,
        borderRadius: 110,
        position:'absolute',
        alignSelf: 'center',
        backgroundColor: colors.primary,
    },
    ringStyle: {
        width: 220,
        height: 220,
        borderRadius: 110,
    },
    card: {
        width: 300,
        height: 200,
        borderRadius: 10,
        marginVertical: 50,
        shadowColor: '#00000070', // IOS
        shadowOffset: { height: 1, width: 1 }, // IOS
        shadowOpacity: 1, // IOS
        shadowRadius: 2, //IOS
        elevation: 5, // Android
        backgroundColor: 'gainsboro',
    },
    notification: {
        width: 20,
        height: 20,
        borderRadius: 10,
        position: 'absolute',
        top: 10,
        right: 10,
        backgroundColor: 'red',
    },
    text: {
        fontSize: 30,
        lineHeight: 40,
        marginBottom: 50,
    },
    gradient: {
        width: 224,
        height: 224,
        borderRadius: 112,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
    },
    circle: {
        width: 250,
        height: 250,
        borderRadius: 125,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
    },
    gradientInner: {
        width: 170,
        height: 170,
        borderRadius: 85,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inner: {
        // margin: 3,
        width: 210,
        height: 210,
        borderRadius: 112,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inside: {
        // margin: 3,
        width: 154,
        height: 154,
        borderRadius: 112,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    invoiceButton: {
        width: '100%',
        alignSelf: 'center',
        borderRadius: 10,
        marginBottom: 20,
        height: 50,
    },
    sats: {
        fontSize: 45,
        lineHeight: 55,
        marginTop: 20,
    },
    extra: {
        height: 50,
    },
    ringEffect: {
        // flex: 1,
        width: 250,
        height: 250,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        // backgroundColor: 'red',
        alignSelf: "center",
        // paddingTop: 40,
    },
    imageContainer: {
        width: 250,
        height: 250,
        alignItems: "center",
    },
    strikeLogo: {
        width: 140,
        height: 45,
        alignSelf: 'center',
        marginBottom: 50,
    },
})
