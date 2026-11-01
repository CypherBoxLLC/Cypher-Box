import { I18nManager, StyleSheet } from 'react-native';

// RTL layout flips margins, padding and text alignment, but not artwork. Arrows
// and chevrons drawn pointing left or right have to be mirrored by hand.
// I18nManager.isRTL only changes after an app restart, so reading it once is enough.
export const mirrorTransform = [{ scaleX: I18nManager.isRTL ? -1 : 1 }];

export default StyleSheet.create({
  mirror: { transform: mirrorTransform },
});
