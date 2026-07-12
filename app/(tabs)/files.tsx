import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMoonraker } from '../../hooks/useMoonraker';
import { api, FileEntry, thumbnailUrl } from '../../services/moonraker';
import HistoryView from '../../components/HistoryView';
import TimelapseView from '../../components/TimelapseView';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

// path|modified -> thumbnail URL, null = file genuinely has no thumbnail.
// cached at module level so scrolling doesn't re-hit /server/files/metadata
// for every row. modified is in the key so re-sliced files bust the cache.
const thumbCache = new Map<string, string | null>();

function FileThumb({ base, file }: { base: string; file: FileEntry }) {
  const cacheKey = `${file.path}|${file.modified}`;
  const [thumb, setThumb] = useState<string | null | undefined>(thumbCache.get(cacheKey));

  useEffect(() => {
    if (thumb !== undefined || !base) return;
    let live = true;
    (async () => {
      try {
        const meta: any = await api.metadata(base, file.path);
        const thumbs: any[] = Array.isArray(meta?.thumbnails) ? meta.thumbnails : [];
        const best = thumbs.reduce(
          (a, b) => (!a || (b?.width ?? 0) > (a.width ?? 0) ? b : a),
          null as any
        );
        const url = best?.relative_path ? thumbnailUrl(base, file.path, best.relative_path) : null;
        thumbCache.set(cacheKey, url);
        if (live) setThumb(url);
      } catch {
        thumbCache.set(cacheKey, null);
        if (live) setThumb(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [base, cacheKey, thumb, file.path]);

  if (thumb) {
    return <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />;
  }
  return (
    <View style={[styles.thumb, styles.thumbPlaceholder]}>
      <MaterialCommunityIcons name="file-code-outline" size={24} color={colors.subtext} />
    </View>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function FilesScreen() {
  const { connection, activeUrl, status } = useMoonraker();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'files' | 'history' | 'timelapse'>('files');

  const printState: string = status.print_stats?.state ?? '';

  const refresh = useCallback(async () => {
    if (!activeUrl) return;
    setLoading(true);
    setError('');
    try {
      const list = await api.listFiles(activeUrl);
      setFiles([...list].sort((a, b) => b.modified - a.modified));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [activeUrl]);

  useEffect(() => {
    if (connection === 'connected') refresh();
  }, [connection, refresh]);

  const startPrint = (file: FileEntry) => {
    if (printState === 'printing' || printState === 'paused') {
      Alert.alert(t('Printer busy'), t('A print is already in progress.'));
      return;
    }
    Alert.alert(t('Start print?'), file.path, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Print'),
        onPress: async () => {
          try {
            await api.startPrint(activeUrl, file.path);
            Alert.alert(t('Print started'), file.path);
          } catch (e: any) {
            Alert.alert(t('Error'), String(e?.message ?? e));
          }
        },
      },
    ]);
  };

  const empty = useMemo(
    () => (
      <Text style={styles.empty}>
        {connection !== 'connected'
          ? t('Not connected')
          : error
            ? `${t('Error')}: ${error}`
            : t('No G-code files on printer')}
      </Text>
    ),
    [connection, error]
  );

  return (
    <View style={styles.screen}>
      <View style={styles.segmentRow}>
        {(['files', 'history', 'timelapse'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segment, mode === m && { backgroundColor: colors.primary }]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'files' ? t('Files') : m === 'history' ? t('History') : t('Timelapse')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'history' ? (
        <HistoryView base={activeUrl} connected={connection === 'connected'} />
      ) : mode === 'timelapse' ? (
        <TimelapseView base={activeUrl} connected={connection === 'connected'} />
      ) : (
      <FlatList
        data={files}
        keyExtractor={(item) => item.path}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.subtext} />
        }
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.fileCard} onPress={() => startPrint(item)}>
            <FileThumb base={activeUrl} file={item} />
            <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={2}>
                {item.path}
              </Text>
              <View style={styles.fileMeta}>
                <Text style={styles.metaText}>{formatSize(item.size)}</Text>
                <Text style={styles.metaText}>{formatDate(item.modified)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  segmentRow: {
    flexDirection: 'row',
    margin: spacing.lg,
    marginBottom: 0,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentText: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  fileCard: {
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
    width: 56,
    height: 56,
    borderRadius: 6,
    backgroundColor: colors.cardAlt,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  fileMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  metaText: {
    color: colors.subtext,
    fontSize: 11,
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.xl * 2,
  },
});
