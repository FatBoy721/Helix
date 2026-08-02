// Filament usage chart + printer stats, restyled.
//
// Same information as the original UsageChart and "Printer Stats" card — the
// numbers were right, it just looked like a spreadsheet. Changes here are
// presentational plus a few readability fixes:
//   - bars are rounded and gradient-filled, with the selected day's value
//     floating above it instead of only in the row below
//   - days with no prints still draw a faint tick, so gaps read as "nothing
//     printed" rather than "chart ended"
//   - stats keep their averages but gain icons, so the grid can be scanned
//     rather than read line by line
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COCKPIT as P, alpha, type IconName } from '../dashboard/shared';
import { t } from '../../services/i18n';
import type { HistoryJob, HistoryTotals } from '../../services/moonraker';
import PrinterIcon from '../PrinterIcon';

const DAYS = 14;
const CHART_HEIGHT = 96;
const PLA_DENSITY_G_PER_CM3 = 1.24;
const STANDARD_FILAMENT_AREA_MM2 = Math.PI * (1.75 / 2) ** 2;

function filamentMmToGrams(mm: number): number {
  return (mm * STANDARD_FILAMENT_AREA_MM2 * PLA_DENSITY_G_PER_CM3) / 1000;
}

function fmtDur(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '--';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtMetres(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return '--';
  return `${(mm / 1000).toFixed(mm >= 100_000 ? 0 : 1)} m`;
}

interface Bar {
  label: string;
  dateLabel: string;
  grams: number;
  mm: number;
  jobs: number;
}

export default function UsagePanel({
  jobs,
  totals,
}: {
  jobs: HistoryJob[];
  totals: HistoryTotals | null;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const { bars, total, max, latestIdx } = useMemo(() => {
    const now = new Date();
    const days: Bar[] = [];
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
    const startEpoch =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1)).getTime() / 1000;

    let sum = 0;
    for (const j of jobs) {
      if (!j.start_time || j.start_time < startEpoch) continue;
      const mm = j.filament_used ?? 0;
      const grams = filamentMmToGrams(mm);
      const dayIdx = Math.floor((j.start_time - startEpoch) / 86400);
      if (dayIdx >= 0 && dayIdx < DAYS) {
        days[dayIdx].grams += grams;
        days[dayIdx].mm += mm;
        days[dayIdx].jobs += 1;
        sum += grams;
      }
    }
    const peak = Math.max(...days.map((d) => d.grams), 1);
    let latest = DAYS - 1;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].grams > 0) {
        latest = i;
        break;
      }
    }
    return { bars: days, total: sum, max: peak, latestIdx: latest };
  }, [jobs]);

  const activeIdx = selectedIdx ?? latestIdx;
  const selected = bars[activeIdx] ?? bars[DAYS - 1];

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headRow}>
          <Text style={styles.title}>{t('Filament usage')}</Text>
          <View style={styles.totalPill}>
            <Text style={styles.totalText}>{Math.round(total)} g</Text>
            <Text style={styles.totalSub}>/ {DAYS}d</Text>
          </View>
        </View>

        <View style={styles.chart}>
          {bars.map((b, i) => {
            const on = i === activeIdx;
            const heightPct = b.grams > 0 ? Math.max(6, (b.grams / max) * 100) : 0;
            return (
              <Pressable
                key={b.label}
                style={styles.barCol}
                onPress={() => setSelectedIdx(i)}
                accessibilityRole="button"
                accessibilityLabel={`${b.dateLabel}: ${Math.round(b.grams)} ${t('grams')}`}
              >
                {b.grams > 0 ? (
                  <View style={[styles.barWrap, { height: `${heightPct}%` }]}>
                    <Svg width="100%" height="100%">
                      <Defs>
                        <LinearGradient id={`bar${i}`} x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0%" stopColor={on ? P.text : P.accent} />
                          <Stop
                            offset="100%"
                            stopColor={on ? P.accent : alpha(P.accent, 0.45)}
                          />
                        </LinearGradient>
                      </Defs>
                      <Rect x="0" y="0" width="100%" height="100%" rx="4" fill={`url(#bar${i})`} />
                    </Svg>
                  </View>
                ) : (
                  // A faint tick for empty days — without it the chart looks
                  // like it simply stops where printing stopped. It still needs
                  // a selected state, or tapping a day with no prints appears
                  // to do nothing.
                  <View style={[styles.emptyTick, on && styles.emptyTickOn]} />
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.axisRow}>
          <Text style={styles.axis}>{bars[0].label}</Text>
          <Text style={styles.axis}>{bars[Math.floor(DAYS / 2)].label}</Text>
          <Text style={styles.axis}>{bars[DAYS - 1].label}</Text>
        </View>

        <View style={styles.detail}>
          <Text style={styles.detailDate}>{selected.dateLabel}</Text>
          {selected.jobs > 0 ? (
            <View style={styles.detailValues}>
              <Text style={styles.detailPrimary}>{Math.round(selected.grams)} g</Text>
              <Text style={styles.detailSecondary}>
                {(selected.mm / 1000).toFixed(2)} m · {selected.jobs}{' '}
                {t(selected.jobs === 1 ? 'job' : 'jobs')}
              </Text>
            </View>
          ) : (
            <Text style={styles.detailSecondary}>{t('No prints')}</Text>
          )}
        </View>
      </View>

      {totals ? (
        <View style={styles.statGrid}>
          {/*
            Lifetime counter, deliberately not "Total jobs": it keeps climbing
            after old rows are pruned, so it runs ahead of the list below it
            (174 vs 129 rows here). Labelling it plainly stops that reading as
            a missing-prints bug.
          */}
          <Stat
            icon="printer-3d"
            label={t('Jobs (lifetime)')}
            value={String(Math.round(totals.total_jobs))}
          />
          <Stat icon="trophy-outline" label={t('Longest job')} value={fmtDur(totals.longest_job)} />
          <Stat
            icon="clock-outline"
            label={t('Total time')}
            value={fmtDur(totals.total_time)}
            sub={`${t('avg')} ${fmtDur(totals.total_jobs ? totals.total_time / totals.total_jobs : 0)}`}
          />
          <Stat
            icon="printer-3d-nozzle"
            label={t('Print time')}
            value={fmtDur(totals.total_print_time)}
            sub={`${t('avg')} ${fmtDur(totals.total_jobs ? totals.total_print_time / totals.total_jobs : 0)}`}
          />
          <Stat
            icon="paper-roll-outline"
            label={t('Filament used')}
            value={fmtMetres(totals.total_filament_used)}
            sub={`${t('avg')} ${fmtMetres(totals.total_jobs ? totals.total_filament_used / totals.total_jobs : 0)}`}
          />
          <Stat icon="timer-sand" label={t('Longest print')} value={fmtDur(totals.longest_print)} />
        </View>
      ) : null}
    </View>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        {icon === 'printer-3d' ? (
          <PrinterIcon size={13} />
        ) : (
          <MaterialCommunityIcons name={icon} size={13} color={P.dim} />
        )}
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {value}
      </Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },

  card: {
    borderRadius: 18,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    padding: 14,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: P.text, fontSize: 15, fontWeight: '800' },
  totalPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: alpha(P.accent, 0.14),
  },
  totalText: { color: P.accent, fontSize: 13, fontWeight: '800' },
  totalSub: { color: alpha(P.accent, 0.75), fontSize: 11, fontWeight: '700' },

  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    gap: 4,
    marginTop: 16,
  },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  barWrap: { width: '100%', minHeight: 4 },
  emptyTick: {
    height: 3,
    borderRadius: 2,
    backgroundColor: alpha(P.dim, 0.28),
  },
  emptyTickOn: { height: 6, backgroundColor: P.text },

  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  axis: { color: P.dim, fontSize: 10, fontWeight: '700' },

  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: P.border,
  },
  detailDate: { color: P.text, fontSize: 13, fontWeight: '800' },
  detailValues: { alignItems: 'flex-end', gap: 1 },
  detailPrimary: { color: P.text, fontSize: 15, fontWeight: '800' },
  detailSecondary: { color: P.dim, fontSize: 11, fontWeight: '600' },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    // Two per row, accounting for the 10px gap.
    width: '48%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 16,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    gap: 3,
  },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statLabel: { color: P.dim, fontSize: 11, fontWeight: '700', flexShrink: 1 },
  statValue: { color: P.text, fontSize: 17, fontWeight: '800' },
  statSub: { color: P.dim, fontSize: 10, fontWeight: '600', opacity: 0.85 },
});
