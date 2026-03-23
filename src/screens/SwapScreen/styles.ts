import { colors } from "@Cypher/style-guide";
import { StyleSheet } from "react-native";

export default StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primary,
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 30,
    },
    sectionTitle: {
        fontSize: 16,
        fontFamily: 'Lato-Bold',
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 16,
        letterSpacing: 2,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 16,
        marginBottom: 30,
    },
    optionButton: {
        flex: 1,
        height: 50,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2A2A2A',
        maxWidth: 160,
    },
    optionButtonSelected: {
        borderWidth: 2,
        borderColor: colors.pink.default,
    },
    logo: {
        height: 24,
        resizeMode: 'contain',
    },
    strikeLogo: {
        width: 100,
    },
    coinosLogo: {
        width: 90,
    },
    divider: {
        height: 1,
        backgroundColor: '#333',
        marginVertical: 10,
    },
    nextButton: {
        width: '90%',
        alignSelf: 'center',
        height: 50,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2A2A2A',
        marginBottom: 40,
    },
    nextButtonActive: {
        backgroundColor: '#333',
    },
    nextText: {
        fontSize: 16,
        fontFamily: 'Lato-Medium',
        color: '#FFFFFF',
    },
    pinkBorder: {
        borderTopWidth: 3,
        borderTopColor: colors.pink.default,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    sheet: {
        backgroundColor: '#1A1A1A',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 24,
        paddingHorizontal: 20,
        paddingBottom: 30,
        flex: 1,
    },
});
