import React, { ReactNode } from 'react'
import { View, ViewStyle } from 'react-native'
import LinearGradient from 'react-native-linear-gradient'
import styles, { CARD_FRAME_HEIGHT, CARD_FRAME_WIDTH, INNER_INSET } from './styles';

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
    /**
     * Frame width. Defaults to the shared one, which is narrower than the
     * carousel slide that holds it. The USDT card asks for the slide's width.
     */
    width?: number;
}

function LinearBorderView({ colors_ = ['#232336', '#232336', '#232336'], style, height, width, children }: Props) {
    // The inner gradient sits inside the border by a fixed inset on every
    // side, so an overridden frame has to shrink it by the same amount or the
    // border would show through underneath the card. Anything the children
    // are laid out against is that inner size, not the frame.
    const frameHeight = height ?? CARD_FRAME_HEIGHT;
    const frameWidth = width ?? CARD_FRAME_WIDTH;
    const resized = frameHeight !== CARD_FRAME_HEIGHT || frameWidth !== CARD_FRAME_WIDTH;
    const frame = resized ? { height: frameHeight, width: frameWidth } : null;
    const inner = resized ? { height: frameHeight - INNER_INSET, width: frameWidth - INNER_INSET } : null;

    return (
        <LinearGradient
            colors={['#BEBEBE3B', '#FFFFFF52']}
            style={[styles.gradientBorder, frame, style]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
        >
            <View style={[styles.innerContainer, frame && { height: frame.height }]}>
                <LinearGradient
                    colors={colors_}
                    style={[styles.gradientBackground, inner]}
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
