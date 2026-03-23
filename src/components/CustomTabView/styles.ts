import { StyleSheet } from "react-native";

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
    firstTab: {
        borderBottomLeftRadius: 25,
        borderTopLeftRadius: 25,
    },
    lastTab: {
        borderBottomRightRadius: 25,
        borderTopRightRadius: 25,
    },
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
