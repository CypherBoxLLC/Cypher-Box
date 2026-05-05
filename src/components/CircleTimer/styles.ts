import { Image, StyleSheet, TextStyle, ViewStyle } from "react-native";

interface Style {
  container: ViewStyle
  textContainer: ViewStyle
  mainText: TextStyle
  image: Image
}

export default StyleSheet.create({
  container: {
    alignItems: 'center',
    // justifyContent: 'center',
  },
  textContainer: {
    position: 'absolute',
    alignItems: 'center',
    top: 48,
  },
  mainText: {
    fontSize: 20,
    lineHeight: 26,
    includeFontPadding: false,
  },
  image: {
    width: 68,
    height: 19,
    position: 'absolute',
    bottom: -60,
    alignSelf: 'center',
    zIndex: 1,
  },
});