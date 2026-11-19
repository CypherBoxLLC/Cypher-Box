import { StyleProp, StyleSheet, TextStyle } from 'react-native';

import loc from '../../loc';

// Arabic text renders in Tajawal (SIL OFL, src/assets/licenses/Tajawal-OFL.txt).
// Each Latin family maps to the Tajawal weight closest to it.
const TAJAWAL: Record<string, string> = {
  'Lato-Thin': 'Tajawal-Light',
  'Lato-Regular': 'Tajawal-Regular',
  'Lato-Italic': 'Tajawal-Regular',
  'Lato-Medium': 'Tajawal-Medium',
  'Lato-Semibold': 'Tajawal-Bold',
  'Lato-SemiBold': 'Tajawal-Bold',
  'Lato-Bold': 'Tajawal-Bold',
  'Archivo-Regular': 'Tajawal-Regular',
  'Archivo-Medium': 'Tajawal-Medium',
  'Archivo-SemiBold': 'Tajawal-Bold',
  'Archivo-Bold': 'Tajawal-Bold',
};

const byWeight = (fontWeight: TextStyle['fontWeight']) => {
  if (fontWeight === 'bold' || Number(fontWeight) >= 600) return 'Tajawal-Bold';
  if (Number(fontWeight) === 500) return 'Tajawal-Medium';
  return 'Tajawal-Regular';
};

/**
 * The Tajawal override for a text style when the app language is Arabic, or
 * null otherwise. The family already carries the weight, so fontWeight and
 * fontStyle are reset; Android would otherwise fake bold or italic on top.
 */
export default function arabicFont(style: StyleProp<TextStyle>): TextStyle | null {
  if (loc.getLanguage() !== 'ar') return null;
  const { fontFamily, fontWeight } = StyleSheet.flatten(style) ?? {};
  if (fontFamily === 'monospace') return null;
  return {
    fontFamily: (fontFamily && TAJAWAL[fontFamily]) || byWeight(fontWeight),
    fontWeight: 'normal',
    fontStyle: 'normal',
  };
}
