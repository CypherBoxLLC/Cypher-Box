// components/CheckingAccount/RegisterPrompt.tsx
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { GradientText } from "@Cypher/components";
import styles from "./styles";

type RegisterPromptProps = {
  text: string;
  actionText: string;
  onPress: () => void;
};

export default function RegisterPrompt({
  text,
  actionText,
  onPress,
}: RegisterPromptProps) {
  return (
    <View style={styles.registerPrompt}>
      <Text style={styles.promptText}>{text}</Text>
      <TouchableOpacity onPress={onPress}>
        <GradientText style={styles.actionText}>{actionText}</GradientText>
      </TouchableOpacity>
    </View>
  );
}
