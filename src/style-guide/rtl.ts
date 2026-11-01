import { I18nManager, StyleSheet } from 'react-native';

// RTL layout flips margins, padding and text alignment, but not artwork. Arrows
// and chevrons drawn pointing left or right have to be mirrored by hand.
// I18nManager.isRTL only changes after an app restart, so reading it once is enough.
export const mirrorTransform = [{ scaleX: I18nManager.isRTL ? -1 : 1 }];

// A value with no Latin letter (a seed word's "1.", a signed "-$5.00") has nothing
// to set its direction, so Android lays it out right-to-left and reorders it.
// A leading left-to-right mark fixes that on every platform.
export const ltr = (value: string | number) => `\u200E${value}`;

export default StyleSheet.create({
  mirror: { transform: mirrorTransform },
  // Addresses, amounts, txids, keys and seed words are Latin and must read
  // left-to-right even on an RTL screen. writingDirection is honoured on iOS;
  // Android lays these out by their first strong character, which is Latin.
  ltrText: { writingDirection: 'ltr' },
});
