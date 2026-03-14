import { Text } from "@Cypher/component-library";
import { GradientCard } from "@Cypher/components";
import { colors } from "@Cypher/style-guide";
import React, { useEffect, useRef, useState } from "react";
import { Animated, LayoutChangeEvent, TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "../styles";

interface Props {
  isVault: boolean;
  scrollProgress?: Animated.Value;
  hotStorageClickHandler(): void;
  coldStorageClickHandler(): void;
}

export default function TabBar({ isVault, scrollProgress, coldStorageClickHandler, hotStorageClickHandler }: Props) {
  const fallbackAnim = useRef(new Animated.Value(isVault ? 1 : 0)).current;
  const [containerWidth, setContainerWidth] = useState(0);

  // Always animate smoothly on tab change via fallback
  useEffect(() => {
    Animated.timing(fallbackAnim, {
      toValue: isVault ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [isVault]);

  const animValue = scrollProgress || fallbackAnim;
  const halfWidth = containerWidth / 2;

  const onContainerLayout = (e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  };

  return (
    <View style={[styles.container3, { opacity: 1 }]}>
      <GradientCard
        colors_={[colors.gradientGray, colors.white]}
        style={styles.container2}
        linearStyle={styles.main}
        disabled
      >
        <View style={styles.container4} onLayout={onContainerLayout}>
          {/* Animated sliding indicator */}
          {containerWidth > 0 && (
            <Animated.View
              style={{
                position: 'absolute',
                top: 2,
                bottom: 2,
                left: 2,
                width: halfWidth - 4,
                borderRadius: 24,
                overflow: 'hidden',
                transform: [{
                  translateX: animValue.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, halfWidth],
                    extrapolate: 'clamp',
                  }),
                }],
              }}
            >
              <LinearGradient
                start={{ x: 1, y: 0 }}
                end={{ x: 1, y: 1 }}
                locations={[0.25, 1]}
                colors={[colors.black.gradientTop, colors.black.gradientBottom]}
                style={{ flex: 1, borderRadius: 24 }}
              />
            </Animated.View>
          )}

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={hotStorageClickHandler}
            style={[styles.bottomBtn, { marginEnd: 7.5, marginStart: 0, zIndex: 1 }]}
          >
            <View style={styles.linearGradientbottom}>
              <Text h3 bold style={{ color: colors.redLight }}>
                Hot Storage
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={coldStorageClickHandler}
            style={[styles.bottomBtn, { marginEnd: 0, marginStart: 7.5, zIndex: 1 }]}
          >
            <View style={styles.linearGradientbottom}>
              <Text h3 bold style={{ color: colors.coldGreen }}>
                Cold Storage
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </GradientCard>
    </View>
  );
}
