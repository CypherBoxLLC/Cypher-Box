import React from "react";
import {
  ButtonProps,
  Image,
  StyleSheet,
  TextStyle,
  TouchableOpacity,
  TouchableOpacityProps,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { colors, shadow } from "@Cypher/style-guide";
import styles from "./styles";
import { Copy } from "@Cypher/assets/images";
import { Text } from "@Cypher/component-library";
import { Shadow } from "react-native-neomorph-shadows";

interface Props extends ButtonProps, TouchableOpacityProps {
  onPress?(): void;
  title: string;
  disabled?: boolean;
  isShadow?: boolean;
  isTextShadow?: boolean;
  isIcon?: boolean;
  isBorder?: boolean;
  textStyle?: TextStyle;
  icon?: number;
  isShadowTopColor?: boolean;
  isShadowBottomColor?: boolean;
}

export default function GradientButtonWithShadow({
  onPress,
  disabled = false,
  title,
  style,
  isShadow,
  isTextShadow,
  isIcon = false,
  isBorder = false,
  textStyle,
  icon = 0,
  isShadowTopColor,
  isShadowBottomColor
}: Props) {
  return (
    <TouchableOpacity
      // `shadow25` sets backgroundColor: white so iOS has an opaque layer
      // to cast the drop shadow from. That white bg antialiases ~1–2px
      // past the LinearGradient child's matching borderRadius, producing
      // a faint white halo at the rounded corners — most visible against
      // the Ark card's darker canvas but present on every tile. Re-assert
      // a dark bg AFTER shadow25 to eliminate the bleed while keeping
      // opacity so the shadow still renders on iOS. `#2D2D2D` sits
      // between the gradient stops (#333333 → #282727) so even if the bg
      // does peek it reads as part of the button.
      style={[
        styles.linearGradient,
        isShadow && shadow.shadow25,
        isShadow && { backgroundColor: '#2D2D2D' },
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <LinearGradient
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        colors={
          disabled
            ? [colors.gray.light, colors.gray.light]
            : ['#333333', '#282727']
        }
        style={[styles.linearGradient, isBorder && styles.border, isIcon && styles.pureview, style]}
      >
        <Shadow
          inner // <- enable inner shadow
          useArt // <- set this prop to use non-native shadow on ios
          style={StyleSheet.flatten([styles.shadow, isShadowTopColor && { shadowColor: '#909090', }])}
        >
          {icon != 0 &&
            <Image
              style={icon == 1 ? styles.arrowLeft : styles.arrowRight}
              resizeMode="contain"
              source={require("../../../img/arrow-right.png")}
            />
          }
          <Text
            bold
            h3
            center
            style={StyleSheet.flatten([
              isTextShadow && shadow.text25,
              textStyle,
              icon != 0 ? icon == 1 ? { marginStart: 20 } : { marginEnd: 20 } : {}
            ])}
          >
            {title}
          </Text>
          {isIcon && <Image source={Copy} resizeMode="contain" />}
          <Shadow
            inner // <- enable inner shadow
            useArt // <- set this prop to use non-native shadow on ios
            style={StyleSheet.flatten([styles.innerShadow, isShadowBottomColor && { shadowColor: '#8A8A8A', shadowOpacity: 0.64, }])} />
        </Shadow>
      </LinearGradient>
    </TouchableOpacity>
  );
}
