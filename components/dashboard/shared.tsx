// Cockpit presentation primitives and palette.
//
// Throwaway scaffolding — delete once this work graduates into the app proper.
// Previously also held three competing directions and a canned mock data set;
// both are gone now that Cockpit is chosen and everything reads live.
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Polyline, Rect, Stop } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The states the dashboard hero has to answer for. */
export type PrinterState = 'idle' | 'printing' | 'finished' | 'error';

export interface Palette {
  key: string;
  name: string;
  /** page background */
  bg: string;
  /** default card fill */
  surface: string;
  /** nested / recessed fill */
  surfaceAlt: string;
  border: string;
  text: string;
  dim: string;
  accent: string;
  /**
   * Deeper accent for LARGE filled surfaces. A saturated accent that reads well
   * as 12px text or a 6px ring is glaring across a 52px button fill.
   */
  accentFill: string;
  /** legible foreground on top of an accent fill */
  onAccent: string;
  success: string;
  warn: string;
  danger: string;
  radius: number;
  /** vertical rhythm between major sections */
  gap: number;
}

export const COCKPIT: Palette = {
  key: 'cockpit',
  name: 'Cockpit',
  bg: '#0B0D10',
  surface: '#15181D',
  surfaceAlt: '#1D222A',
  border: '#252A33',
  text: '#F4F7FB',
  dim: '#8B95A1',
  accent: '#00D4C8',
  accentFill: '#00B3A9',
  onAccent: '#00201E',
  success: '#31D583',
  warn: '#FFB020',
  danger: '#FF5A5C',
  radius: 20,
  gap: 16,
};

/**
 * Apply the user's accent at runtime. COCKPIT is imported by reference as `P`
 * throughout the dashboard, so mutating its fields here updates every inline
 * accent read (`color={P.accent}`, `alpha(P.accent, …)`) on the next render.
 *
 * Note: StyleSheet.create values are captured at module load and won't hot-swap,
 * but the dominant accent surfaces on the dashboard are inline, so this covers
 * icons, text, active borders, pills and glows.
 */
export function setAccent(hex: string): void {
  COCKPIT.accent = hex;
  // Filled buttons read fine in the raw accent; the previous per-teal darkening
  // was only there to distinguish a 6px ring from a 52px fill.
  COCKPIT.accentFill = hex;
  // Pick a legible foreground for text sitting on an accent fill. Bright accents
  // (teal, amber, green) need near-black; the rest take white.
  COCKPIT.onAccent = accentLuminance(hex) > 0.55 ? '#06100F' : '#FFFFFF';
}

/** Relative luminance of a #rrggbb hex, per Rec. 709 weights. */
function accentLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean.slice(0, 6).padEnd(6, '0');
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Alpha-blend a #rrggbb hex. */
export function alpha(hex: string, a: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean.slice(0, 6).padEnd(6, '0');
  const byte = Math.max(0, Math.min(255, Math.round(a * 255)))
    .toString(16)
    .padStart(2, '0');
  return `#${full}${byte}`;
}

/**
 * Filled sparkline. Auto-scales to its own min/max with a little headroom so
 * a flat-ish series (a bed holding 60°C) still reads as a line, not a wall.
 */
export function Sparkline({
  data,
  color,
  width,
  height = 34,
  strokeWidth = 2,
  filled = true,
  target,
}: {
  data: number[];
  color: string;
  width: number;
  height?: number;
  strokeWidth?: number;
  filled?: boolean;
  /** Draws a dashed setpoint line. Without it the curve says nothing about
   *  whether the printer is actually holding temperature. */
  target?: number;
}) {
  if (data.length < 2 || width <= 0) return <View style={{ width, height }} />;

  // The target participates in the scale, otherwise a setpoint outside the
  // observed range would be clipped to an edge and read as "at temperature".
  const showTarget = typeof target === 'number' && target > 0;
  const scaleValues = showTarget ? [...data, target] : data;
  const min = Math.min(...scaleValues);
  const max = Math.max(...scaleValues);
  // Flat series would divide by zero; give them a nominal band and centre them.
  const span = max - min || 1;
  const pad = strokeWidth;
  const usable = height - pad * 2;
  const yFor = (v: number) => pad + (1 - (v - min) / span) * usable;

  const points = data.map((v, i) => [(i / (data.length - 1)) * width, yFor(v)] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M ${points[0][0]},${height} ${points
    .map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')} L ${width},${height} Z`;
  const gradId = `spark${color.replace('#', '')}${Math.round(width)}${Math.round(height)}`;

  return (
    <Svg width={width} height={height}>
      {filled ? (
        <>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={color} stopOpacity={0.34} />
              <Stop offset="100%" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill={`url(#${gradId})`} />
        </>
      ) : null}
      {showTarget ? (
        <Polyline
          points={`0,${yFor(target).toFixed(1)} ${width},${yFor(target).toFixed(1)}`}
          fill="none"
          stroke={alpha('#FFFFFF', 0.32)}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}
      <Polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Placeholder for a feed that isn't configured or hasn't loaded. */
export function CameraMock({
  palette,
  height,
  radius,
  children,
  style,
  label = 'LIVE CAMERA',
  icon = 'cctv',
}: {
  palette: Palette;
  height: number;
  radius: number;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  label?: string;
  icon?: IconName;
}) {
  return (
    <View
      style={[
        {
          height,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: '#0A0C10',
          borderWidth: 1,
          borderColor: palette.border,
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`cam${palette.key}`} x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0%" stopColor="#1B2028" />
            <Stop offset="55%" stopColor="#0E1116" />
            <Stop offset="100%" stopColor="#06080B" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#cam${palette.key})`} />
      </Svg>
      <View style={{ alignItems: 'center', gap: 6, opacity: 0.28 }}>
        <MaterialCommunityIcons name={icon} size={30} color={palette.text} />
        <Text style={{ color: palette.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

/**
 * Stand-in for the sliced-model thumbnail, used until the real gcode preview
 * loads (or when a job has none).
 */
export function ThumbMock({
  palette,
  size = 76,
  radius = 14,
  icon = 'cube-outline',
}: {
  palette: Palette;
  size?: number;
  radius?: number;
  icon?: IconName;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: palette.surfaceAlt,
        borderWidth: 1,
        borderColor: palette.border,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <MaterialCommunityIcons name={icon} size={size * 0.42} color={palette.dim} />
    </View>
  );
}

/** Section heading, with an optional trailing action label. */
export function SectionLabel({
  palette,
  children,
  action,
  onAction,
}: {
  palette: Palette;
  children: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={sharedStyles.sectionRow}>
      <Text
        style={{
          color: palette.dim,
          fontSize: 11,
          fontWeight: '800',
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Text>
      {action ? (
        <Text onPress={onAction} style={{ color: palette.accent, fontSize: 12, fontWeight: '800' }}>
          {action}
        </Text>
      ) : null}
    </View>
  );
}

/** Status dot with a soft halo — the "connected"/"printing" tell. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        shadowColor: color,
        shadowOpacity: 0.9,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}

const sharedStyles = StyleSheet.create({
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
