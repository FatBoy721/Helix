import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';

interface Props {
  name: string;
  temperature?: number;
  target?: number;
  power?: number; // 0..1
  active?: boolean;
}

function tempColor(temp: number, target: number): string {
  if (target > 0) {
    return temp < target - 5 ? colors.warning : colors.hot;
  }
  return temp >= 50 ? colors.warning : colors.cold;
}

export default function TempGauge({ name, temperature, target, power, active }: Props) {
  const temp = temperature ?? 0;
  const tgt = target ?? 0;
  const color = tempColor(temp, tgt);

  return (
    <View style={[styles.card, active && { borderColor: colors.primary }]}>
      <View style={styles.header}>
        <Text style={styles.name}>{name}</Text>
        {active ? <Text style={[styles.activeTag, { color: colors.primary }]}>ACTIVE</Text> : null}
      </View>
      <Text style={[styles.temp, { color }]}>
        {temp.toFixed(1)}
        <Text style={styles.unit}>°C</Text>
      </Text>
      <Text style={styles.target}>{tgt > 0 ? `→ ${tgt.toFixed(0)}°C` : 'off'}</Text>
      {typeof power === 'number' ? (
        <View style={styles.powerTrack}>
          <View style={[styles.powerFill, { width: `${Math.round(power * 100)}%`, backgroundColor: color }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flex: 1,
    minWidth: '45%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  activeTag: {
    fontSize: 9,
    fontWeight: '700',
  },
  temp: {
    fontSize: 26,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  unit: {
    fontSize: 14,
    fontWeight: '400',
  },
  target: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 2,
  },
  powerTrack: {
    height: 3,
    backgroundColor: colors.cardAlt,
    borderRadius: 2,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  powerFill: {
    height: 3,
    borderRadius: 2,
  },
});
