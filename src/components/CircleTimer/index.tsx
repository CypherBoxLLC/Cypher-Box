import React, { useContext } from 'react';
import { Image, ImageSourcePropType, View, StyleSheet } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg';
import Reanimated, { useAnimatedProps } from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { Text } from '@Cypher/component-library';
import styles from './styles';
import { colors } from '@Cypher/style-guide';
import useAuthStore from '@Cypher/stores/authStore';
import { calculateBalancePercentage, calculatePercentage } from '@Cypher/helpers';
import { CarouselPageVisibilityContext, useEasedProgress } from '@Cypher/custom-hooks';

// SVG props aren't animatable on plain components; wrap once at module
// level so the gauge arc can take an animated strokeDashoffset.
const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

type CircleTimerProps = {
  backgroundColor?: string;
  progress?: number; // out of 133
  size?: number;
  strokeWidth?: number;
  value?: string;
  convertedValue?: string;
  image?: ImageSourcePropType;
  type?: string
  /** Raw sat balance for the percentage calc. Prefer this over
   *  re-parsing the formatted `value` string — once the display
   *  switches to K/M (`"5.86K sats"`), the split-parse returns NaN
   *  and the SVG arc renders fully filled. */
  balanceSats?: number;
};

const COLORS = {
  progress: colors.pink.progress,
  background: colors.gray.bg,
};

const ROTATION_DEG = -225;
const MAX_PROGRESS = 133;

const CircleTimer = ({
  size = 100,
  strokeWidth = 10,
  progress = 100,
  value,
  convertedValue,
  image,
  type,
  balanceSats,
}: CircleTimerProps) => {
  const {withdrawStrikeThreshold, withdrawThreshold, reserveAmount, reserveStrikeAmount} = useAuthStore()
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.min(progress, MAX_PROGRESS) / MAX_PROGRESS;
  const strokeDashoffset = circumference * (1 - clampedProgress);

  // Calculate the angle for the progress
  // The arc spans 270 degrees (from -225° to 45°), so we map the progress to this range
  const totalArcAngle = 270; // Total angle of the arc (from -225° to 45°)
  const startAngle = ROTATION_DEG; // Starting angle is -225°
  const progressAngleDeg = startAngle + (clampedProgress * totalArcAngle); // Progress angle in degrees
  const progressAngleRad = progressAngleDeg * (Math.PI / 180); // Convert to radians

  // Calculate the position of the end of the progress arc
  const centerX = size / 2;
  const centerY = size / 2;
  const endX = centerX + radius * Math.cos(progressAngleRad);
  const endY = centerY + radius * Math.sin(progressAngleRad);

  // Size of the square marker
  const markerSize = strokeWidth / 2;

  const thresholdPercentage = type == "STRIKE" ? calculatePercentage(Number(withdrawStrikeThreshold), Number(reserveStrikeAmount)) : calculatePercentage(Number(withdrawThreshold), Number(reserveAmount));

  // Convert to angle along the arc
  const thresholdAngleDeg = ROTATION_DEG + (thresholdPercentage / 100) * totalArcAngle;
  const thresholdAngleRad = thresholdAngleDeg * (Math.PI / 180);

  // Calculate marker coordinates
  const thresholdX = centerX + radius * Math.cos(thresholdAngleRad);
  const thresholdY = centerY + radius * Math.sin(thresholdAngleRad);

  // Prefer the explicit numeric prop; fall back to parsing `value` for
  // legacy callers that haven't been migrated. Anything that produces
  // NaN (e.g. "5.86K sats") would otherwise fill the arc completely.
  const parsedBalance = balanceSats !== undefined
    ? Number(balanceSats)
    : Number(value?.split(' ')[0]);
  const balancePercentage = calculateBalancePercentage(
    Number.isFinite(parsedBalance) ? parsedBalance : 0,
    Number(type == "STRIKE" ? withdrawStrikeThreshold : withdrawThreshold),
    Number(type == "STRIKE" ? reserveStrikeAmount : reserveAmount)
  );


  const clampedBalanceProgress = Math.min(balancePercentage, 100) / 100;

  // Eased gauge fill: balance changes sweep the arc instead of snapping.
  // Plays only while the gauge is actually on screen (screen focused AND
  // the carousel page visible); while unseen it holds, so the sweep
  // replays when the user swipes back to this page. UI-thread via
  // Reanimated — the JS-driver first cut stuttered on low-end Android.
  const pageVisible = useContext(CarouselPageVisibilityContext);
  const focused = useIsFocused();
  const balanceAnim = useEasedProgress(clampedBalanceProgress, pageVisible && focused);
  const animatedArcProps = useAnimatedProps(() => {
    const p = Math.min(Math.max(balanceAnim.value, 0), 1);
    return { strokeDashoffset: 0.75 * circumference * (1 - p) };
  });

  const thresholdMet = balancePercentage >= 100;

  return (
    <View style={[styles.container, { width: size, height: size / 2 + 2, marginTop: -2 }]}>
      <View style={thresholdMet ? {
        shadowColor: '#e84393',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 18,
        elevation: 10,
      } : undefined}>
      <Svg height={size} width={size}>
        <Defs>
          <LinearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor={colors.pink.progress} />
            <Stop offset="100%" stopColor={colors.pink.stop} />
          </LinearGradient>
        </Defs>

        <G rotation={ROTATION_DEG} origin={`${size / 2}, ${size / 2}`}>
          {/* Background Arc */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={COLORS.background}
            strokeWidth={strokeWidth}
            strokeDasharray={0.75 * circumference}
            strokeDashoffset={0}
            strokeLinecap="round"
          />

          {/* Progress Arc with Gradient - clamped to 270° gauge */}
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#progressGradient)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${0.75 * circumference} ${circumference}`}
            animatedProps={animatedArcProps}
            strokeLinecap="round"
          />

          {/* White square marker at the end of the progress arc */}
          <G rotation={-ROTATION_DEG} origin={`${size / 2}, ${size / 2}`}>
            <Circle
              cx={thresholdX}
              cy={thresholdY}
              r={strokeWidth / 2.5}
              fill="white"
            />
          </G>
        </G>
      </Svg>
      </View>

      <View style={styles.textContainer}>
        <Text bold style={styles.mainText}>{value}</Text>
        <Text h3 semibold>{convertedValue}</Text>
      </View>

      {image && (
        <Image
          source={image}
          resizeMode="contain"
          style={styles.image}
        />
      )}
    </View>
  );
};

export default CircleTimer;
