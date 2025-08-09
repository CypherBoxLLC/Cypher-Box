import { Text } from "@Cypher/component-library";
import { GradientCard } from "@Cypher/components";
import useAuthStore from "@Cypher/stores/authStore";
import { colors } from "@Cypher/style-guide";
import React from "react";
import { TouchableOpacity, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import styles from "../styles";

interface Props {
  isVault: boolean;
  hotStorageClickHandler(): void;
  coldStorageClickHandler(): void;
}

export default function TabBar({ isVault, coldStorageClickHandler, hotStorageClickHandler }: Props) {
  const { vaultTab } = useAuthStore();

  const getButtonStyle = (isActive: boolean, isLeft: boolean) => [
    styles.bottomBtn,
    isLeft && { marginEnd: 7.5, marginStart: 0 },
    isActive && {
      borderWidth: 2,
      borderColor: isLeft ? colors.blueText : colors.greenShadow,
      borderRadius: 25,
    },
  ];

  const getGradientColors = (isActive: boolean) =>
    isActive ? [colors.black.gradientTop, colors.black.gradientBottom] : ["transparent", "transparent"];

  return (
    <View style={[styles.container3, { opacity: 1 }]}>
      <GradientCard
        colors_={[colors.gradientGray, colors.white]}
        style={styles.container2}
        linearStyle={styles.main}
        disabled
      >
        <View style={styles.container4}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={hotStorageClickHandler}
            style={getButtonStyle(!isVault, false)}
          >
            <LinearGradient
              start={{ x: 1, y: 0 }}
              end={{ x: 1, y: 1 }}
              locations={[0.25, 1]}
              colors={getGradientColors(!isVault)}
              style={styles.linearGradientbottom}
            >
              <Text h3 bold style={{ color: colors.redLight }}>
                Hot Storage
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={coldStorageClickHandler}
            style={getButtonStyle(isVault, true)}
          >
            <LinearGradient
              start={{ x: 1, y: 0 }}
              end={{ x: 1, y: 1 }}
              locations={[0.25, 1]}
              colors={getGradientColors(isVault)}
              style={styles.linearGradientbottom}
            >
              <Text h3 bold style={{ color: colors.blueText }}>
                Cold Storage
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </GradientCard>
    </View>
  );
}
