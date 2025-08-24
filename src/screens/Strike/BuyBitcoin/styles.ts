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
    fiatBalanceBox2: ViewStyle;
    fiatBalanceBox3: ViewStyle;
    progressBarImage: ImageStyle;
    btc: TextStyle;
    maxBtc: ViewStyle;
    image: ImageStyle;
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
    fiatBalanceBox2: {
        width: 184,
        height: 140,
        margin: 20,
        marginBottom: 10,
        alignSelf: 'center',
        justifyContent: 'center',
        borderRadius: 20,
    },
    fiatBalanceBox3: {
        width: 178,
        height: 136,
        borderRadius: 18,
    },
    progressBarImage: {
        width: 62,
        height: 15
    },
    btc: {
        position: 'absolute',
        alignSelf: 'center',
        bottom: 0,
        end: 40,
        top: 70,
        fontSize: 32,
        lineHeight: 40,
    },
    maxBtc: {
        width:148,
        height:38,
        borderWidth: 1,
        borderColor: '#FFFDFD',
        borderRadius:15,
        alignSelf:'center',
        justifyContent:'center',
        alignItems:'center',
    },
    image:{
        width: 149,
        height: 44,
        marginTop: 20,
        alignSelf: 'center',
    },
})
