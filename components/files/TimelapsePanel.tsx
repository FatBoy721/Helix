// Timelapse, in the Shelf/Cockpit language.
//
// The old view was a flat list of equal cards, which made a 40-clip library
// impossible to date-scan. Changes here mirror HistoryPanel so the three Files
// segments read as one screen:
//   - clips group by day, newest first
//   - the poster is the card, with the metadata as a footer strip rather than
//     a separate block, so the frame is the thing you scan
//   - a summary strip up top, because timelapses are usually what has filled
//     the printer's SD card
import React, { useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COCKPIT as P, alpha } from '../dashboard/shared';
import { dayLabel } from '../../hooks/usePrintHistory';
import { t } from '../../services/i18n';
import {
  formatBytes,
  useTimelapses,
  type TimelapseClip,
} from '../../hooks/useTimelapses';

const PAGE = 16;

// Plain <video> pointed at Moonraker's file endpoint. The printer serves mp4
// with range support, so seeking works without downloading the whole clip.
function playerHtml(src: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;display:flex;align-items:center;}
video{width:100%;max-height:100%;}</style></head>
<body><video src="${src}" controls autoplay playsinline></video></body></html>`;
}

function clipTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function TimelapsePanel({ base, connected }: { base: string; connected: boolean }) {
  const library = useTimelapses(base, connected);
  const [playing, setPlaying] = useState<TimelapseClip | null>(null);

  const sections = groupByDay(library.clips);

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(clip) => clip.path}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={library.loading}
            onRefresh={library.refresh}
            tintColor={P.dim}
          />
        }
        ListHeaderComponent={
          library.clips.length > 0 ? (
            <View style={styles.summary}>
              <MaterialCommunityIcons name="movie-open-outline" size={16} color={P.accent} />
              <Text style={styles.summaryText}>
                {library.clips.length} {t(library.clips.length === 1 ? 'clip' : 'clips')}
              </Text>
              <Text style={styles.summaryDot}>·</Text>
              <Text style={styles.summaryText}>
                {formatBytes(library.totalBytes)} {t('on the printer')}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          library.loading ? null : (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={connected ? 'movie-off-outline' : 'lan-disconnect'}
                size={30}
                color={P.dim}
              />
              <Text style={styles.emptyText}>
                {!connected
                  ? t('Not connected to the printer.')
                  : library.error
                    ? library.error
                    : t('No timelapses yet. Enable the timelapse camera when you start a print.')}
              </Text>
            </View>
          )
        }
        renderSectionHeader={({ section }) => <Text style={styles.dayLabel}>{section.title}</Text>}
        renderItem={({ item }) => (
          <ClipCard clip={item} onPlay={() => setPlaying(item)} />
        )}
      />

      <PlayerModal clip={playing} onClose={() => setPlaying(null)} />
    </>
  );
}

function groupByDay(clips: TimelapseClip[]): { title: string; data: TimelapseClip[] }[] {
  const out: { title: string; data: TimelapseClip[] }[] = [];
  for (const clip of clips) {
    const title = dayLabel(clip.modified);
    const last = out[out.length - 1];
    if (last && last.title === title) last.data.push(clip);
    else out.push({ title, data: [clip] });
  }
  return out;
}

function ClipCard({ clip, onPlay }: { clip: TimelapseClip; onPlay: () => void }) {
  return (
    <Pressable onPress={onPlay} style={({ pressed }) => [styles.card, pressed && { opacity: 0.82 }]}>
      <View style={styles.posterWrap}>
        {clip.posterUrl ? (
          <Image source={{ uri: clip.posterUrl }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]}>
            <MaterialCommunityIcons name="video-outline" size={28} color={P.dim} />
          </View>
        )}
        <View style={styles.playBadge}>
          <MaterialCommunityIcons name="play" size={24} color={P.onAccent} />
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={1}>
            {clip.name}
          </Text>
          <Text style={styles.cardMeta}>
            {formatBytes(clip.size)} · {clipTime(clip.modified)}
          </Text>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => {
            void Linking.openURL(clip.videoUrl).catch(() => {});
          }}
          style={({ pressed }) => [styles.download, pressed && { opacity: 0.7 }]}
        >
          <MaterialCommunityIcons name="download" size={17} color={P.accent} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function PlayerModal({ clip, onClose }: { clip: TimelapseClip | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={clip !== null}
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={['landscape', 'portrait']}
    >
      <View style={styles.player}>
        {clip ? (
          <WebView
            source={{ html: playerHtml(clip.videoUrl) }}
            style={styles.playerWeb}
            originWhitelist={['*']}
            javaScriptEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mixedContentMode="always"
          />
        ) : null}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={[styles.playerClose, { top: insets.top + 12 }]}
        >
          <MaterialCommunityIcons name="close" size={21} color={P.text} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: PAGE, paddingBottom: 40, gap: 10 },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    height: 42,
    borderRadius: 999,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  summaryText: { color: P.dim, fontSize: 12, fontWeight: '700' },
  summaryDot: { color: P.dim, fontSize: 12 },

  dayLabel: {
    color: P.dim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
  },

  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: alpha(P.border, 0.8),
  },
  posterWrap: { justifyContent: 'center', alignItems: 'center' },
  poster: { width: '100%', aspectRatio: 16 / 9, backgroundColor: P.surfaceAlt },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(P.accent, 0.92),
  },

  cardBody: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11 },
  cardInfo: { flex: 1, gap: 2 },
  cardName: { color: P.text, fontSize: 13, fontWeight: '800' },
  cardMeta: { color: P.dim, fontSize: 11, fontWeight: '600' },
  download: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(P.accent, 0.14),
    borderWidth: 1,
    borderColor: alpha(P.accent, 0.4),
  },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 60, paddingHorizontal: 24 },
  emptyText: { color: P.dim, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  player: { flex: 1, backgroundColor: '#000' },
  playerWeb: { flex: 1, backgroundColor: '#000' },
  playerClose: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha('#000000', 0.66),
    borderWidth: 1,
    borderColor: P.border,
  },
});
