// components/CheckingAccount/LoginOption.tsx
import React from "react";
import {
  Pressable,
  StyleProp,
  View,
  ViewStyle,
  Image,
  ImageSourcePropType,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import Ionicons from "react-native-vector-icons/Ionicons";
import { Text } from "@Cypher/component-library";
import { colors } from "@Cypher/style-guide";
import styles from "./styles";

type LoginOptionProps = {
  logo?: ImageSourcePropType;
  onPress: () => void;
  borderColor?: string;
  /** Optional CTA label rendered to the LEFT of the logo, e.g. "Login to"
   *  for custodial providers or "Create" for wallet-creation flows. */
  label?: string;
  /** Optional color for the CTA label. Defaults to white. */
  labelColor?: string;
  /** Override container styles — used by the screen when laying the
   *  button out inside a side-by-side row with a sibling Create
   *  button. The base style sets a centered 75px width which doesn't
   *  apply in row contexts. */
  containerStyle?: StyleProp<ViewStyle>;
  /** When true, render the logo PNG masked into a solid white shape so
   *  dark-on-transparent assets (e.g. second.tech wordmark) show as
   *  white. tintColor was tested first per the prior MaskedView note in
   *  Card/index.tsx and didn't take on these specific assets. */
  invertLogoToWhite?: boolean;
  /** Small icon rendered to the LEFT of the label. Either a static
   *  image (`iconPrefix`) or an Ionicons name (`iconPrefixIonicon`) —
   *  the Ionicons path lets us reuse the same vector glyph the rest of
   *  the app uses for a given provider (e.g. boat-outline for Ark)
   *  without shipping a duplicate raster asset. `tintColor` / `color`
   *  applied via iconPrefixTint, default white. */
  iconPrefix?: ImageSourcePropType;
  iconPrefixIonicon?: string;
  iconPrefixTint?: string;
  /** When true, lays the label group out on the LEFT and the logo on
   *  the RIGHT (justifyContent: space-between) instead of grouping
   *  them in the center. Used for cards that pair a title-with-icon
   *  with a separate brand wordmark. */
  spread?: boolean;
};

export default function LoginOption({
  logo,
  onPress,
  borderColor = colors.pink.extralight,
  label,
  labelColor = colors.white,
  containerStyle,
  invertLogoToWhite = false,
  iconPrefix,
  iconPrefixIonicon,
  iconPrefixTint = colors.white,
  spread = false,
}: LoginOptionProps) {
  // Pressable's `pressed` callback drives a small scale-down + shadow
  // collapse so the button feels like a raised sheet that depresses
  // under the thumb. Idle state carries an outset shadow + soft inner
  // tint so the affordance reads as "tappable" before any interaction.
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.loginOptionContainer,
        styles.loginOptionContainerRaised,
        containerStyle,
        pressed && styles.loginOptionContainerPressed,
      ]}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.loginOptionGradient,
            { borderColor },
            pressed && styles.loginOptionGradientPressed,
          ]}
        >
          <View
            style={[
              styles.loginOption,
              spread && styles.loginOptionSpread,
              pressed && styles.loginOptionPressed,
            ]}
          >
            {/* Label cluster — when an icon-prefix is set, the icon
                and text sit together as one unit on the left; the
                logo stays on the right (with `spread` enabled). */}
            {(label || iconPrefix || iconPrefixIonicon) ? (
              <View style={styles.labelCluster}>
                {iconPrefixIonicon ? (
                  <Ionicons
                    name={iconPrefixIonicon}
                    size={18}
                    color={iconPrefixTint}
                  />
                ) : iconPrefix ? (
                  <Image
                    source={iconPrefix}
                    style={[styles.labelIcon, { tintColor: iconPrefixTint }]}
                    resizeMode="contain"
                  />
                ) : null}
                {label ? (
                  <Text bold style={[styles.loginOptionLabel, { color: labelColor }]}>
                    {label}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {logo ? (
              invertLogoToWhite ? (
                <MaskedView
                  style={styles.logo}
                  maskElement={
                    <Image source={logo} style={styles.logo} resizeMode="contain" />
                  }
                >
                  <View style={[styles.logo, { backgroundColor: colors.white }]} />
                </MaskedView>
              ) : (
                <Image source={logo} style={styles.logo} resizeMode="contain" />
              )
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}
