import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    innerView: ViewStyle;
    image: ImageStyle;
    maintitle: TextStyle;
    title: TextStyle;
    imageView: ViewStyle;
    imageView2: ViewStyle;
    logo: ImageStyle;
    background: ViewStyle;
    code: TextStyle;
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
        fontFamily: 'Lato-Regular',
    },
    title: {
        marginTop: 30,
        paddingHorizontal: 30,
    },
    imageView: {
        flexDirection: 'row',
        width: '70%',
        justifyContent: 'space-between',
    },
    logo: {
        height: 45,
        width: 137,
    },
    background: {
        backgroundColor: colors.primary,
        flex: 1,
        margin: 3,
        borderRadius: 17.5,
        paddingHorizontal: 30,
        justifyContent: 'center',
    },
    // the whole address under the QR, wrapped and centred
    code: {
        fontSize: 16,
        lineHeight: 22,
        marginVertical: 10,
        marginHorizontal: 20,
        textAlign: 'center',
    },
    imageView2: {
        flexDirection: 'row',
        width: '95%',
        justifyContent: 'space-evenly',
        marginTop: 15,
        marginBottom: 10,
    },
})
