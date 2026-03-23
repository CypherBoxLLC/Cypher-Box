import { colors, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    container: ViewStyle;
    main: ViewStyle;
    value: TextStyle;
    tab: ViewStyle;
    progressbar: ImageStyle;
    coin: TextStyle;
    size: TextStyle;
    label: TextStyle;
    select: TextStyle;
    checkbox: ViewStyle;
    borderview: ViewStyle;
}
export default StyleSheet.create<Style>({
    container: {
        height: 85,
        flexDirection: 'row',
        marginHorizontal: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    main: {
        width: widths,
        height: 100,
        marginStart: 5,
        marginVertical: 5
    },
    value: {
        fontSize: 18,
        marginBottom: 5,
        marginTop: 5,
    },
    tab: {
        width: '46%',
        height: 14,
        borderRadius: 4.5,
        borderWidth: 1,
        borderColor: colors.white,
        justifyContent: 'center',
        alignContent: 'center',
        alignItems: 'center',
        marginEnd: 10,
        marginStart: 10,
        marginBottom: 10,
        marginTop: 5,
        paddingHorizontal: 2
    },
    progressbar: {
        //height: 6,
        width: '99%',
        marginHorizontal: 0,
        justifyContent: 'center',
        alignSelf: 'center'
        
    },
    coin: {
        flex: 2.2,
        alignItems: 'center',
    },
    size: {
        flex: 1.8,
    },
    label: {
        flex: 1,
        alignItems: 'center',
    },
    select: {
        flex: 1,
        alignItems: 'center',
        width: 40,
        height: 40,
        alignSelf: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    checkbox: {
        width: 18,
        height: 19,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.white,
        alignItems: 'center',
        justifyContent: 'center',
    },
    borderview: {
        borderWidth: 1.6,
        borderColor: colors.green,
        borderRadius: 25,
        width: '95%',
        height: '95%',
        top: -5,
        start: 5,
        position: 'absolute',
    },
})