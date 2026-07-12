import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, FileEntry, fileUrl } from '../services/moonraker';
import { t } from '../services/i18n';
import { formatSize } from '../services/format';
import { colors, spacing } from '../constants/theme';

interface Clip {
  video: FileEntry;
  thumbUrl: string | null;
}

function fmtDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// player page: plain <video> pointed at moonraker's file endpoint. the printer
// serves mp4 with range support so seeking works.
function playerHtml(src: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;display:flex;align-items:center;}
video{width:100%;max-height:100%;}</style></head>
<body><video src="${src}" controls autoplay playsinline></video></body></html>`;
}

export default function TimelapseView({ base, connected }: { base: string; connected: boolean }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<Clip | null>(null);

  const refresh = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    setError('');
    try {
      const list = await api.listFilesRoot(base, 'timelapse');
      setFiles([...list].sort((a, b) => b.modified - a.modified));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  const clips = useMemo<Clip[]>(() => {
    const jpgs = new Set(files.filter((f) => /\.jpe?g$/i.test(f.path)).map((f) => f.path));
    return files
      .filter((f) => /\.(mp4|mkv|webm)$/i.test(f.path))
      .map((video) => {
        const jpg = video.path.replace(/\.\w+$/, '.jpg');
        return { video, thumbUrl: jpgs.has(jpg) ? fileUrl(base, 'timelapse', jpg) : null };
      });
  }, [files, base]);

  return (
    <>
      <FlatList
        data={clips}
        keyExtractor={(c) => c.video.path}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.subtext} />
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>
              {error
                ? `${t('Error')}: ${error}`
                : connected
                  ? t('No timelapse videos yet')
                  : t('Not connected')}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.clipCard} onPress={() => setPlaying(item)}>
            {item.thumbUrl ? (
              <Image source={{ uri: item.thumbUrl }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <MaterialCommunityIcons name="video-outline" size={26} color={colors.subtext} />
              </View>
            )}
            <View style={styles.overlay}>
              <MaterialCommunityIcons name="play-circle" size={34} color="rgba(255,255,255,0.9)" />
            </View>
            <View style={styles.clipInfo}>
              <Text style={styles.clipName} numberOfLines={1}>
                {item.video.path}
              </Text>
              <View style={styles.clipMetaRow}>
                <Text style={styles.clipMeta}>
                  {formatSize(item.video.size)} · {fmtDate(item.video.modified)}
                </Text>
                <TouchableOpacity
                  style={styles.dlBtn}
                  onPress={() =>
                    Linking.openURL(fileUrl(base, 'timelapse', item.video.path)).catch(() => {})
                  }
                >
                  <MaterialCommunityIcons name="download" size={16} color={colors.text} />
                  <Text style={styles.dlText}>{t('Download')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal
        visible={!!playing}
        animationType="slide"
        onRequestClose={() => setPlaying(null)}
        supportedOrientations={['landscape', 'portrait']}
      >
        <View style={styles.playerContainer}>
          {playing && (
            <WebView
              source={{ html: playerHtml(fileUrl(base, 'timelapse', playing.video.path)) }}
              style={styles.player}
              originWhitelist={['*']}
              javaScriptEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              mixedContentMode="always"
            />
          )}
          <TouchableOpacity style={styles.closeBtn} onPress={() => setPlaying(null)}>
            <MaterialCommunityIcons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  clipCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: 160,
    backgroundColor: colors.cardAlt,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 62,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  clipInfo: {
    padding: spacing.md,
  },
  clipName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  clipMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  clipMeta: {
    color: colors.subtext,
    fontSize: 11,
  },
  dlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cardAlt,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  dlText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.xl * 2,
  },
  playerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  player: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeBtn: {
    position: 'absolute',
    top: 40,
    right: 16,
    backgroundColor: 'rgba(30,30,30,0.8)',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
