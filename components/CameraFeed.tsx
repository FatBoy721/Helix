import React, { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { colors, spacing } from '../constants/theme';

export interface CameraStat {
  label: string;
  value: string;
}

interface Props {
  url: string; // fully resolved (see resolveCameraUrl)
  height?: number;
  lightOn?: boolean;
  onToggleLight?: () => void;
  stats?: CameraStat[]; // print timing overlay, toggled via the chart button
}

// MJPEG player, take 3.
// take 1 was <img src=stream> — froze whenever camera-streamer dropped the
// connection and just sat there showing a stale frame forever.
// take 2 parsed the stream manually but rendered every frame, which lagged
// further and further behind live because the phone decodes slower than
// ~17fps of 276KB jpegs arrive.
// this version parses the multipart stream, only renders the NEWEST frame,
// and a watchdog kills + reconnects the fetch if nothing arrives for 6s.
function buildPlayerHtml(url: string, snapshotMode: boolean): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden;}
img{width:100%;height:100%;object-fit:contain;display:block;}
#s{position:absolute;left:0;right:0;top:45%;color:#888;font-family:sans-serif;text-align:center;font-size:13px;display:none;}</style>
</head><body>
<img id="v">
<div id="s"></div>
<script>
var SRC = ${JSON.stringify(url)};
var SNAPSHOT = ${snapshotMode ? 'true' : 'false'};
var img = document.getElementById('v');
var statusEl = document.getElementById('s');
var lastFrame = 0;
var controller = null;
var prevUrl = null;

function setStatus(t) {
  statusEl.textContent = t;
  statusEl.style.display = t ? 'block' : 'none';
}

function bust(u) {
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'n=' + Date.now();
}

function showFrame(bytes) {
  lastFrame = Date.now();
  setStatus('');
  var blob = new Blob([bytes], { type: 'image/jpeg' });
  var u = URL.createObjectURL(blob);
  img.onload = function () {
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    prevUrl = u;
  };
  img.src = u;
}

function findMarker(b, second, from) {
  for (var i = from; i < b.length - 1; i++) {
    if (b[i] === 0xFF && b[i + 1] === second) return i;
  }
  return -1;
}

async function streamLoop() {
  for (;;) {
    controller = new AbortController();
    try {
      var res = await fetch(bust(SRC), { cache: 'no-store', signal: controller.signal });
      if (!res.ok || !res.body) throw new Error('http ' + res.status);
      var reader = res.body.getReader();
      var buf = new Uint8Array(0);
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        var nb = new Uint8Array(buf.length + r.value.length);
        nb.set(buf, 0);
        nb.set(r.value, buf.length);
        buf = nb;
        // Frame skip: extract ALL complete frames in the buffer but render
        // only the newest — dropping stale frames keeps the view live when
        // the phone decodes slower than frames arrive.
        var latest = null;
        for (;;) {
          var soi = findMarker(buf, 0xD8, 0);
          if (soi < 0) {
            if (buf.length > 2000000) buf = new Uint8Array(0);
            break;
          }
          var eoi = findMarker(buf, 0xD9, soi + 2);
          if (eoi < 0) {
            if (soi > 0) buf = buf.slice(soi);
            break;
          }
          latest = buf.slice(soi, eoi + 2);
          buf = buf.slice(eoi + 2);
        }
        if (latest) showFrame(latest);
      }
    } catch (e) {}
    setStatus('reconnecting\\u2026');
    await new Promise(function (r) { setTimeout(r, 800); });
  }
}

function snapshotLoop() {
  img.onload = function () { lastFrame = Date.now(); setStatus(''); };
  img.onerror = function () { setStatus('reconnecting\\u2026'); };
  setInterval(function () { img.src = bust(SRC); }, 700);
  img.src = bust(SRC);
}

// Watchdog: no frame for 6s -> kill the fetch, loop reconnects.
setInterval(function () {
  if (!SNAPSHOT && lastFrame && Date.now() - lastFrame > 6000 && controller) {
    try { controller.abort(); } catch (e) {}
  }
}, 2000);

// Coming back from background: force a fresh connection immediately.
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && !SNAPSHOT && Date.now() - lastFrame > 3000 && controller) {
    try { controller.abort(); } catch (e) {}
  }
});

if (SNAPSHOT) snapshotLoop(); else streamLoop();
</script>
</body></html>`;
}

export default function CameraFeed({
  url,
  height = 220,
  lightOn,
  onToggleLight,
  stats,
}: Props) {
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // /webcam/webrtc serves its own player page so just load it as-is. same for
  // /screen/ — the firmware's built-in remote screen view (iframe service).
  // btw /webcam/stream straight up 404s on PAXX, cost me an evening
  const isWebrtcPage = /webrtc|\/screen\/?($|\?)/i.test(url);
  const isSnapshot = /snapshot/i.test(url);

  // Same-origin baseUrl so the in-page fetch of the stream avoids CORS.
  const origin = useMemo(() => {
    const m = url.match(/^https?:\/\/[^/]+/i);
    return m ? m[0] : undefined;
  }, [url]);

  const html = useMemo(() => buildPlayerHtml(url, isSnapshot), [url, isSnapshot]);

  const openFullscreen = async () => {
    setFullscreen(true);
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch {
      // orientation lock unavailable (web) — modal still opens
    }
  };

  const closeFullscreen = async () => {
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {}
    setFullscreen(false);
  };

  if (!url.trim()) {
    return (
      <View style={[styles.card, { height }, styles.center]}>
        <Text style={styles.placeholder}>No camera URL set</Text>
      </View>
    );
  }

  const feed = (
    <WebView
      key={`${url}-${nonce}-${fullscreen ? 'fs' : 'card'}`}
      source={isWebrtcPage ? { uri: url } : { html, baseUrl: origin }}
      style={styles.webview}
      originWhitelist={['*']}
      scrollEnabled={false}
      javaScriptEnabled
      mixedContentMode="always"
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
    />
  );

  const controls = (
    <View style={fullscreen ? styles.controlsFullscreen : styles.controls}>
      {stats && stats.length > 0 && (
        <TouchableOpacity style={styles.ctrlBtn} onPress={() => setShowStats((s) => !s)}>
          <MaterialCommunityIcons
            name="chart-box-outline"
            size={20}
            color={showStats ? colors.primary : colors.text}
          />
        </TouchableOpacity>
      )}
      {onToggleLight && (
        <TouchableOpacity style={styles.ctrlBtn} onPress={onToggleLight}>
          <MaterialCommunityIcons
            name={lightOn ? 'lightbulb-on' : 'lightbulb-outline'}
            size={20}
            color={lightOn ? colors.warning : colors.text}
          />
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.ctrlBtn} onPress={() => setNonce((n) => n + 1)}>
        <MaterialCommunityIcons name="refresh" size={20} color={colors.text} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.ctrlBtn}
        onPress={fullscreen ? closeFullscreen : openFullscreen}
      >
        <MaterialCommunityIcons
          name={fullscreen ? 'fullscreen-exit' : 'fullscreen'}
          size={20}
          color={colors.text}
        />
      </TouchableOpacity>
    </View>
  );

  const statsPanel =
    showStats && stats && stats.length > 0 ? (
      <View style={fullscreen ? styles.statsPanelFullscreen : styles.statsPanel}>
        {stats.map((s) => (
          <View key={s.label} style={styles.statRow}>
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={styles.statValue}>{s.value}</Text>
          </View>
        ))}
      </View>
    ) : null;

  return (
    <>
      <View style={[styles.card, { height }]}>
        {!fullscreen && feed}
        {!fullscreen && statsPanel}
        {!fullscreen && controls}
      </View>

      <Modal
        visible={fullscreen}
        animationType="fade"
        onRequestClose={closeFullscreen}
        supportedOrientations={['landscape', 'portrait']}
        statusBarTranslucent
      >
        <View style={styles.fullscreenContainer}>
          {fullscreen && feed}
          {statsPanel}
          {controls}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#000',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    color: colors.subtext,
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  controls: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  controlsFullscreen: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.xl,
    flexDirection: 'row',
    gap: spacing.md,
  },
  ctrlBtn: {
    backgroundColor: 'rgba(30,30,30,0.8)',
    borderRadius: 16,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  statsPanel: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(20,20,20,0.82)',
    borderRadius: 8,
    padding: spacing.sm,
    minWidth: 190,
  },
  statsPanelFullscreen: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    backgroundColor: 'rgba(20,20,20,0.82)',
    borderRadius: 8,
    padding: spacing.md,
    minWidth: 220,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 1,
  },
  statLabel: {
    color: colors.subtext,
    fontSize: 11,
  },
  statValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
});
