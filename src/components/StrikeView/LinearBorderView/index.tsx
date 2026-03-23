import React, { ReactNode } from 'react'
import { View, ViewStyle } from 'react-native'
import LinearGradient from 'react-native-linear-gradient'
import styles from './styles';

interface Props {
    children: ReactNode;
    colors_?: string[];
    style?: ViewStyle;
}

function LinearBorderView({ colors_ = ['#232336', '#232336', '#232336'], style, children }: Props) {
    return (
        <LinearGradient
            colors={['#BEBEBE3B', '#FFFFFF52']}
            style={[styles.gradientBorder, style]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
        >
            <View style={styles.innerContainer}>
                <LinearGradient
                    colors={colors_}
                    style={styles.gradientBackground}
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
