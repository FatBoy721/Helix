import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../../constants/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// SVG ring with an animated sweep. `color` is passed inline by callers so the
// accent setting is respected (accent mutates colors.primary at runtime).
export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 10,
  color,
  trackColor = colors.cardAlt,
  children,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const anim = useRef(new Animated.Value(clamp01(progress))).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamp01(progress),
      duration: 650,
      useNativeDriver: false,
    }).start();
  }, [anim, progress]);

  const strokeDashoffset = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export function ProgressBar({
  progress,
  color,
  trackColor = colors.cardAlt,
  height = 8,
  style,
}: {
  progress: number;
  color: string;
  trackColor?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const anim = useRef(new Animated.Value(clamp01(progress))).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamp01(progress),
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [anim, progress]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View
      style={[
        { height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View
        style={{ height: '100%', width, backgroundColor: color, borderRadius: height / 2 }}
      />
    </View>
  );
}

// tiny arc gauge for temperature chips — a partial ring
export function ArcGauge({
  progress,
  size = 34,
  strokeWidth = 4,
  color,
  trackColor = colors.cardAlt,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  // 270-degree sweep (three quarters) for a gauge look
  const sweep = 0.75;
  const anim = useRef(new Animated.Value(clamp01(progress))).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamp01(progress),
      duration: 550,
      useNativeDriver: false,
    }).start();
  }, [anim, progress]);
  const dash = circumference * sweep;
  const strokeDashoffset = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [dash, 0],
  });
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={trackColor}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(135 ${size / 2} ${size / 2})`}
      />
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${dash} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        transform={`rotate(135 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
