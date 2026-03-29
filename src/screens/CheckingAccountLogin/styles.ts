// screens/CheckingAccountLogin/style.ts
import { StyleSheet } from 'react-native';
import colors from '@Cypher/style-guide/colors';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingBottom: 65,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  footerLine: {
    height: 2,
    width: '100%',
    marginBottom: 30,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  lightningIcon: {
    width: 81,
    height: 94,
    tintColor: colors.white,
  },
  line: {
    height: 2,
    width: '100%',
    marginBottom: 20,
    marginTop: 10,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: colors.white,
  },
});

// import { colors } from "@Cypher/style-guide";
// import { ImageStyle, StyleSheet, TextStyle, ViewStyle } from "react-native";

// interface Style {
//     container: ViewStyle;
//     innerView: ViewStyle;
//     descption: TextStyle;
//     title: TextStyle;
//     button: ViewStyle;
//     btnText: ViewStyle;
//     createAccount: ViewStyle;
//     text: TextStyle;
//     login: TextStyle;
// }


// export default StyleSheet.create<Style>({
//     container: {
//         flex: 1,
//         paddingBottom: 65,
//     },
//     innerView: {
//         flex: 1,
//         paddingBottom: 40,
//         paddingTop: 10,
//         paddingHorizontal: 25,
//         alignItems: 'center',
//     },
//     descption: {
//         fontFamily: 'Archivo-SemiBold',
//         color: colors.white,
//         margin: 15,
//         fontSize: 18,
//     },
//     title: {
//         color: colors.pink.light,
//         fontFamily: 'Archivo-SemiBold',
//         fontSize: 18,
//     },
//     createAccount: {
//         flexDirection: 'column',
//         marginTop: 10,
//         alignSelf: 'center'
//     },
//     text: {
//         fontSize: 18,
//         textAlign: 'center'
//     },
//     login: {
//         fontSize: 18,
//         color: colors.pink.light,
//         textAlign: 'center',
//         marginStart: 5,

//     },
//     button: {
//         backgroundColor: colors.pink.light,
//         borderWidth: 0,
//         marginHorizontal: 20,
//     },
//     btnText: {
//         fontFamily: 'Archivo-Bold',
//         color: colors.white,
//         fontSize: 16,
//     },
// })
