// ScreenMirror — live view of the AD5X touchscreen with remote tap, embedded
// in the Home "Printer screen" section.
//
// Pure Image + fetch (no MJPEG: RN's Image can't consume a multipart stream).
// Frames are double-buffered (see useScreenMirror) so the displayed image is
// never blank between frames — no flicker. Taps map directly to raw screen
// pixels (0..799 / 0..479, origin top-left): helixd applies the tslib inverse
// transform itself, so the client does NO calibration, scaling or Y-flip.
//
// This renders chrome-less and fills its parent (the dashboard screenCard owns
// the border/radius). It gates its own polling on tab focus + foreground so a
// backgrounded Home tab doesn't keep loading the printer.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COCKPIT as P, alpha, type IconName } from './dashboard/shared';
import { useScreenMirror } from '../hooks/useScreenMirror';

const RIPPLE_MS = 600;
const RIPPLE_SIZE = 46;

interface Banner {
  text: string;
  tone: 'warn' | 'danger';
  icon: IconName;
}

function stateLabel(state: string): string {
  const s = state.toLowerCase();
  if (s === 'printing') return 'Printing';
  if (s === 'paused') return 'Paused';
  if (s === 'standby' || s === 'idle' || s === 'complete' || s === '') return 'Standby';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function stateDotColor(state: string, throttled: boolean): string {
  if (throttled) return P.warn;
  const s = state.toLowerCase();
  if (s === 'standby' || s === 'idle' || s === 'complete' || s === '') return P.success;
  if (s === 'printing' || s === 'paused') return P.warn;
  return P.dim;
}

function bannerFor(s: ReturnType<typeof useScreenMirror>): Banner | null {
  if (s.touchError) {
    return { text: `Touch unavailable: ${s.touchError}`, tone: 'danger', icon: 'alert-circle' };
  }
  // 409 ("printer busy") is surfaced as a silent no-op, not a lock banner —
  // taps stay enabled during prints. Other failures (network/4xx) still show.
  if (s.tapError && s.tapError.status !== 409) {
    return { text: s.tapError.message, tone: 'danger', icon: 'alert-circle' };
  }
  return null;
}

export default function ScreenMirror() {
  // Self-gate polling: only run while the Home tab is focused and the app is
  // in the foreground.
  const [focused, setFocused] = useState(true);
  const [foreground, setForeground] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);

  const s = useScreenMirror(focused && foreground);
  const [measured, setMeasured] = useState({ w: 0, h: 0 });
  const [ripple, setRipple] = useState<{ x: number; y: number; key: number } | null>(null);
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const rippleKey = useRef(0);

  useEffect(() => {
    if (!ripple) return;
    rippleAnim.setValue(0);
    const anim = Animated.timing(rippleAnim, {
      toValue: 1,
      duration: RIPPLE_MS,
      useNativeDriver: true,
    });
    anim.start();
    const t = setTimeout(() => setRipple(null), RIPPLE_MS);
    return () => {
      anim.stop();
      clearTimeout(t);
    };
  }, [ripple, rippleAnim]);

  const handlePressIn = useCallback(
    (x: number, y: number) => {
      if (measured.w === 0 || measured.h === 0) return;
      const sx = Math.max(0, Math.min(s.width - 1, Math.round((x / measured.w) * s.width)));
      const sy = Math.max(0, Math.min(s.height - 1, Math.round((y / measured.h) * s.height)));
      rippleKey.current += 1;
      setRipple({ x, y, key: rippleKey.current });
      // force=true: helixd refuses taps while the printer reports busy, so
      // the mirror would be unclickable mid-print without forcing through.
      void s.tap(sx, sy, true).then((r) => {
        // Pull a fresh frame right after a tap so the result is visible
        // immediately instead of on the next poll (matters most while
        // printing, where capture is throttled to ~1 fps).
        if (r.ok) s.refresh();
      });
    },
    [measured.w, measured.h, s]
  );

  const rippleScale = rippleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.7] });
  const rippleOpacity = rippleAnim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.85, 0.5, 0] });

  const banner = bannerFor(s);
  const dotColor = stateDotColor(s.printState, s.throttled);

  return (
    <View
      style={[styles.surface, { aspectRatio: s.width / s.height }]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setMeasured((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }}
    >
      {/* Committed (displayed) frame — stays put while the next one loads. */}
      {s.committedUri ? (
        <Image
          source={{ uri: s.committedUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="stretch"
          fadeDuration={0}
        />
      ) : null}

      {/* Pending frame — loads on top, promoted to committed once decoded so
          the surface is never blank between frames (no flicker). */}
      {s.pendingUri ? (
        <Image
          source={{ uri: s.pendingUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="stretch"
          fadeDuration={0}
          onLoad={s.onPendingLoaded}
          onError={s.onPendingError}
        />
      ) : null}

      {!s.hasFrame ? (
        <View style={styles.placeholder} pointerEvents="none">
          <MaterialCommunityIcons name="monitor-dashboard" size={30} color={P.dim} />
          <Text style={styles.placeholderText}>
            {!s.baseUrl ? 'No printer' : s.loading ? 'Connecting…' : 'Loading screen…'}
          </Text>
        </View>
      ) : null}

      {/* Tap surface — fills the exact panel rect (aspect-matched, so no
          letterboxing to undo) and forwards touches as single taps. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPressIn={(e) => handlePressIn(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      >
        {ripple ? (
          <Animated.View
            key={ripple.key}
            pointerEvents="none"
            style={[
              styles.ripple,
              {
                left: ripple.x - RIPPLE_SIZE / 2,
                top: ripple.y - RIPPLE_SIZE / 2,
                opacity: rippleOpacity,
                transform: [{ scale: rippleScale }],
              },
            ]}
          />
        ) : null}
      </Pressable>

      <View style={styles.badge} pointerEvents="none">
        <View style={[styles.badgeDot, { backgroundColor: dotColor }]} />
        <Text style={styles.badgeText}>{stateLabel(s.printState)}</Text>
        <Text style={styles.badgeNote}>· {s.throttled ? 'throttled ~1 fps' : 'live'}</Text>
      </View>

      {banner ? (
        <View
          style={[styles.banner, banner.tone === 'warn' ? styles.bannerWarn : styles.bannerDanger]}
          pointerEvents="none"
        >
          <MaterialCommunityIcons name={banner.icon} size={15} color="#FFFFFF" />
          <Text style={styles.bannerText}>{banner.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    width: '100%',
    backgroundColor: '#050608',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  placeholderText: { color: P.dim, fontSize: 12, fontWeight: '600' },
  ripple: {
    position: 'absolute',
    width: RIPPLE_SIZE,
    height: RIPPLE_SIZE,
    borderRadius: RIPPLE_SIZE / 2,
    borderWidth: 2,
    borderColor: alpha('#FFFFFF', 0.9),
    backgroundColor: alpha(P.accent, 0.18),
  },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: alpha('#000000', 0.6),
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { color: P.text, fontSize: 11, fontWeight: '800' },
  badgeNote: { color: P.dim, fontSize: 11, fontWeight: '700' },
  banner: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
  },
  bannerWarn: { backgroundColor: alpha(P.warn, 0.9) },
  bannerDanger: { backgroundColor: alpha(P.danger, 0.9) },
  bannerText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', flexShrink: 1 },
});
