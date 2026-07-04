import { colors } from "@Cypher/style-guide";
import { StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
    main: ViewStyle;
    header: TextStyle;
    line: ViewStyle;
}

export default StyleSheet.create<Style>({
    main: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        // Solid bg so scrolling transaction rows don't bleed through when
        // the header is sticky (stickySectionHeadersEnabled on the
        // SectionList in ArkHistory). Same primary tone as the screen.
        // Removed flex:1 + alignSelf:center + marginTop — those left
        // a transparent gap above the sticky header where rows showed.
        backgroundColor: colors.primary,
        paddingVertical: 12,
        width: '100%',
        zIndex: 10,
    },
    header: {
        marginHorizontal: 40,
    },
    line: {
        height: 1,
        width: '15%',
        backgroundColor: colors.white,
    },
});
