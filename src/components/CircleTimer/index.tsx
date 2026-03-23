import React from 'react';
import { Image, ImageSourcePropType, View, StyleSheet } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '@Cypher/component-library';
import styles from './styles';
import { colors } from '@Cypher/style-guide';
import useAuthStore from '@Cypher/stores/authStore';
import { calculateBalancePercentage, calculatePercentage } from '@Cypher/helpers';

type CircleTimerProps = {
  backgroundColor?: string;
  progress?: number; // out of 133
  size?: number;
  strokeWidth?: number;
  value?: string;
  convertedValue?: string;
  image?: ImageSourcePropType;
  type?: string
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

  const balancePercentage = calculateBalancePercentage(
    Number(value?.split(' ')[0]), // or parseFloat(value) if it's string
    Number(type == "STRIKE" ? withdrawStrikeThreshold : withdrawThreshold),
    Number(type == "STRIKE" ? reserveStrikeAmount : reserveAmount)
  );


  const clampedBalanceProgress = Math.min(balancePercentage, 100) / 100;
  const strokeBalanceDashoffset = circumference * (1 - clampedBalanceProgress);

  const thresholdMet = balancePercentage >= 100;

  return (
    <View style={[styles.container, { width: size, height: size / 2 }]}>
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
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#progressGradient)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${0.75 * circumference} ${circumference}`}
            strokeDashoffset={0.75 * circumference * (1 - clampedBalanceProgress)}
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
