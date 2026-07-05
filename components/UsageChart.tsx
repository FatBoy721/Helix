import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HistoryJob } from '../services/moonraker';
import { t } from '../services/i18n';
import { colors, spacing } from '../constants/theme';

const DAYS = 14;
const PLA_DENSITY_G_PER_CM3 = 1.24;
const STANDARD_FILAMENT_AREA_MM2 = Math.PI * (1.75 / 2) ** 2;

function filamentMmToGrams(mm: number): number {
  return (mm * STANDARD_FILAMENT_AREA_MM2 * PLA_DENSITY_G_PER_CM3) / 1000;
}

// filament used per day over the last two weeks, from moonraker's job
// history. spoolman's API has no per-spool time series, so this is the
// honest source for a usage graph — and it covers pre-spoolman prints too.
// crabcore
export default function UsageChart({ jobs }: { jobs: HistoryJob[] }) {
  const [selectedIdx, setSelectedIdx] = React.useState<number | null>(null);
  const { bars, total, max, latestIdx } = useMemo(() => {
    const now = new Date();
    const days: { label: string; dateLabel: string; grams: number; mm: number; jobs: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        dateLabel: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        grams: 0,
        mm: 0,
        jobs: 0,
      });
    }
    const startEpoch = new Date(
      now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1)
    ).getTime() / 1000;

    let total = 0;
    for (const j of jobs) {
      if (!j.start_time || j.start_time < startEpoch) continue;
      const mm = j.filament_used ?? 0;
      const grams = filamentMmToGrams(mm);
      const dayIdx = Math.floor((j.start_time - startEpoch) / 86400);
      if (dayIdx >= 0 && dayIdx < DAYS) {
        days[dayIdx].grams += grams;
        days[dayIdx].mm += mm;
        days[dayIdx].jobs += 1;
        total += grams;
      }
    }
    const max = Math.max(...days.map((d) => d.grams), 1);
    let latestIdx = DAYS - 1;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].grams > 0) {
        latestIdx = i;
        break;
      }
    }
    return { bars: days, total, max, latestIdx };
  }, [jobs]);

  if (total <= 0) return null;

  const selected = bars[selectedIdx ?? latestIdx] ?? bars[DAYS - 1];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('Filament usage')}</Text>
        <Text style={styles.total}>
          {Math.round(total)} g / {DAYS}d
        </Text>
      </View>
      <View style={styles.chart}>
        {bars.map((b, i) => {
          const selectedBar = b === selected;
          return (
            <Pressable
              key={i}
              style={styles.barCol}
              onPress={() => setSelectedIdx(i)}
              accessibilityRole="button"
              accessibilityLabel={`${b.dateLabel}: ${Math.round(b.grams)} g`}
            >
              <View
                style={[
                  styles.bar,
                  selectedBar && styles.barSelected,
                  {
                    height: `${Math.max(3, (b.grams / max) * 100)}%`,
                    backgroundColor: b.grams > 0 ? colors.primary : colors.cardAlt,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>{bars[0].label}</Text>
        <Text style={styles.axisLabel}>{bars[Math.floor(DAYS / 2)].label}</Text>
        <Text style={styles.axisLabel}>{bars[DAYS - 1].label}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailDate}>{selected.dateLabel}</Text>
        <Text style={styles.detailValue}>
          {`${Math.round(selected.grams)} g / ${(selected.mm / 1000).toFixed(2)} m / ${selected.jobs} ${
            selected.jobs === 1 ? t('job') : t('jobs')
          }`}
        </Text>
      </View>
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
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  total: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 80,
    gap: 3,
  },
  barCol: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 2,
    minHeight: 2,
  },
  barSelected: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  axisLabel: {
    color: colors.subtext,
    fontSize: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  detailDate: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  detailValue: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
});
