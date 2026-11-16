import React, { ReactNode } from 'react';
import { I18nManager, LayoutChangeEvent, Platform, Text as RNText, StyleProp, StyleSheet, TextStyle } from 'react-native';

import { arabicFont } from '@Cypher/style-guide';
import styles from './styles';

// iOS lines up text with no textAlign by the app's localization, which is English only, so right-to-left paragraphs
// stayed on the left. 'left' is the start edge: right-to-left swaps it to the right on both platforms, as Android
// already did without it. Text with its own textAlign, and text marked left-to-right (addresses, amounts), is left
// as it was.
const startAligned = (style: StyleProp<TextStyle>): TextStyle | null => {
  if (!I18nManager.isRTL) return null;
  const { textAlign, writingDirection } = StyleSheet.flatten(style) ?? {};
  return textAlign || writingDirection === 'ltr' ? null : { textAlign: 'left' };
};

// The warning sign ⚠ (U+26A0) on its own, not the emoji ⚠️ (followed by U+FE0F), which draws as it is.
const WARNING_SIGN = '\u26A0';
const PLAIN_WARNING_SIGN = /(\u26A0(?!\uFE0F))/;

const hasPlainWarningSign = (child: ReactNode): child is string => typeof child === 'string' && PLAIN_WARNING_SIGN.test(child);

// The system font weight closest to an app font family ('Lato-Bold', 'Tajawal-Medium'...) or a fontWeight.
const systemWeight = (fontFamily = '', fontWeight?: TextStyle['fontWeight']): TextStyle['fontWeight'] => {
  if (/semi-?bold/i.test(fontFamily)) return '600';
  if (/bold/i.test(fontFamily)) return '700';
  if (/medium/i.test(fontFamily)) return '500';
  if (/thin|light/i.test(fontFamily)) return '300';
  return fontWeight && fontWeight !== 'normal' ? fontWeight : '400';
};

// Neither app font (Lato, Tajawal) has ⚠, and on iOS no fallback font stood in for it, so every "⚠ ..." string
// started with a boxed "?". The iOS system font has the sign: it is drawn in that font, in the text's own size,
// colour and weight, and the string itself is unchanged. Android already finds a font with it.
const withSystemWarningSign = (children: ReactNode, style: StyleProp<TextStyle>): ReactNode => {
  if (Platform.OS !== 'ios') return children;
  const parts: ReactNode[] = typeof children === 'string' ? [children] : Array.isArray(children) ? React.Children.toArray(children) : [];
  if (!parts.some(hasPlainWarningSign)) return children;
  const { fontFamily, fontWeight } = StyleSheet.flatten(style) ?? {};
  const sign: TextStyle = { fontFamily: 'System', fontWeight: systemWeight(fontFamily, fontWeight) };
  return parts.flatMap<ReactNode>((child, i) =>
    hasPlainWarningSign(child)
      ? child
          .split(PLAIN_WARNING_SIGN)
          .filter(Boolean)
          .map((piece, j) =>
            piece === WARNING_SIGN ? (
              <RNText key={`warning-sign-${i}-${j}`} style={sign}>
                {piece}
              </RNText>
            ) : (
              piece
            ),
          )
      : [child],
  );
};

export interface Props {
  testID?: string;
  children?: ReactNode;
  headline?: boolean;
  h1?: boolean;
  h2?: boolean;
  h3?: boolean;
  h4?: boolean;
  header?: boolean;
  subHeader?: boolean;
  bold?: boolean;
  semibold?: boolean;
  italic?: boolean;
  numberOfLines?: number;
  center?: boolean;
  onPress?(): void;
  white?: boolean;
  blue?: boolean;
  /**
   * Whether RNText should auto-shrink to fit the parent's width when
   * the rendered string would otherwise overflow. Defaults to `false`
   * because under Fabric (RN 0.76 New Arch) the auto-shrink kicks in
   * far more aggressively than it did under Paper, silently rendering
   * text well below its declared fontSize whenever the parent has any
   * tightish flex constraint. We hit five separate visual-regression
   * reports from this between RN 0.72 and 0.76 — the toggle title in
   * ArkCapsules, the DUST badge, the seed-phrase grid in Settings,
   * the Emergency-Exit pointer, and the "Total Assets" home-screen
   * header. The wrapper used to set this `true` unconditionally with
   * no escape; that's now an opt-in, kept for the rare case (e.g. an
   * h1 amount that legitimately needs to scale down on a 4-inch SE).
   *
   * Set to `true` only when the caller has measured the parent and
   * actually wants auto-shrink; otherwise leave undefined.
   */
  adjustsFontSizeToFit?: boolean;
  /**
   * style: only pass in margin or color styles here!!!
   * You should never need to change the size / font etc.
   * This ensures we only use agreed Text styles from the designer.
   * If you need to add another, discuss with designer.
   */
  style?: TextStyle | TextStyle[];
  onLayout?: ((event: LayoutChangeEvent) => void) | undefined;
}

function Text({
  testID,
  children,
  onPress,
  headline = false,
  h1 = false,
  h2 = false,
  h3 = false,
  h4 = false,
  header = false,
  subHeader = false,
  bold = false,
  semibold = false,
  italic = false,
  numberOfLines = 99,
  center = false,
  white = false,
  blue = false,
  adjustsFontSizeToFit = false,
  style,
  onLayout,
}: Props) {
  const composed = [
    styles.default,
    headline && styles.headline,
    h1 && styles.h1,
    h2 && styles.h2,
    h3 && styles.h3,
    h4 && styles.h4,
    header && styles.header,
    subHeader && styles.subHeader,
    bold && styles.bold,
    semibold && styles.semibold,
    italic && styles.italic,
    center && styles.center,
    white && styles.white,
    blue && styles.blue,
    style && style,
  ];
  const textStyle = [...composed, startAligned(composed), arabicFont(composed)];
  return (
    <RNText
      textBreakStrategy="simple"
      testID={`text${children?.toString()}`}
      accessibilityLabel={`text${children?.toString()}`}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      onPress={onPress}
      onLayout={onLayout}
      allowFontScaling={false}
      style={textStyle}
    >
      {withSystemWarningSign(children, textStyle)}
    </RNText>
  );
}

export default Text;
