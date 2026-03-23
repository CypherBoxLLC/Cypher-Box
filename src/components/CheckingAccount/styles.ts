// components/CheckingAccount/style.ts
import { StyleSheet } from 'react-native';
import colors from '@Cypher/style-guide/colors';

export default StyleSheet.create({
  loginOptionContainer: {
    marginVertical: 15,
    borderRadius: 20,
    overflow: 'hidden',
  },
  loginOptionGradient: {
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: colors.pink.extralight,
    borderRadius: 20
  },
  loginOption: {
    backgroundColor: '#111111',
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 17,
    padding: 0
  },
  logo: {
    height: 50,
    width: 150,
  },
  registerPrompt: {
    alignItems: 'center',
    marginBottom: 40,
  },
  promptText: {
    color: colors.white,
    fontSize: 16,
    marginBottom: 5,
  },
  actionText: {
    color: colors.pink.extralight,
    fontSize: 16,
    fontWeight: 'bold',
  },
});