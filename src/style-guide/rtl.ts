import { I18nManager, StyleSheet } from 'react-native';

// RTL layout flips margins, padding and text alignment, but not artwork. Arrows
// and chevrons drawn pointing left or right have to be mirrored by hand.
// I18nManager.isRTL only changes after an app restart, so reading it once is enough.
export const mirrorTransform = [{ scaleX: I18nManager.isRTL ? -1 : 1 }];

// A value with no Latin letter (a seed word's "1.", a signed "-$5.00") has nothing
// to set its direction, so Android lays it out right-to-left and reorders it.
// A leading left-to-right mark fixes that on every platform.
export const ltr = (value: string | number) => `\u200E${value}`;

// An amount with its unit reads right-to-left in Arabic, figure first ("1.43M سات ~ €844.79" shows as
// "€844.79 ~ سات 1.43M"). A K or M in the figure is a Latin letter, which would set the line left-to-right and
// split the figure from its unit, so in right-to-left the line starts with a right-to-left mark. Left-to-right
// languages get the text unchanged.
export const inReadingDirection = (value: string | number) => (I18nManager.isRTL ? `\u200F${value}` : `${value}`);

export default StyleSheet.create({
  mirror: { transform: mirrorTransform },
  // Addresses, amounts, txids, keys and seed words are Latin and must read
  // left-to-right even on an RTL screen. writingDirection is honoured on iOS;
  // Android lays these out by their first strong character, which is Latin.
  ltrText: { writingDirection: 'ltr' },
  // For a plain react-native Text, which the @Cypher Text wrapper would align on
  // its own. iOS lines up text with no textAlign by the app's localization, which
  // is English only, so Arabic stays on the left. 'left' is the start edge: RTL
  // swaps it to the right.
  startText: { textAlign: 'left' },
});
