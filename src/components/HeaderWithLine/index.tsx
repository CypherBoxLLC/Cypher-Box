// components/HeaderWithLine.tsx
import React from "react";
import { View, Text } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { GradientText } from "@Cypher/components";
import styles from "./styles";

type HeaderWithLineProps = {
  title: string;
  colors?: string[];
  /** When set, the title renders as plain Text in this color instead
   *  of the default GradientText. Use for screens that want a flat
   *  hierarchy (e.g. white "Add a Lightning Wallet"). */
  titleColor?: string;
};

export default function HeaderWithLine({
  title,
  colors = ["#333333", "rgba(48, 48, 51, 0.6)"],
  titleColor,
}: HeaderWithLineProps) {
  return (
    <View style={styles.container}>
      {titleColor ? (
        <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
      ) : (
        <GradientText style={styles.title}>{title}</GradientText>
      )}
      <LinearGradient colors={colors} style={styles.line} />
    </View>
  );
}
