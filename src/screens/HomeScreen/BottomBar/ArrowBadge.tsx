import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';

/** The badge's width and height, and how far in from its end of the button it sits. */
export const ARROW_BADGE_SIZE = 35;
export const ARROW_BADGE_INSET = 6;

const SIZE = ARROW_BADGE_SIZE;
const C = SIZE / 2;

/**
 * The arrow of the Top-up and Withdraw buttons: a solid arrow in a round well
 * carved into one end of the button, up for Top-up and down for Withdraw.
 *
 * `side` is the end of the button it sits at. Like the row's other left/right
 * styles, it acts as start/end in Arabic, so the badge follows the reading
 * order there (see TopUpWithdrawView).
 */
export default function ArrowBadge({ direction, side }: { direction: 'up' | 'down'; side: 'left' | 'right' }) {
  // A triangle's visual centre sits below its middle, so it is drawn 1pt high.
  const points =
    direction === 'up'
      ? `${C},${C - 7.25} ${C - 7.25},${C + 5.25} ${C + 7.25},${C + 5.25}`
      : `${C},${C + 7.25} ${C - 7.25},${C - 5.25} ${C + 7.25},${C - 5.25}`;
  return (
    <Svg width={SIZE} height={SIZE} style={[styles.badge, side === 'left' ? styles.left : styles.right]}>
      <Circle cx={C} cy={C} r={C - 1} fill="#151515" stroke="#555555" strokeWidth={1} />
      <Polygon points={points} fill="#FFFFFF" stroke="#FFFFFF" strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // 6pt in from the end and centred on the 47pt button.
  badge: { position: 'absolute', top: 6 },
  left: { left: ARROW_BADGE_INSET },
  right: { right: ARROW_BADGE_INSET },
});
