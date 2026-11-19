import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import loc from '../../../loc';
import { CYPHERBOX_LOGO_BODY, CYPHERBOX_LOGO_EYES, CYPHERBOX_LOGO_HEIGHT, CYPHERBOX_LOGO_WIDTH } from './cypherBoxLogo';

/** A white ring around a near-black circle, the same fill as the Top-up and Withdraw arrow badges. */
const RING = '#FFFFFF';
const FILL = '#151515';
const RING_WIDTH = 1.5;

const SIZE = 36;
// The logo is 24 wide, centred in the circle.
const LOGO_SIZE = 24;
const LOGO_SCALE = LOGO_SIZE / CYPHERBOX_LOGO_WIDTH;
const LOGO_PLACE = `translate(${(SIZE - LOGO_SIZE) / 2} ${(SIZE - CYPHERBOX_LOGO_HEIGHT * LOGO_SCALE) / 2}) scale(${LOGO_SCALE})`;

/** The logo with its eyes open (see-through), and with them filled white. */
export const LOGO_EYES_OPEN = `${CYPHERBOX_LOGO_BODY} ${CYPHERBOX_LOGO_EYES}`;
export const LOGO_EYES_SHUT = CYPHERBOX_LOGO_BODY;
/** The black line across the logo while the balances are hidden, in the logo's own units. */
export const HIDDEN_LINE = 'M19 3 L81 72';

interface Props {
    hidden: boolean;
    onPress: () => void;
    testID?: string;
}

/**
 * The round button on the total balance card that shows or hides Home's balances: the white CypherBox logo in a dark
 * circle with a white ring. While the balances show, the logo's eyes are open; while they are hidden, its eyes are
 * filled white and a black line cuts across it.
 */
export default function BalancePrivacyButton({ hidden, onPress, testID = 'home-balance-privacy' }: Props) {
    return (
        <Pressable
            testID={testID}
            onPress={onPress}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? loc.cypherbox.home.show_balances : loc.cypherbox.home.hide_balances}
            style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
        >
            <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
                <Circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={(SIZE - RING_WIDTH) / 2}
                    fill={FILL}
                    stroke={RING}
                    strokeWidth={RING_WIDTH}
                />
                <G transform={LOGO_PLACE}>
                    <Path d={hidden ? LOGO_EYES_SHUT : LOGO_EYES_OPEN} fill="#FFFFFF" fillRule="evenodd" />
                    {hidden && <Path d={HIDDEN_LINE} stroke="#000000" strokeWidth={2.2 / LOGO_SCALE} strokeLinecap="round" />}
                </G>
            </Svg>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    circle: {
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
    },
    pressed: {
        opacity: 0.8,
        transform: [{ scale: 0.92 }],
    },
});
