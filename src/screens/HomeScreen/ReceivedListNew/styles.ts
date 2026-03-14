import { colors, heights, shadow, widths } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
  logoImage: ImageStyle;
  vaultIconImage: ImageStyle;
  coldVaultIconImage: ImageStyle;
  receiveToLabel: TextStyle;
  gradientLine: ViewStyle;
  cardListContainer: ViewStyle;
  cardGradientStyle: ViewStyle;
  cardOuterShadow: ViewStyle;
  cardGradientMainStyle: ViewStyle;
  cardInnerShadow: ViewStyle;
  cardTopShadow: ViewStyle;
  tabSelectorContainer: ViewStyle;
  lightningIconImage: ImageStyle;
  lightningTabButton: ViewStyle;
  tabButtonContent: ViewStyle;
  bitcoinTabButton: ViewStyle;
  addressText: TextStyle;
  addressRow: ViewStyle;
  copyIconImage: ImageStyle;
  invoiceCardContainer: ViewStyle;
  invoiceCardHeight: ViewStyle;
  invoiceCardBackground: ViewStyle;
  invoiceCardContentRow: ViewStyle;
  invoiceCardTextContainer: ViewStyle;
  invoiceCardTitle: TextStyle;
  invoiceCardDescription: TextStyle;
  socketIconContainer: ImageStyle;
  strikeLogoImage: ImageStyle;
  backButtonImage: ImageStyle;
  bottomActionRow: ViewStyle;
  barcodeImage: ImageStyle;
  containerGradientView: ViewStyle;
  lightningTabContent: ViewStyle;
  bitcoinTabContent: ViewStyle;
  bitcoinAddressText: TextStyle;
  liquidTabContent: ViewStyle;
}

export default StyleSheet.create<Style>({
  logoImage: {
    width: 100,
    height: 40,
    alignSelf: "center",
  },
  cardGradientStyle: {
    shadowColor: "#040404",
    shadowOffset: { width: 8, height: 8 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 8,
    height: 67,
    marginTop: 15,
    width: widths - 60,
  },
  cardOuterShadow: {
    shadowColor: "#27272C",
    shadowOffset: { width: -8, height: -8 },
    shadowOpacity: 0.48,
    shadowRadius: 12,
    elevation: 8,
    flex: 1,
  },
  cardGradientMainStyle: {
    borderRadius: 25,
    height: 67,
    justifyContent: "center",
    // width: widths - 40,
    width: widths - 60,
  },
  cardInnerShadow: {
    shadowOffset: { width: -2, height: -2 },
    shadowRadius: 2,
    shadowOpacity: 0.64,
    shadowColor: colors.pink.shadowBottom,
    borderRadius: 25,
    // width: widths - 40,
    width: widths - 60,
    height: 67,
    justifyContent: "center",
    position: "absolute",
  },
  cardTopShadow: {
    shadowOffset: { width: 3, height: 3 },
    shadowColor: colors.pink.shadowTopNew,
    shadowRadius: 2,
    borderRadius: 25,
    // width: widths - 40,
    width: widths - 60,
    height: 67,
    justifyContent: "center",
  },
  vaultIconImage: {
    width: 25,
    height: 39,
    marginEnd: 5,
    marginStart: 5,
  },
  coldVaultIconImage: {
    width: 39,
    height: 29,
    marginEnd: 0,
  },
  receiveToLabel: {
    alignSelf: "center",
    //marginTop: 0,
  },
  gradientLine: {
    width: "100%",
    borderRadius: 30,
    paddingTop: 3,
  },
  cardListContainer: {
    paddingHorizontal: 30,
    marginTop: 20,
  },
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
  lightningIconImage: {
    width: 33,
    height: 33,
    marginBottom: 5,
  },
  lightningTabButton: {
    width: widths / 2 - 20,
    height: 89,
    alignItems: "center",
    justifyContent: "center",
    borderBottomLeftRadius: 25,
    borderTopLeftRadius: 25,
  },
  bitcoinTabButton: {
    width: widths / 2 - 20,
    height: 89,
    alignItems: "center",
    justifyContent: "center",
    borderBottomRightRadius: 25,
    borderTopRightRadius: 25,
  },
  tabButtonContent: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  addressText: {
    // fontSize: 30,
    // lineHeight: 36,
    marginRight: 10,
  },
  addressRow: {
    flexDirection: "row",
    marginHorizontal: 40,
    paddingLeft: 20,
    //paddingRight: 5,
    alignItems: "center",
    alignContent: 'center',
    justifyContent: 'center',
    // backgroundColor: 'green',
    marginTop: 20,
  },
  copyIconImage: {
    width: 37,
    height: 26,
  },
  invoiceCardContainer: {
    height: 86,
    marginTop: 30,
    width: widths - 40,
    marginLeft: 20,
  },
  invoiceCardHeight: {
    height: 105,
    zIndex: 1,
  },
  invoiceCardBackground: {
    backgroundColor: "#1e1e1e",
    flex: 1,
    margin: 1,
    borderRadius: 20,
  },
  invoiceCardContentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flex: 1,
    marginHorizontal: 10,
    paddingStart: 10,
  },
  invoiceCardTextContainer: {
    flex: 1,
    marginEnd: 5,
    marginStart: 10,
    // backgroundColor: 'red',
  },
  invoiceCardTitle: {
    ...shadow.text25,
  },
  invoiceCardDescription: {
    marginBottom: 5,
    ...shadow.text25,
  },
  socketIconContainer: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  strikeLogoImage: {
    width: 161,
    height: 45,
    position: "absolute",
    left: (widths - 191) / 2,
  },
  backButtonImage: {
    width: 30,
    height: 28,
    right: 0,
  },
  bottomActionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 20,
  },
  barcodeImage: {
    width: 52,
    height: 48,
    marginTop: 30,
  },
  containerGradientView: {
    width: widths,
    height: heights / 2 + 20,
    backgroundColor: colors.black.dark,
    borderRadius: 30,
  },
  lightningTabContent: {
    height: 220,
    // backgroundColor: 'red'
  },
  bitcoinTabContent: {
    height: 220,
    padding: 16,
    alignItems: 'center'
  },
  liquidTabContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    height: 220,
    alignItems: 'center'
  },
  bitcoinAddressText: {
    fontSize: 18,
    marginTop: 10,
  },
});
