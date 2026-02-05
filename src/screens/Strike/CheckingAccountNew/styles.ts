import { colors } from "@Cypher/style-guide";
import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";
import { rgbaArrayToRGBAColor, rgbaColor } from "react-native-reanimated/lib/typescript/reanimated2/Colors";

interface Style {
  container: ViewStyle;
  container2: ViewStyle;
  main: ViewStyle;
  flex: ViewStyle;
  settingView: ViewStyle;
  text: TextStyle;
  usernameContainer: ViewStyle;
  usernameCard: ViewStyle;
  usernameCardLinear: ViewStyle;
  usernameInput: TextStyle;
  bankDepositText: TextStyle;
  supportText: TextStyle;
  supportLink: TextStyle;
  strikeImage: ImageStyle;
  reserve: ViewStyle;
  usd: TextStyle;
  linearGradientStroke: ViewStyle;
  linearGradient: ViewStyle;
  linearGradient2: ViewStyle;
  background: ViewStyle;
  background2: ViewStyle;
  priceView: ViewStyle;
  straightLine: ViewStyle;
  row: ViewStyle;
  gradientText: ViewStyle;
  modal: ViewStyle;
  bottomView: ViewStyle;
}

export default StyleSheet.create<Style>({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  container2: {
    flex: 1,
    paddingBottom: 65,
    alignItems: "center",
  },
  main: {
    paddingHorizontal: 50,
    marginTop: 20,
  },
  settingView: {
    flex: 1,
    marginTop: 50,
  },
  text: {
    fontSize: 18,
    marginVertical: 10,
    marginLeft: 10,
  },
  usernameContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
  },
  usernameCard: {
    flex: 1,
    marginHorizontal: 20,
    height: 35,
  },
  usernameCardLinear: {
    height: 34,
  },
  usernameInput: {
    height: 32,
    fontSize: 14,
    fontFamily: "Lato-Bold",
  },
  bankDepositText: {
    fontSize: 18,
    marginTop: 20,
  },
  supportText: {
    marginTop: 10,
  },
  supportLink: {
    color: colors.pink.default,
  },
  strikeImage: {
    width: 160,
    height: 50,
    marginTop: 40,
    alignSelf: "center",
  },
  reserve: {
    flexDirection: "row",
    marginTop: 20,
  },
  usd: {
    fontSize: 18,
  },
  background: {
    backgroundColor: colors.gray.dark,
    flex: 1,
    margin: 2,
    borderRadius: 15,
    paddingHorizontal: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignContent: "center",
  },
  background2: {
    backgroundColor: colors.gray.dark,
    flex: 1,
    margin: 2,
    borderRadius: 25,
    paddingHorizontal: 3,
  },
  linearGradientStroke: {
    height: 67,
    width: "50%",
    marginLeft: 30,
    marginVertical: 20,
    borderRadius: 15,
  },
  linearGradient: {
    height: 67,
    borderRadius: 15,
  },
  linearGradient2: {
    height: 151,
    borderRadius: 25,
  },
  priceView: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
  },
  straightLine: {
    width: 2,
    //backgroundColor: ,
    height: 26,
    marginHorizontal: 15,
  },
  row: {
    backgroundColor: colors.black.default,
    flexDirection: "row",
    height: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  gradientText: {
    textAlign: "center",
    marginTop: 20,
  },
  modal: {
    height: 151,
    width: "70%",
    marginVertical: 20,
    borderRadius: 25,
    alignSelf: "center",
  },
  bottomView: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: "#5E5E5E",
    height: 130,
    justifyContent: "center",
  },
});
