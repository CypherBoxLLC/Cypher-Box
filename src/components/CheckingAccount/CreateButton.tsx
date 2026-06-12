// Side "Create" CTA paired with a LoginOption in the
// CheckingAccountLogin screen. Same 80pt height and pressable-sheet
// affordance as LoginOption so the two read as a matched row.
import React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@Cypher/component-library";
import styles from "./styles";

type Props = {
  onPress: () => void;
  label?: string;
  /** Override border + text color. Defaults to the pink used for the
   *  custodial Create CTA; pass `colors.ark.light` for the Ark Recover
   *  variant to keep the row colour-coded with the wallet provider. */
  accentColor?: string;
};

export default function CreateButton({ onPress, label = "Create", accentColor }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.createButtonContainer,
        styles.loginOptionContainerRaised,
        pressed && styles.loginOptionContainerPressed,
      ]}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.createButtonGradient,
            accentColor ? { borderColor: accentColor } : null,
            pressed && styles.loginOptionGradientPressed,
          ]}
        >
          <View
            style={[
              styles.createButton,
              pressed && styles.loginOptionPressed,
            ]}
          >
            <Text bold style={[styles.createButtonText, accentColor ? { color: accentColor } : null]}>
              {label}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}
