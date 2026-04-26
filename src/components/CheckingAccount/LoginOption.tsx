// components/CheckingAccount/LoginOption.tsx
import React from "react";
import {
  TouchableOpacity,
  View,
  Image,
  ImageSourcePropType,
} from "react-native";
import { colors } from "@Cypher/style-guide";
import styles from "./styles";

type LoginOptionProps = {
  logo?: ImageSourcePropType;
  onPress: () => void;
  borderColor?: string;
};

export default function LoginOption({
  logo,
  onPress,
  borderColor = colors.pink.extralight,
}: LoginOptionProps) {
  return (
    <TouchableOpacity
      style={styles.loginOptionContainer}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.loginOptionGradient, { borderColor }]}>
        <View style={styles.loginOption}>
          {logo ? (
            <Image source={logo} style={styles.logo} resizeMode="contain" />
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
