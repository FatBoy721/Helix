// History, in the Shelf/Cockpit language.
//
// Keeps what the original had — the 14-day filament chart and the full stats
// grid, both restyled in UsagePanel. The list itself changes in two ways:
//   - status becomes a coloured left edge, matching the toolhead rail, so you
//     scan a column of edges for failures instead of reading every row
//   - jobs are grouped by day, because history is read chronologically
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COCKPIT as P, alpha, type IconName } from '../dashboard/shared';
import UsagePanel from './UsagePanel';
import { thumbnailUrl, type HistoryJob } from '../../services/moonraker';
import { t } from '../../services/i18n';
import {
  fmtDuration,
  fmtFilament,
  outcomeOf,
  statusLabel,
  type JobOutcome,
  type PrintHistory,
} from '../../hooks/usePrintHistory';

const PAGE = 16;

function outcomeColor(outcome: JobOutcome): string {
  if (outcome === 'success') return P.success;
  if (outcome === 'failed') return P.danger;
  if (outcome === 'running') return P.accent;
  return P.dim;
}

function outcomeIcon(outcome: JobOutcome): IconName {
  if (outcome === 'success') return 'check-circle';
  if (outcome === 'failed') return 'close-circle';
  if (outcome === 'running') return 'progress-clock';
  return 'help-circle-outline';
}

function jobThumb(base: string, job: HistoryJob): string | null {
  const thumbs = job.metadata?.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  const best = thumbs.reduce((a, b) => (b.width > a.width ? b : a), thumbs[0]);
  return thumbnailUrl(base, job.filename, best.relative_path);
}

function stem(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.gcode$/i, '');
}

export default function HistoryPanel({
  base,
  history,
}: {
  base: string;
  history: PrintHistory;
}) {
  const { totals } = history;

  return (
    <SectionList
      sections={history.days.map((d) => ({ title: d.label, data: d.jobs }))}
      keyExtractor={(job) => job.job_id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={history.loading}
          onRefresh={history.refresh}
          tintColor={P.dim}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <UsagePanel jobs={history.jobs} totals={totals} />
        </View>
      }
      ListEmptyComponent={
        history.loading ? null : (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="history" size={30} color={P.dim} />
            <Text style={styles.emptyText}>
              {history.error ? history.error : t('No print history yet.')}
            </Text>
          </View>
        )
      }
      // Pages stream in as you scroll, so the whole history is reachable
      // without hunting for a button.
      onEndReached={history.hasMore ? history.loadMore : undefined}
      onEndReachedThreshold={0.6}
      ListFooterComponent={<Footer history={history} />}
      renderSectionHeader={({ section }) => (
        <Text style={styles.dayLabel}>{section.title}</Text>
      )}
      renderItem={({ item }) => <JobRow base={base} job={item} />}
    />
  );
}

/**
 * Tail of the list: a spinner while a page is in flight, a manual fallback if
 * onEndReached never fires (short lists, fast flings), and a terminator so the
 * end of history reads as the end rather than as a failed load.
 */
function Footer({ history }: { history: PrintHistory }) {
  if (history.jobs.length === 0) return null;

  // Counts are what we hold, never a claimed total: the API reports neither the
  // history depth nor a usable total, so promising one would be a lie.
  if (history.loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={P.accent} />
        <Text style={styles.footerText}>{t('Loading more…')}</Text>
      </View>
    );
  }

  if (history.hasMore) {
    return (
      <Pressable
        onPress={history.loadMore}
        style={({ pressed }) => [styles.more, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.moreText}>
          {t('Load more')} ({history.jobs.length} {t('so far')})
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        {t('All')} {history.jobs.length} {t(history.jobs.length === 1 ? 'print' : 'prints')}
      </Text>
    </View>
  );
}

function JobRow({ base, job }: { base: string; job: HistoryJob }) {
  const outcome = outcomeOf(job.status);
  const color = outcomeColor(outcome);
  const thumb = jobThumb(base, job);
  const when = new Date(job.start_time * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.row}>
      <View style={[styles.edge, { backgroundColor: color }]} />
      <View style={styles.rowBody}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <MaterialCommunityIcons name="cube-outline" size={18} color={P.dim} />
          </View>
        )}

        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>
            {stem(job.filename)}
          </Text>
          <View style={styles.rowStatusLine}>
            <MaterialCommunityIcons name={outcomeIcon(outcome)} size={13} color={color} />
            <Text style={[styles.rowStatus, { color }]}>{statusLabel(job.status)}</Text>
            <Text style={styles.rowDot}>·</Text>
            <Text style={styles.rowMeta}>{when}</Text>
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {[
              fmtDuration(job.print_duration || job.total_duration),
              job.filament_used > 0 ? fmtFilament(job.filament_used) : '',
              // A deleted source file can't be reprinted; say so rather than
              // letting someone find out by trying.
              job.exists ? '' : t('file deleted'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: PAGE, paddingBottom: 40, gap: 8 },
  header: { gap: 10, marginBottom: 6 },

  dayLabel: {
    color: P.dim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },

  row: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: alpha(P.border, 0.8),
  },
  edge: { width: 4 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10 },
  thumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: P.surfaceAlt },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: P.border,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: P.text, fontSize: 13, fontWeight: '800' },
  rowStatusLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowStatus: { fontSize: 11, fontWeight: '800' },
  rowDot: { color: P.dim, fontSize: 11 },
  rowMeta: { color: P.dim, fontSize: 11, fontWeight: '600' },

  more: {
    height: 48,
    marginTop: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  moreText: { color: P.accent, fontSize: 13, fontWeight: '800' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 22,
  },
  footerText: { color: P.dim, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  emptyText: { color: P.dim, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
