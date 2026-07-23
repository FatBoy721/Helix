import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as ScreenOrientation from 'expo-screen-orientation';
import { colors, spacing } from '../constants/theme';
import { cacheBustUrl, cameraSnapshotFileName } from '../services/cameraSnapshot';
import { useThemedAlert } from '../hooks/useThemedAlert';

export interface CameraStat {
  label: string;
  value: string;
}

interface Props {
  url: string; // fully resolved (see resolveCameraUrl)
  snapshotUrl?: string;
  height?: number;
  lightOn?: boolean;
  onToggleLight?: () => void;
  stats?: CameraStat[]; // print timing overlay, toggled via the chart button
  showControls?: boolean;
  paused?: boolean; // keeps the printer GUI mounted while stopping its snapshot polling
  // hero framing: let the parent own the border/rounding (e.g. full-bleed)
  chromeless?: boolean;
  radius?: number;
}

const WEBRTC_FIRST_FRAME_MESSAGE = 'helix:webrtc:first-frame';
const WEBRTC_PREVIEW_TIMEOUT_MS = 10_000;

const WEBRTC_FIRST_FRAME_SCRIPT = `
(function () {
  var sent = false;
  var watched = [];

  function notifyReady() {
    if (sent) return;
    sent = true;
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(${JSON.stringify(WEBRTC_FIRST_FRAME_MESSAGE)});
    }
  }

  function hasFrame(video) {
    return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
  }

  function watchVideo(video) {
    if (watched.indexOf(video) >= 0) return;
    watched.push(video);

    var check = function () {
      if (hasFrame(video)) notifyReady();
    };
    video.addEventListener('playing', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('resize', check);

    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(function () { notifyReady(); });
    }
    check();
  }

  function scan() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i += 1) watchVideo(videos[i]);
  }

  scan();
  var observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  var timer = setInterval(function () {
    if (sent) {
      clearInterval(timer);
      observer.disconnect();
      return;
    }
    scan();
    for (var i = 0; i < watched.length; i += 1) {
      if (hasFrame(watched[i])) {
        notifyReady();
        break;
      }
    }
  }, 100);
})();
true;
`;

// MJPEG streams can outpace mobile JPEG decoding, so the player keeps only the
// newest complete frame and reconnects when frames stop arriving.
// crabcore
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
        // Extract all complete frames but render only the newest one.
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

function buildScreenPlayerHtml(url: string): string {
  const base = url.replace(/\/?$/, '/');
  const snapshotUrl = `${base}snapshot`;
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden;}
#container{width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
img{max-width:100%;max-height:100%;cursor:crosshair;touch-action:none;}
#s{position:absolute;left:0;right:0;top:45%;color:#888;font-family:sans-serif;text-align:center;font-size:13px;display:none;}</style>
</head><body><div id="container"><img id="v"></div><div id="s"></div>
<script>
var img = document.getElementById('v');
var statusEl = document.getElementById('s');
var SRC = ${JSON.stringify(snapshotUrl)};
var loading = false;
var requestTimer = null;
var paused = window.__helixScreenPaused === true;
function bust(u) { return u + '?n=' + Date.now(); }
function setStatus(t) { statusEl.textContent = t; statusEl.style.display = t ? 'block' : 'none'; }
function finish(ok) {
  loading = false;
  if (requestTimer) { clearTimeout(requestTimer); requestTimer = null; }
  setStatus(paused || ok ? '' : 'reconnecting\\u2026');
}
function poll() {
  if (paused || loading) return;
  loading = true;
  requestTimer = setTimeout(function () { finish(false); }, 1000);
  img.src = bust(SRC);
}
img.onload = function () { finish(true); };
img.onerror = function () { finish(false); };
window.helixSetScreenPaused = function (nextPaused) {
  paused = nextPaused === true;
  window.__helixScreenPaused = paused;
  if (paused) {
    setStatus('');
    return;
  }
  poll();
};
setInterval(function () {
  if (!paused) poll();
}, 100);
if (!paused) poll();
function getImageCoords(clientX, clientY) {
  var rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height || !img.naturalWidth || !img.naturalHeight) return null;
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  var scaleX = img.naturalWidth / rect.width;
  var scaleY = img.naturalHeight / rect.height;
  return {
    x: Math.max(0, Math.min(img.naturalWidth - 1, Math.round((clientX - rect.left) * scaleX))),
    y: Math.max(0, Math.min(img.naturalHeight - 1, Math.round((clientY - rect.top) * scaleY)))
  };
}
var touchInFlight = false;
var pendingTouch = null;
async function flushTouch() {
  if (touchInFlight || !pendingTouch) return;
  var touch = pendingTouch;
  pendingTouch = null;
  touchInFlight = true;
  try {
    await fetch(
      ${JSON.stringify(`${base}touch`)} + '?a=' + touch.action + '&x=' + touch.x + '&y=' + touch.y,
      { method: 'POST' }
    );
  } catch (e) {}
  touchInFlight = false;
  flushTouch();
}
function sendTouch(action, x, y) {
  // Keep down/up ordering, but replace queued move events with the newest
  // coordinates so slow printer responses cannot build a stale touch backlog.
  pendingTouch = { action: action, x: x, y: y };
  flushTouch();
}
var lastPoint = null;
var dragging = false;
function onDown(clientX, clientY) {
  lastPoint = getImageCoords(clientX, clientY);
  dragging = lastPoint != null;
  if (lastPoint) sendTouch('down', lastPoint.x, lastPoint.y);
}
function onMove(clientX, clientY) {
  if (!dragging) return;
  var p = getImageCoords(clientX, clientY);
  if (p) {
    lastPoint = p;
    sendTouch('move', p.x, p.y);
  }
}
function onUp(clientX, clientY) {
  if (!dragging) return;
  dragging = false;
  var p = getImageCoords(clientX, clientY) || lastPoint;
  if (p) sendTouch('up', p.x, p.y);
  lastPoint = null;
}
img.addEventListener('mousedown', function (event) {
  event.preventDefault();
  onDown(event.clientX, event.clientY);
});
document.addEventListener('mousemove', function (event) {
  onMove(event.clientX, event.clientY);
});
document.addEventListener('mouseup', function (event) {
  onUp(event.clientX, event.clientY);
});
img.addEventListener('touchstart', function (event) {
  event.preventDefault();
  if (event.touches.length > 0) onDown(event.touches[0].clientX, event.touches[0].clientY);
}, { passive: false });
img.addEventListener('touchmove', function (event) {
  event.preventDefault();
  if (event.touches.length > 0) onMove(event.touches[0].clientX, event.touches[0].clientY);
}, { passive: false });
img.addEventListener('touchend', function (event) {
  event.preventDefault();
  if (event.changedTouches.length > 0) onUp(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
}, { passive: false });
img.addEventListener('touchcancel', function (event) {
  event.preventDefault();
  if (event.changedTouches.length > 0) onUp(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
}, { passive: false });
</script></body></html>`;
}

function snapshotSaveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/permission|unavailable|rejected/i.test(message)) {
    return 'Photo saving is unavailable in this Expo runtime. Test this in a development build or installed APK.';
  }
  return message || 'Could not save camera snapshot.';
}

export default function CameraFeed({
  url,
  snapshotUrl,
  height = 220,
  lightOn,
  onToggleLight,
  stats,
  showControls = true,
  paused = false,
  chromeless,
  radius,
}: Props) {
  const frame = [
    chromeless && styles.chromeless,
    radius != null && { borderRadius: radius },
  ];
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [readyPlayerKey, setReadyPlayerKey] = useState<string | null>(null);
  const [dismissedPreviewKey, setDismissedPreviewKey] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);
  const { showAlert, alertDialog } = useThemedAlert();

  // /webcam/webrtc and /screen/ serve their own player pages.
  const isRemoteScreen = /\/screen\/?($|\?)/i.test(url);
  const isWebrtcPage = /webrtc/i.test(url);
  const isSnapshot = /snapshot/i.test(url);

  // Same-origin baseUrl so the in-page fetch of the stream avoids CORS.
  const origin = useMemo(() => {
    const m = url.match(/^https?:\/\/[^/]+/i);
    return m ? m[0] : undefined;
  }, [url]);

  const html = useMemo(() => buildPlayerHtml(url, isSnapshot), [url, isSnapshot]);
  const screenHtml = useMemo(() => buildScreenPlayerHtml(url), [url]);
  const webViewSource = useMemo(
    () =>
      isWebrtcPage
        ? { uri: url }
        : { html: isRemoteScreen ? screenHtml : html, baseUrl: origin },
    [html, isRemoteScreen, isWebrtcPage, origin, screenHtml, url],
  );
  const screenPauseBootstrap = useMemo(
    () => `window.__helixScreenPaused = ${paused ? 'true' : 'false'}; true;`,
    [paused],
  );
  const playerKey = `${url}-${nonce}-${fullscreen ? 'fs' : 'card'}`;
  const previewUri = useMemo(
    () => (snapshotUrl ? cacheBustUrl(snapshotUrl) : undefined),
    [snapshotUrl, playerKey],
  );
  const liveFrameReady = readyPlayerKey === playerKey;
  const showSnapshotPreview =
    isWebrtcPage &&
    !!previewUri &&
    !liveFrameReady &&
    dismissedPreviewKey !== playerKey;

  useEffect(() => {
    if (!showSnapshotPreview) return;
    const timeout = setTimeout(() => {
      setDismissedPreviewKey(playerKey);
    }, WEBRTC_PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [playerKey, showSnapshotPreview]);

  const syncRemoteScreenPause = useCallback(() => {
    if (!isRemoteScreen) return;
    const nextPaused = paused ? 'true' : 'false';
    webViewRef.current?.injectJavaScript(`
      window.__helixScreenPaused = ${nextPaused};
      if (typeof window.helixSetScreenPaused === 'function') {
        window.helixSetScreenPaused(window.__helixScreenPaused);
      }
      true;
    `);
  }, [isRemoteScreen, paused]);

  useEffect(() => {
    syncRemoteScreenPause();
  }, [syncRemoteScreenPause]);

  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    if (event.nativeEvent.data === WEBRTC_FIRST_FRAME_MESSAGE) {
      setReadyPlayerKey(playerKey);
    }
  };

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

  const saveSnapshot = async () => {
    if (!snapshotUrl || savingSnapshot) return;
    setSavingSnapshot(true);
    let localUri = '';
    try {
      const available = await MediaLibrary.isAvailableAsync();
      if (!available) {
        showAlert({
          title: 'Photos unavailable',
          message: 'This device does not expose a media library.',
          icon: 'image-off-outline',
        });
        return;
      }

      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) throw new Error('No cache directory available.');
      const fileName = cameraSnapshotFileName();
      const target = `${cacheDir}${fileName}`;
      const freshUrl = cacheBustUrl(snapshotUrl);
      const result = await FileSystem.downloadAsync(freshUrl, target, {
        headers: { 'Cache-Control': 'no-store' },
      });
      localUri = result.uri;
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`Snapshot returned HTTP ${result.status}`);
      }

      await MediaLibrary.saveToLibraryAsync(result.uri);
      showAlert({
        title: 'Saved',
        message: 'Camera snapshot saved to Photos.',
        icon: 'check-circle',
      });
    } catch (e: unknown) {
      showAlert({
        title: 'Snapshot failed',
        message: snapshotSaveErrorMessage(e),
        icon: 'alert-circle-outline',
      });
    } finally {
      if (localUri) {
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      }
      setSavingSnapshot(false);
    }
  };

  if (!url.trim()) {
    return (
      <View style={[styles.card, { height }, styles.center, ...frame]}>
        <Text style={styles.placeholder}>No camera URL set</Text>
      </View>
    );
  }

  const feed = (
    <View style={styles.feedContainer}>
      <WebView
        ref={webViewRef}
        key={playerKey}
        source={webViewSource}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled={false}
        nestedScrollEnabled
        overScrollMode="never"
        javaScriptEnabled
        mixedContentMode="always"
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        injectedJavaScript={isWebrtcPage ? WEBRTC_FIRST_FRAME_SCRIPT : undefined}
        injectedJavaScriptBeforeContentLoaded={
          isRemoteScreen ? screenPauseBootstrap : undefined
        }
        onMessage={isWebrtcPage ? handleWebViewMessage : undefined}
        onLoadEnd={isRemoteScreen ? syncRemoteScreenPause : undefined}
      />
      {showSnapshotPreview && previewUri && (
        <View pointerEvents="none" style={styles.snapshotPreview}>
          <Image
            source={{ uri: previewUri }}
            style={styles.snapshotPreviewImage}
            resizeMode="contain"
            onError={() => setDismissedPreviewKey(playerKey)}
          />
          <View style={styles.liveStartingBadge}>
            <Text style={styles.liveStartingText}>Starting live camera…</Text>
          </View>
        </View>
      )}
    </View>
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
      {snapshotUrl && (
        <TouchableOpacity style={styles.ctrlBtn} onPress={saveSnapshot} disabled={savingSnapshot}>
          <MaterialCommunityIcons
            name={savingSnapshot ? 'progress-download' : 'camera-outline'}
            size={20}
            color={savingSnapshot ? colors.primary : colors.text}
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
      <View style={[styles.card, { height }, ...frame]}>
        {!fullscreen && feed}
        {!fullscreen && statsPanel}
        {!fullscreen && showControls && controls}
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
      {alertDialog}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#000',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  chromeless: {
    borderWidth: 0,
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
  feedContainer: {
    flex: 1,
  },
  snapshotPreview: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  snapshotPreviewImage: {
    width: '100%',
    height: '100%',
  },
  liveStartingBadge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    borderRadius: 6,
    backgroundColor: 'rgba(20,20,20,0.78)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  liveStartingText: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '600',
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
    borderRadius: 8,
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
