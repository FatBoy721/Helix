import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, shadow, spacing, withAlpha } from '../../constants/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Card({
  children,
  style,
  padded = true,
  elevated = false,
  accentBorder,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  elevated?: boolean;
  accentBorder?: string; // inline accent tint (respects runtime accent)
}) {
  return (
    <View
      style={[
        styles.card,
        elevated ? shadow.hero : shadow.card,
        padded && { padding: spacing.md },
        accentBorder ? { borderColor: withAlpha(accentBorder, 0.45) } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({
  label,
  color = colors.subtext,
  icon,
  filled,
  style,
}: {
  label: string;
  color?: string;
  icon?: IconName;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.chip,
        filled
          ? { backgroundColor: withAlpha(color, 0.16), borderColor: withAlpha(color, 0.4) }
          : null,
        style,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={13} color={color} /> : null}
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Soft radial accent glow, positioned absolutely by the parent for depth.
let glowSeq = 0;
export function GlowBackdrop({
  color,
  size = 260,
  opacity = 0.5,
  style,
}: {
  color: string;
  size?: number;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const id = useMemo(() => `helixGlow${++glowSeq}`, []);
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.cardAlt,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '800',
    flexShrink: 1,
  },
});
