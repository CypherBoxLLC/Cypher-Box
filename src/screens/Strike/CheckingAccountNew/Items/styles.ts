import { colors, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle; 
    text: TextStyle; 
    inner: ViewStyle; 
    image: ImageStyle; 
    des: TextStyle;
    shadowView: ViewStyle;
    shadowTop: any;
    shadowBottom: any;
    imageView: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        alignSelf: 'flex-end',
        fontSize: 11,
    },
    inner: {
        justifyContent: 'center',
        flex: 1,
        padding: 30,
    },
    image: {
        height: 27,
        width: 25,
        marginTop: 5,
    },
    des: {
        flex: 1,
        paddingStart: 20,
    },
    shadowView: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.80,
        shadowColor: '#040404',
        shadowRadius: 4,
        elevation: 24,
        borderRadius: 25,
        width: widths - 40,
        height: 92,
        marginTop: 15,
        borderColor: "transparent",
        backgroundColor: colors.white,
        alignSelf: "center",
    },
    shadowTop: {
        shadowOffset: { width: 2, height: 2 },
        shadowOpacity: 0.56,
        shadowColor: '#27272C',
        shadowRadius: 2,
        borderRadius: 24,
        width: widths - 40,
        height: 92,
        backgroundColor: colors.primary,
        // padding: 15,
        // paddingHorizontal: 30,
    },
    shadowBottom: {
        shadowOffset: { width: -2, height: -2 },
        shadowOpacity: 0.64,
        shadowColor: '#040404',
        shadowRadius: 2,
        borderRadius: 25,
        width: widths - 40,
        height: 92,
        justifyContent: 'center',
        position: 'absolute',
    },
    imageView:{
        height:35,
        width:35,
        alignItems:'center',
        justifyContent:'center',
    }
});