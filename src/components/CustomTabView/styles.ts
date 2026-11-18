import { I18nManager, StyleSheet } from "react-native";

// The outer tabs carry the bar's rounded ends. Right-to-left puts the first tab
// on the right, and corner radii are physical (RTL does not swap them), so each
// end tab takes the corners on the side it sits.
const leftEnd = { borderBottomLeftRadius: 25, borderTopLeftRadius: 25 };
const rightEnd = { borderBottomRightRadius: 25, borderTopRightRadius: 25 };

export default StyleSheet.create({
    tabSelectorContainer: {
        height: 89,
        flexDirection: "row",
        margin: 20,
        borderRadius: 25,
        shadowColor: "#040404",
        shadowOffset: { width: 8, height: 8 },
        shadowOpacity: 0.8,
        shadowRadius: 16,
        elevation: 8,
    },
    tabButton: {
        // flex: 1,
        height: 89,
        alignItems: "center",
        justifyContent: "center",
    },
    firstTab: I18nManager.isRTL ? rightEnd : leftEnd,
    lastTab: I18nManager.isRTL ? leftEnd : rightEnd,
    tabButtonContent: {
        flex: 1,
        width: "100%",
        justifyContent: "center",
        alignItems: "center",
    },
    tabIcon: {
        width: 33,
        height: 33,
        marginBottom: 5,
    },
});
