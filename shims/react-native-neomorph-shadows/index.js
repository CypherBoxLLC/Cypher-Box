/**
 * Shim for react-native-neomorph-shadows
 *
 * The original library depends on @react-native-community/art which uses
 * native ART components (ARTSurfaceView, ARTGroup, ARTShape) that were
 * removed in React Native 0.76. This shim replaces Shadow with a plain
 * View that preserves layout styles (width, height, borderRadius, etc.)
 * but drops the neumorphic inner/outer shadow rendering.
 *
 * All 18+ usages across the app use Shadow with `inner` + `useArt` props.
 * The shadow styles (shadowOffset, shadowColor, shadowRadius) are passed
 * through to the View so iOS native shadows still render where applicable.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';

function Shadow({ inner, useArt, style, children, ...rest }) {
  // Extract shadow and layout props from the flattened style
  const flatStyle = StyleSheet.flatten(style) || {};

  // Keep all style props — iOS will render native outer shadows automatically
  // Inner shadows won't render (no native support) but layout is preserved
  return (
    <View style={flatStyle} {...rest}>
      {children}
    </View>
  );
}

Shadow.defaultProps = {
  inner: false,
  useArt: false,
};

// Stub exports matching the original library's API
const Neomorph = Shadow;
const NeomorphBlur = Shadow;
const ShadowFlex = Shadow;
const NeomorphFlex = Shadow;

export { Shadow, Neomorph, NeomorphBlur, ShadowFlex, NeomorphFlex };
export default Shadow;
