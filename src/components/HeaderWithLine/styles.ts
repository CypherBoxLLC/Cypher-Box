// components/HeaderWithLine/styles.ts
import { StyleSheet } from 'react-native';
import colors from '@Cypher/style-guide/colors';

export default StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
  },
  title: {
    color: colors.pink.extralight,
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
  },
  line: {
    height: 2,
    width: '100%',
    marginTop: 20,
  },
});