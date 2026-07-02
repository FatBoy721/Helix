import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';

export function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '--';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

interface Props {
  filename?: string;
  progress: number; // 0..1
  printDuration: number; // seconds
  currentLayer?: number | null;
  totalLayer?: number | null;
}

export default function PrintProgress({
  filename,
  progress,
  printDuration,
  currentLayer,
  totalLayer,
}: Props) {
  const pct = Math.max(0, Math.min(1, progress || 0));
  const eta = pct > 0.001 ? printDuration / pct - printDuration : NaN;
  const name = (filename || '').split('/').pop() || 'No file';

  return (
    <View style={styles.card}>
      <Text style={styles.filename} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.barRow}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(pct * 100)}%`, backgroundColor: colors.primary },
            ]}
          />
        </View>
        <Text style={styles.pct}>{(pct * 100).toFixed(1)}%</Text>
      </View>
      <View style={styles.statsRow}>
        <Stat label="Elapsed" value={formatDuration(printDuration)} />
        <Stat label="ETA" value={isNaN(eta) ? '--' : formatDuration(eta)} />
        <Stat
          label="Layer"
          value={
            currentLayer != null && totalLayer != null && totalLayer > 0
              ? `${currentLayer} / ${totalLayer}`
              : '--'
          }
        />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  filename: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: colors.cardAlt,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  pct: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'right',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  stat: { flex: 1 },
  statLabel: {
    color: colors.subtext,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  statValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
});
