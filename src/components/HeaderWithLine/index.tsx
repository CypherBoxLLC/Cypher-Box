// components/HeaderWithLine.tsx
import React from "react";
import { View, Text } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { GradientText } from "@Cypher/components";
import styles from "./styles";

type HeaderWithLineProps = {
  title: string;
  colors?: string[];
};

export default function HeaderWithLine({
  title,
  colors = ["#333333", "rgba(48, 48, 51, 0.6)"],
}: HeaderWithLineProps) {
  return (
    <View style={styles.container}>
      <GradientText style={styles.title}>{title}</GradientText>
      <LinearGradient colors={colors} style={styles.line} />
    </View>
  );
}
