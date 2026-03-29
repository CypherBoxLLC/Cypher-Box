import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import LinearGradient from 'react-native-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';

import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedGestureHandler,
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withRepeat,
    withTiming,
    interpolate,
    Extrapolate,
    interpolateColor,
    runOnJS,
} from 'react-native-reanimated';
import { useState } from 'react';
import { widths } from '@Cypher/style-guide';
import GradientCard from '../GradientCard';

const BUTTON_WIDTH = widths - 40;
const BUTTON_HEIGHT = 48;
const BUTTON_PADDING = 2;
const SWIPEABLE_DIMENSIONS = BUTTON_HEIGHT - 2 * BUTTON_PADDING;
console.log("🚀 ~ SWIPEABLE_DIMENSIONS:", SWIPEABLE_DIMENSIONS)

const H_WAVE_RANGE = SWIPEABLE_DIMENSIONS + 2 * BUTTON_PADDING;
const H_SWIPE_RANGE = BUTTON_WIDTH - 2 * BUTTON_PADDING - SWIPEABLE_DIMENSIONS;
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

const ShimmerText = ({ text, shimmer }: { text: string; shimmer: Animated.SharedValue<number> }) => {
    const shimmerStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    translateX: interpolate(
                        shimmer.value,
                        [0, 1],
                        [-BUTTON_WIDTH, BUTTON_WIDTH],
                    ),
                },
            ],
        };
    });

    return (
        <MaskedView
            maskElement={
                <Text style={[styles.swipeText, { opacity: 1, backgroundColor: 'transparent' }]}>
                    {text}
                </Text>
            }
        >
            <Text style={[styles.swipeText, { opacity: 0.4 }]}>{text}</Text>
            <Animated.View
                style={[
                    {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                    },
                    shimmerStyle,
                ]}
            >
                <LinearGradient
                    colors={['transparent', '#FFFFFF', 'transparent']}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={{ flex: 1, width: 80 }}
                />
            </Animated.View>
        </MaskedView>
    );
};

const SwipeButton = forwardRef(({ onToggle, isLoading, title = "Slide to Send" }: {title: string, onToggle: Function, isLoading: boolean}, ref) => {
    // Animated value for X translation
    const X = useSharedValue(0);
    // Shimmer animation
    const shimmer = useSharedValue(0);
    // Toggled State
    const [toggled, setToggled] = useState(false);

    useImperativeHandle(ref, () => ({
        reset() {
            X.value = withSpring(0);
            setToggled(false);
        }
    }));

    // Start shimmer loop
    useEffect(() => {
        shimmer.value = withRepeat(
            withTiming(1, { duration: 2000 }),
            -1,
            false,
        );
    }, []);

    useEffect(() => {
        if (!isLoading && toggled) {
            // Reset the button when isLoading is false and it is toggled
            setTimeout(() => {
                X.value = withSpring(0);
                setToggled(false);
            }, 3000)
        }
    }, [isLoading, toggled]);

    // Fires when animation ends
    const handleComplete = (isToggled) => {
        if (isToggled !== toggled) {
            setToggled(isToggled);
            onToggle(isToggled);
        }
    };

    // Gesture Handler Events
    const animatedGestureHandler = useAnimatedGestureHandler({
        onStart: (_, ctx) => {
            ctx.completed = toggled;
        },
        onActive: (e, ctx) => {
            let newValue;
            if (ctx.completed) {
                newValue = H_SWIPE_RANGE + e.translationX;
            } else {
                newValue = e.translationX;
            }

            if (newValue >= 0 && newValue <= H_SWIPE_RANGE) {
                X.value = newValue;
            }
        },
        onEnd: () => {
            if (X.value < BUTTON_WIDTH / 2 - SWIPEABLE_DIMENSIONS / 2) {
                X.value = withSpring(0);
                runOnJS(handleComplete)(false);
            } else {
                X.value = withSpring(H_SWIPE_RANGE);
                runOnJS(handleComplete)(true);
            }
        },
    });

    const InterpolateXInput = [0, H_SWIPE_RANGE];
    const AnimatedStyles = {
        swipeCont: useAnimatedStyle(() => {
            return {};
        }),
        colorWave: useAnimatedStyle(() => {
            return {
                width: H_WAVE_RANGE + X.value,

                opacity: interpolate(X.value, InterpolateXInput, [0, 1]),
            };
        }),
        swipeable: useAnimatedStyle(() => {
            return {
                backgroundColor: interpolateColor(
                    X.value,
                    [0, BUTTON_WIDTH - SWIPEABLE_DIMENSIONS - BUTTON_PADDING],
                    ['#F4F4F4', '#F4F4F4'],
                ),
                transform: [{ translateX: X.value }],
            };
        }),
        swipeText: useAnimatedStyle(() => {
            return {
                opacity: interpolate(
                    X.value,
                    InterpolateXInput,
                    [0.7, 0],
                    Extrapolate.CLAMP,
                ),
                transform: [
                    {
                        translateX: interpolate(
                            X.value,
                            InterpolateXInput,
                            [0, BUTTON_WIDTH / 2 - SWIPEABLE_DIMENSIONS],
                            Extrapolate.CLAMP,
                        ),
                    },
                ],
            };
        }),
    };

    return (
        <GradientCard style={styles.bottomView} linearStyle={styles.bottomView}
            colors_={['#3030304D', '#FFFFFF4D']}>
            {/* <Animated.View style={[styles.swipeCont, AnimatedStyles.swipeCont]}> */}
            <AnimatedLinearGradient
                style={[AnimatedStyles.colorWave, styles.colorWave]}
                colors={['#F4F4F4', '#F4F4F4']}
                start={{ x: 0.0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
            />
            <PanGestureHandler onGestureEvent={animatedGestureHandler}>
                <Animated.View style={[styles.swipeable, AnimatedStyles.swipeable]}>
                    <Text style={styles.chevron}>›››</Text>
                </Animated.View>
            </PanGestureHandler>
            {isLoading ?
                <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center'}}>
                    <ActivityIndicator size="small" color="black" />
                    <Text style={[styles.swipeText, {marginLeft: 10}]}>
                        Please wait
                    </Text>
                </View>
            :
                <Animated.View style={[AnimatedStyles.swipeText, { flexDirection: 'row' }]}>
                    <ShimmerText text={title} shimmer={shimmer} />
                </Animated.View>
            }
            {/* </Animated.View> */}
        </GradientCard>
    );
});

const styles = StyleSheet.create({
    swipeCont: {
        height: BUTTON_HEIGHT,
        width: BUTTON_WIDTH,
        backgroundColor: '#fff',
        borderRadius: BUTTON_HEIGHT,
        padding: BUTTON_PADDING,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
    },
    colorWave: {
        position: 'absolute',
        left: 0,
        height: BUTTON_HEIGHT,
        borderRadius: BUTTON_HEIGHT,
    },
    swipeable: {
        position: 'absolute',
        left: BUTTON_PADDING,
        height: SWIPEABLE_DIMENSIONS,
        width: SWIPEABLE_DIMENSIONS,
        borderRadius: SWIPEABLE_DIMENSIONS,
        borderWidth: 3,
        borderColor: '#BDBDBD',
        zIndex: 3,
        shadowColor: '#626976',
        shadowOffset: { width: -2, height: 0 },
        shadowRadius: 4,
        shadowOpacity: 0.15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chevron: {
        fontSize: 18,
        fontWeight: '600',
        color: '#999',
        letterSpacing: -3,
    },
    swipeText: {
        alignSelf: 'center',
        fontSize: 16,
        // fontWeight: 'bold',
        zIndex: 2,
        color: '#000',
    },
    bottomView: {
        height: BUTTON_HEIGHT,
        width: BUTTON_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 24,
    }
});

export default SwipeButton;