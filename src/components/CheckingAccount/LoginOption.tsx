// components/CheckingAccount/LoginOption.tsx
import React from "react";
import {
  TouchableOpacity,
  View,
  Image,
  ImageSourcePropType,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "./styles";

type LoginOptionProps = {
  logo: ImageSourcePropType;
  onPress: () => void;
};

export default function LoginOption({ logo, onPress }: LoginOptionProps) {
  return (
    <TouchableOpacity
      style={styles.loginOptionContainer}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={["#FF65D4", "rgba(214, 23, 161, 0.9)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.loginOptionGradient, {padding: 3}}
      >
        <View style={styles.loginOption}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}
