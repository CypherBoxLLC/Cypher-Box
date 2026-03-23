import { colors } from '@Cypher/style-guide';
import React, { ReactNode } from 'react';
import { ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import styles from './styles';

interface AXIS {
    x: number;
    y: number;
}

interface Props {
    children: ReactNode;
    linearFirstStyle?: ViewStyle;
    linearSecondStyle?: ViewStyle;
    linearFirstColors?: string[];
    linearSecondColors?: string[];
    linearFirstStart?: AXIS;
    linearFirstEnd?: AXIS;
    linearSecondStart?: AXIS;
    linearSecondEnd?: AXIS;
}

function BlackBGView({
    linearFirstColors = [colors.border_.gradient1, colors.border_.gradient2],
    linearSecondColors = [colors.black.default, colors.black.default],
    linearFirstStyle,
    linearSecondStyle,
    linearFirstStart = { x: 1, y: 1 },
    linearFirstEnd = { x: 0, y: 0 },
    linearSecondStart = { x: 0, y: 1 },
    linearSecondEnd = { x: 1, y: 1 },
    children }: Props) {
    return (
        <LinearGradient
            colors={linearFirstColors}
            style={[styles.gradientBorder, linearFirstStyle]}
            start={linearFirstStart}
            end={linearFirstEnd}
        >
            <LinearGradient
                colors={linearSecondColors}
                style={[styles.gradientBackground, linearSecondStyle]}
                start={linearSecondStart}
                end={linearSecondEnd}
            >
                {children}
            </LinearGradient>
        </LinearGradient>
    )
}

export default BlackBGView
