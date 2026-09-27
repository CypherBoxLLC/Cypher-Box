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
    arkoorBanner: ViewStyle;
    arkoorBannerTitle: TextStyle;
    arkoorBannerBody: TextStyle;
    aspAttribution: ViewStyle;
    aspAttributionText: TextStyle;
    aspLogo: ImageStyle;
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
    // Amber rather than red: this is a "wait a moment" condition on a normal,
    // working flow, not a failure. Full-width above the amount so it is read
    // before the QR is shared, which is the only moment the advice is useful.
    arkoorBanner: {
        width: '100%',
        backgroundColor: 'rgba(255, 213, 79, 0.12)',
        borderWidth: 1,
        borderColor: '#FFD54F',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 18,
    },
    arkoorBannerTitle: {
        color: '#FFD54F',
        fontSize: 14,
        marginBottom: 4,
    },
    arkoorBannerBody: {
        color: '#EEE',
        fontSize: 12,
        lineHeight: 17,
    },
    aspAttribution: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 18,
    },
    aspAttributionText: {
        color: '#888',
        fontSize: 11,
        marginRight: 8,
    },
    // second.png ships as a multi-color PNG, so it is rendered as-is rather
    // than tinted. Height-constrained with contain so the aspect ratio holds.
    aspLogo: {
        width: 62,
        height: 16,
    },
})
