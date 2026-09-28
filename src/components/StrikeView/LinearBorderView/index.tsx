import React, { ReactNode } from 'react'
import { View, ViewStyle } from 'react-native'
import LinearGradient from 'react-native-linear-gradient'
import styles, { CARD_FRAME_HEIGHT, INNER_INSET } from './styles';

interface Props {
    children: ReactNode;
    colors_?: string[];
    style?: ViewStyle;
    /**
     * Frame height, when a card needs more room than the carousel's usual one.
     *
     * Defaults to the shared height every wallet card has used, so a caller
     * that does not ask keeps exactly the frame it had. The USDT card asks,
     * because its converter does not fit the shared one.
     */
    height?: number;
}

function LinearBorderView({ colors_ = ['#232336', '#232336', '#232336'], style, height, children }: Props) {
    // The inner gradient sits inside the border by a fixed inset top and
    // bottom, so a taller frame has to grow it by the same amount or the
    // border would show through underneath the card.
    const frame = height ?? CARD_FRAME_HEIGHT;
    const sized = frame === CARD_FRAME_HEIGHT ? null : { height: frame };
    const sizedBackground = frame === CARD_FRAME_HEIGHT ? null : { height: frame - INNER_INSET };

    return (
        <LinearGradient
            colors={['#BEBEBE3B', '#FFFFFF52']}
            style={[styles.gradientBorder, sized, style]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
        >
            <View style={[styles.innerContainer, sized]}>
                <LinearGradient
                    colors={colors_}
                    style={[styles.gradientBackground, sizedBackground]}
                    start={{ x: 0, y: 1 }}
                    end={{ x: 1, y: 1 }}
                >
                    {children}
                </LinearGradient>
            </View>
        </LinearGradient>
    )
}

export default LinearBorderView
