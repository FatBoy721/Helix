import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, HistoryJob, HistoryTotals, thumbnailUrl } from '../services/moonraker';
import UsageChart from './UsageChart';
import { t } from '../services/i18n';
import { formatSize } from '../services/format';
import { colors, spacing } from '../constants/theme';

const PAGE = 30;

function fmtDur(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  return (
    d.toLocaleDateString() +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

function fmtFilament(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

function statusIcon(status: string): { name: any; color: string } {
  switch (status) {
    case 'completed':
      return { name: 'check-circle', color: colors.success };
    case 'cancelled':
      return { name: 'close-circle', color: colors.danger };
    case 'error':
    case 'klippy_shutdown':
    case 'klippy_disconnect':
      return { name: 'alert-circle', color: colors.danger };
    case 'in_progress':
      return { name: 'progress-clock', color: colors.primary };
    case 'interrupted':
      return { name: 'alert', color: colors.warning };
    default:
      return { name: 'help-circle-outline', color: colors.subtext };
  }
}

function jobThumb(base: string, job: HistoryJob): string | null {
  const thumbs = job.metadata?.thumbnails;
  if (!Array.isArray(thumbs) || !thumbs.length) return null;
  const best = thumbs.reduce((a, b) => (b.width > a.width ? b : a), thumbs[0]);
  return thumbnailUrl(base, job.filename, best.relative_path);
}

export default function HistoryView({ base, connected }: { base: string; connected: boolean }) {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [count, setCount] = useState(0);
  const [totals, setTotals] = useState<HistoryTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (start: number, replace: boolean) => {
      if (!base) return;
      setLoading(true);
      setError('');
      try {
        const [list, tot] = await Promise.all([
          api.historyList(base, PAGE, start),
          start === 0 ? api.historyTotals(base) : Promise.resolve(null),
        ]);
        setCount(list.count);
        setJobs((prev) => (replace ? list.jobs : [...prev, ...list.jobs]));
        if (tot) setTotals(tot.job_totals);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [base]
  );

  useEffect(() => {
    if (connected) load(0, true);
  }, [connected, load]);

  const header = (
    <>
    <UsageChart jobs={jobs} />
    <View style={styles.statsCard}>
      <Text style={styles.statsTitle}>{t('Printer Stats')}</Text>
      {totals ? (
        <View style={styles.statsGrid}>
          <Stat label={t('Total print jobs')} value={String(Math.round(totals.total_jobs))} />
          <Stat label={t('Longest job')} value={fmtDur(totals.longest_job)} />
          <Stat
            label={t('Total time')}
            value={fmtDur(totals.total_time)}
            sub={`${t('avg')} ${fmtDur(totals.total_jobs ? totals.total_time / totals.total_jobs : 0)}`}
          />
          <Stat
            label={t('Total print time')}
            value={fmtDur(totals.total_print_time)}
            sub={`${t('avg')} ${fmtDur(totals.total_jobs ? totals.total_print_time / totals.total_jobs : 0)}`}
          />
          <Stat
            label={t('Filament used')}
            value={fmtFilament(totals.total_filament_used)}
            sub={`${t('avg')} ${fmtFilament(totals.total_jobs ? totals.total_filament_used / totals.total_jobs : 0)}`}
          />
          <Stat label={t('Longest print')} value={fmtDur(totals.longest_print)} />
        </View>
      ) : (
        <Text style={styles.empty}>{connected ? '…' : t('Not connected')}</Text>
      )}
    </View>
    </>
  );

  const footer =
    jobs.length < count ? (
      <TouchableOpacity
        style={styles.moreBtn}
        onPress={() => load(jobs.length, false)}
        disabled={loading}
      >
        <Text style={styles.moreText}>
          {loading ? '…' : `${t('Load more')} (${jobs.length}/${count})`}
        </Text>
      </TouchableOpacity>
    ) : null;

  return (
    <FlatList
      data={jobs}
      keyExtractor={(j) => j.job_id}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            {error ? `${t('Error')}: ${error}` : connected ? t('No print history') : t('Not connected')}
          </Text>
        ) : null
      }
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => load(0, true)} tintColor={colors.subtext} />
      }
      renderItem={({ item }) => {
        const icon = statusIcon(item.status);
        const thumb = jobThumb(base, item);
        return (
          <View style={styles.jobCard}>
            {thumb ? (
              <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <MaterialCommunityIcons name="file-code-outline" size={20} color={colors.subtext} />
              </View>
            )}
            <View style={styles.jobInfo}>
              <Text style={styles.jobName} numberOfLines={1}>
                {item.filename}
              </Text>
              <Text style={styles.jobMeta}>
                {fmtDate(item.start_time)} · {fmtDur(item.print_duration || item.total_duration)}
              </Text>
              <Text style={styles.jobMeta}>
                {[formatSize(item.metadata?.size), item.filament_used > 0 ? fmtFilament(item.filament_used) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <MaterialCommunityIcons name={icon.name} size={24} color={icon.color} />
          </View>
        );
      }}
    />
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xl * 2,
  },
  statsCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  statsTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  stat: {
    width: '50%',
    marginBottom: spacing.sm,
  },
  statLabel: {
    color: colors.subtext,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  statValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 1,
  },
  statSub: {
    color: colors.subtext,
    fontSize: 11,
  },
  jobCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: colors.cardAlt,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobInfo: {
    flex: 1,
  },
  jobName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  jobMeta: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 1,
  },
  moreBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  moreText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
