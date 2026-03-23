import { colors, shadow, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    priceView: ViewStyle;
    keyText: TextStyle;
    qrimage: ImageStyle;
    heigth: ViewStyle;
    main: ViewStyle;
    destination: TextStyle;
    senderText: TextStyle;
    label: TextStyle;
    centerText: TextStyle;
    scannerContainer: ViewStyle;
    scannerFooter: ViewStyle;
    buttonsContainer: ViewStyle;
    btnHeight: ViewStyle;
    linearGradientInside: ViewStyle;
    linearStyle: ViewStyle;
    insideView: ViewStyle;
    deleteButton: ViewStyle;
    deleteIcon: ImageStyle;
    inputStyle: ImageStyle;
    btn: ViewStyle;
}

export default StyleSheet.create<Style>({
    container: {
        flex: 1,
        top: -12
    },
    priceView: {
        justifyContent: 'center',
        marginHorizontal: 20,

        // marginTop: 5,
    },
    keyText: {
        fontSize: 24,
        lineHeight: 32,
        fontFamily: 'Lato-Medium',
    },
    qrimage: {
        width: 30,
        height: 30,
        marginEnd: 10
    },
    centerText: {
        flex: 1,
        fontSize: 18,
        textAlign: 'center',
        color: '#000',
        marginTop: 20,
    },
    scannerContainer: {
        flex: 1,
        justifyContent: 'space-between',
    },
    scannerFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 16,
    },
    heigth: {
        height: 75
    },
    main: {
        width: '70%',
        alignSelf: 'center',
        height: 69,
    },
    destination: {
        width: '64%',
        alignSelf: 'center',
        marginTop: 16,
    },
    senderText: {
        height: 69,
        fontSize: 20,
    },
    label: {
        position: 'absolute',
        alignSelf: 'center',
        zIndex: 1,
        top: 17
    },
    buttonsContainer: {
        flexDirection: 'row',
        width: '100%',
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        columnGap: 10,
        marginTop: 20,
    },
    btnHeight: {
        height: 84
    },
    linearGradientInside: {
        height: 54,
        width: 120,
        borderRadius: 8,
        marginTop: 3,
    },
    linearStyle: {
        height: 54,
        width: 120,
        borderRadius: 8,
    },
    insideView: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.gray.dark,
        margin: 1,
        borderRadius: 8,
    },
    inputStyle: {
        width: '100%',
        height: 69,
    },
    deleteButton: {
        position: 'absolute',
        alignSelf: 'flex-end',
        top: 22,
        right: 10
    },
    deleteIcon: {
        width: 50,
        height: 30,
    },
    btn: {
        // width: 148,
        paddingHorizontal: 12,
        height: 38,
        backgroundColor: colors.pink.default,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
    }

})
