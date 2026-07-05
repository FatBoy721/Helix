import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius } from '../../constants/theme';

// Built with RN's built-in Animated only (no reanimated dep). Transform/opacity
// loops use the native driver; layout (height/width) animations run on JS.

// AnimatedPressable so `style` (flex/width/layout + visual) lands directly on
// the pressable — a plain Animated.View wrapper would swallow flex/% widths and
// collapse the content.
// crabcore
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  children,
  style,
  onPress,
  disabled,
  activeScale = 0.96,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  activeScale?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !disabled && spring(activeScale)}
      onPressOut={() => spring(1)}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Pulsing ring behind a solid dot — the "live" printing indicator.
export function LiveDot({ color, size = 9 }: { color: string; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale }],
          opacity,
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function Skeleton({
  width,
  height = 14,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 780, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 780, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius.sm, backgroundColor: colors.cardAlt, opacity },
        style,
      ]}
    />
  );
}

// Animated expand/collapse. Content stays mounted+measured; height animates
// during the transition and is left `auto` when fully open so dynamic content
// (e.g. filtered macro lists) never clips.
export function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [measured, setMeasured] = useState(0);
  const [animating, setAnimating] = useState(false);
  const anim = useRef(new Animated.Value(open ? 1 : 0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setAnimating(true);
    Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: 240,
      useNativeDriver: false,
    }).start(() => setAnimating(false));
  }, [open, anim]);

  const animatedHeight = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, Math.max(measured, 1)],
  });
  const height = animating ? animatedHeight : open ? undefined : 0;
  const opacity = animating ? anim : open ? 1 : 0;

  return (
    <Animated.View style={{ height, opacity, overflow: 'hidden' }}>
      <View onLayout={(e) => setMeasured(e.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  );
}

export function Chevron({ open, color = colors.subtext }: { open: boolean; color?: string }) {
  const a = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [open, a]);
  const rotate = a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <MaterialCommunityIcons name="chevron-down" size={22} color={color} />
    </Animated.View>
  );
}

// staggered fade+rise for section entrance
export function FadeInUp({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, {
      toValue: 1,
      duration: 340,
      delay,
      useNativeDriver: true,
    }).start();
  }, [a, delay]);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <Animated.View style={[{ opacity: a, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

// pop/scale entrance for dropdowns and menus — grows out of its anchor
export function PopIn({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [a]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });
  return (
    <Animated.View style={[{ opacity: a, transform: [{ translateY }, { scale }] }, style]}>
      {children}
    </Animated.View>
  );
}
