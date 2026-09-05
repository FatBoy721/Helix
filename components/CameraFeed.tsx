import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

const SNAPSHOT_POLL_MS = 250;

// RN's native Image component (RCTImageLoader, NSURLSession-backed) gets
// blocked by ATS on some networks (observed over Tailscale/CGNAT addresses)
// even with NSAllowsArbitraryLoads set — but expo-file-system's downloadAsync
// (a different native networking path, the same one the rest of the app's
// HTTP calls use) does not hit that block. So each frame is downloaded to a
// local file via downloadAsync and displayed with a plain Image, instead of
// polling <Image source={{uri: httpUrl}}> directly or paying WebView's much
// heavier per-frame decode/layout cost.
function NativeSnapshotFeed({
  url,
  paused,
  resetKey,
}: {
  url: string;
  paused: boolean;
  resetKey: string;
}) {
  const [failed, setFailed] = useState(false);
  const [displayedUri, setDisplayedUri] = useState<string | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setFailed(false);
    setDisplayedUri(null);
    const stale = prevPathRef.current;
    prevPathRef.current = null;
    if (stale) FileSystem.deleteAsync(stale, { idempotent: true }).catch(() => {});
  }, [resetKey]);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || inFlightRef.current) return;
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) return;
      inFlightRef.current = true;
      const targetPath = `${cacheDir}helix-snap-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      try {
        const result = await FileSystem.downloadAsync(cacheBustUrl(url), targetPath, {
          headers: { 'Cache-Control': 'no-store' },
        });
        if (cancelled) {
          FileSystem.deleteAsync(targetPath, { idempotent: true }).catch(() => {});
          return;
        }
        if (result.status >= 200 && result.status < 300) {
          setFailed(false);
          setDisplayedUri(result.uri);
          const previous = prevPathRef.current;
          prevPathRef.current = targetPath;
          if (previous) FileSystem.deleteAsync(previous, { idempotent: true }).catch(() => {});
        } else {
          setFailed(true);
          FileSystem.deleteAsync(targetPath, { idempotent: true }).catch(() => {});
        }
      } catch {
        if (!cancelled) setFailed(true);
        FileSystem.deleteAsync(targetPath, { idempotent: true }).catch(() => {});
      } finally {
        inFlightRef.current = false;
      }
    };

    poll();
    const timer = setInterval(poll, SNAPSHOT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url, paused, resetKey]);

  return (
    <View style={styles.webview}>
      {displayedUri && (
        <Image source={{ uri: displayedUri }} style={styles.snapshotImage} resizeMode="contain" />
      )}
      {failed && <Text style={styles.reconnecting}>reconnecting…</Text>}
    </View>
  );
}

const WEBRTC_FIRST_FRAME_MESSAGE = 'helix:webrtc:first-frame';
const LIVE_PREVIEW_TIMEOUT_MS = 15_000;

// camera-streamer serves stream.mjpg at the full sensor rate — measured on a
// U1 at ~30fps of 184KB frames, i.e. 5.5MB/s (44Mbit/s). The `target_fps` in
// Moonraker's webcam record is advertisement only; stream.mjpg ignores it and
// honours just this query parameter. On the U1's 2.4GHz link that unthrottled
// stream saturates the uplink, backs ~2.5MB up in nginx's send queue, and puts
// every other request behind it — Moonraker polls, SET_LED, the printer's own
// touchscreen.
//
// 20 is measured, not guessed. Sweeping fps against ping on a U1 (idle
// baseline ~10ms):
//
//   fps=15 -> 2.13MB/s,  7.5ms      fps=25 -> 2.80MB/s, 26.6ms
//   fps=20 -> 2.80MB/s,  9.5ms      fps=30 -> 3.87MB/s, 34.4ms
//   uncapped -> 5.51MB/s, 350ms
//
// 25 returns the same bitrate as 20 - the sensor tops out near 20 at this
// frame size - so asking for more yields no extra frames and only buys
// queueing delay. 20 is the last setting that still streams at the idle
// latency baseline.
const MJPEG_BRIDGE_FPS = 20;

function resolveMjpegBridgeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/\/webcam\/webrtc\/?$/i.test(parsed.pathname)) return undefined;
    parsed.pathname = '/webcam/stream.mjpg';
    parsed.search = `?fps=${MJPEG_BRIDGE_FPS}`;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

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

// WKWebView's fetch() resolves fine against a chunked multipart/x-mixed-replace
// (MJPEG) response but throws "Load failed" the moment response.body.getReader()
// is actually read — confirmed by instrumenting it: fetch resolves 200 OK with
// a body in ~1s, then the reader throws immediately, every attempt, regardless
// of how long a timeout is given. So the continuous feed does NOT go through
// fetch/ReadableStream at all. Instead it relies on WebKit's own native decoder
// for multipart/x-mixed-replace, which a plain <img src="..."> triggers
// directly (long-documented Safari/WebKit behavior for MJPEG IP-camera
// streams) — the browser keeps that one <img> updating in place as new parts
// arrive, no JS per-frame parsing loop needed.
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
var stopped = false;
var readySent = false;
var snapshotTimer = null;
var reloadTimer = null;
var readyPoll = null;

function setStatus(t) {
  statusEl.textContent = t;
  statusEl.style.display = t ? 'block' : 'none';
}

function bust(u) {
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'n=' + Date.now();
}

function notifyReady() {
  if (readySent) return;
  readySent = true;
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(${JSON.stringify(WEBRTC_FIRST_FRAME_MESSAGE)});
  }
}

function snapshotLoop() {
  img.onload = function () { notifyReady(); setStatus(''); };
  img.onerror = function () { setStatus('reconnecting\\u2026'); };
  snapshotTimer = setInterval(function () { img.src = bust(SRC); }, 700);
  img.src = bust(SRC);
}

function liveLoop() {
  // A multipart/x-mixed-replace img does NOT reliably fire onload per frame —
  // the browser keeps one request open and swaps decoded parts into the same
  // element. Waiting on onload therefore never fires the first-frame message,
  // the "Starting live camera…" snapshot overlay never lifts, and a working
  // stream sits hidden behind one stale still (which is what "camera frozen"
  // actually was). Poll naturalWidth instead: non-zero means a part decoded.
  readyPoll = setInterval(function () {
    if (img.naturalWidth > 0) {
      clearInterval(readyPoll);
      notifyReady();
      setStatus('');
    }
  }, 250);
  img.onload = function () { notifyReady(); setStatus(''); };
  img.onerror = function () {
    setStatus('reconnecting\\u2026');
    if (stopped) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () { img.src = bust(SRC); }, 800);
  };
  // No cache-busting query here: the native multipart decoder keeps this one
  // request open and streams frames into it, it does not re-fetch per frame.
  img.src = SRC;
}

function stopPlayer() {
  stopped = true;
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (reloadTimer) clearTimeout(reloadTimer);
  if (readyPoll) clearInterval(readyPoll);
}

window.addEventListener('pagehide', stopPlayer);
window.addEventListener('beforeunload', stopPlayer);

if (SNAPSHOT) snapshotLoop(); else liveLoop();
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
// Polling the printer's screen service too fast overloads its touchscreen
// (the physical panel can freeze). Idle gently; burst briefly after a touch
// so the mirror reflects taps/drags, then back off.
var IDLE_MS = 1500, FAST_MS = 160, FAST_WINDOW_MS = 2500;
var fastUntil = 0, lastPoll = 0;
function armFastBurst() { fastUntil = Date.now() + FAST_WINDOW_MS; }
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
  armFastBurst();
  lastPoll = Date.now();
  poll();
};
function adaptiveTick() {
  if (paused) return;
  var now = Date.now();
  var gap = now < fastUntil ? FAST_MS : IDLE_MS;
  if (now - lastPoll >= gap) { lastPoll = now; poll(); }
}
setInterval(adaptiveTick, 100);
if (!paused) { lastPoll = Date.now(); poll(); }
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
  armFastBurst();
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
  const insets = useSafeAreaInsets();
  const frame = [
    chromeless && styles.chromeless,
    radius != null && { borderRadius: radius },
  ];
  const [nonce, setNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [readyPlayerKey, setReadyPlayerKey] = useState<string | null>(null);
  const [snapshotFallbackKey, setSnapshotFallbackKey] = useState<string | null>(null);
  const [screenFocused, setScreenFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const webViewRef = useRef<WebView>(null);
  const { showAlert, alertDialog } = useThemedAlert();
  const streamPaused = paused || !screenFocused || !appActive;

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  // /webcam/webrtc and /screen/ serve their own player pages.
  const isRemoteScreen = /\/screen\/?($|\?)/i.test(url);
  const isWebrtcPage = /webrtc/i.test(url);
  const isSnapshot = /snapshot/i.test(url);

  // Same-origin baseUrl so the in-page fetch of the stream avoids CORS.
  const origin = useMemo(() => {
    const m = url.match(/^https?:\/\/[^/]+/i);
    return m ? m[0] : undefined;
  }, [url]);

  // Android WebView cannot reliably establish the U1's WebRTC page because
  // its sandbox may deny network-interface enumeration during ICE, so it
  // bridges to the printer's MJPEG rendition instead. That rendition is NOT
  // throttled by the printer (see MJPEG_BRIDGE_FPS) — it has to be capped
  // here, or it takes the whole LAN link down with it. iOS is unaffected:
  // WKWebView has solid native WebRTC support and does not hit the Android
  // ICE issue, so it loads the real WebRTC page, which is rate-controlled.
  const mjpegBridgeUrl = useMemo(
    () => (isWebrtcPage && Platform.OS === 'android' ? resolveMjpegBridgeUrl(url) : undefined),
    [isWebrtcPage, url],
  );
  const html = useMemo(
    () => buildPlayerHtml(mjpegBridgeUrl ?? url, isSnapshot),
    [isSnapshot, mjpegBridgeUrl, url],
  );
  const screenHtml = useMemo(() => buildScreenPlayerHtml(url), [url]);
  const webViewSource = useMemo(
    () =>
      isWebrtcPage && !mjpegBridgeUrl
        ? { uri: url }
        : { html: isRemoteScreen ? screenHtml : html, baseUrl: origin },
    [html, isRemoteScreen, isWebrtcPage, mjpegBridgeUrl, origin, screenHtml, url],
  );
  const screenPauseBootstrap = useMemo(
    () => `window.__helixScreenPaused = ${streamPaused ? 'true' : 'false'}; true;`,
    [streamPaused],
  );
  const playerKey = `${url}-${nonce}-${fullscreen ? 'fs' : 'card'}`;
  const previewUri = useMemo(
    () => (snapshotUrl ? cacheBustUrl(snapshotUrl) : undefined),
    [snapshotUrl, playerKey],
  );
  const liveFrameReady = readyPlayerKey === playerKey;
  const useSnapshotFallback =
    isWebrtcPage && !!snapshotUrl && !liveFrameReady && snapshotFallbackKey === playerKey;
  const showSnapshotPreview =
    isWebrtcPage &&
    !!previewUri &&
    !liveFrameReady &&
    !useSnapshotFallback;

  useEffect(() => {
    if (!showSnapshotPreview) return;
    const timeout = setTimeout(() => {
      setSnapshotFallbackKey(playerKey);
    }, LIVE_PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [playerKey, showSnapshotPreview]);

  const syncRemoteScreenPause = useCallback(() => {
    if (!isRemoteScreen) return;
    const nextPaused = streamPaused ? 'true' : 'false';
    webViewRef.current?.injectJavaScript(`
      window.__helixScreenPaused = ${nextPaused};
      if (typeof window.helixSetScreenPaused === 'function') {
        window.helixSetScreenPaused(window.__helixScreenPaused);
      }
      true;
    `);
  }, [isRemoteScreen, streamPaused]);

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

  // Snapshot-only feeds skip WebView entirely. U1 WebRTC URLs are bridged to
  // continuous MJPEG; the advertised snapshot remains the bounded last resort
  // if neither that bridge nor a direct WebRTC page produces a frame.
  const feed = (
    <View style={styles.feedContainer}>
      {snapshotUrl &&
      ((!isRemoteScreen && !isWebrtcPage && isSnapshot) || useSnapshotFallback) ? (
        <NativeSnapshotFeed url={snapshotUrl} paused={streamPaused} resetKey={playerKey} />
      ) : (
      <>
      {isRemoteScreen || !streamPaused ? (
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
          injectedJavaScript={
            isWebrtcPage && !mjpegBridgeUrl ? WEBRTC_FIRST_FRAME_SCRIPT : undefined
          }
          injectedJavaScriptBeforeContentLoaded={
            isRemoteScreen ? screenPauseBootstrap : undefined
          }
          onMessage={isWebrtcPage ? handleWebViewMessage : undefined}
          onLoadEnd={isRemoteScreen ? syncRemoteScreenPause : undefined}
        />
      ) : (
        <View style={[styles.webview, styles.center]}>
          <Text style={styles.placeholder}>Camera paused</Text>
        </View>
      )}
      {!streamPaused && showSnapshotPreview && previewUri && (
        <View pointerEvents="none" style={styles.snapshotPreview}>
          <Image
            source={{ uri: previewUri }}
            style={styles.snapshotPreviewImage}
            resizeMode="contain"
            onError={() => setSnapshotFallbackKey(playerKey)}
          />
          <View style={styles.liveStartingBadge}>
            <Text style={styles.liveStartingText}>Starting live camera…</Text>
          </View>
        </View>
      )}
      </>
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
      {!fullscreen ? (
        <TouchableOpacity style={styles.ctrlBtn} onPress={openFullscreen}>
          <MaterialCommunityIcons name="fullscreen" size={20} color={colors.text} />
        </TouchableOpacity>
      ) : null}
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
          <TouchableOpacity
            style={[styles.fullscreenClose, { top: insets.top + 12 }]}
            hitSlop={10}
            onPress={closeFullscreen}
          >
            <MaterialCommunityIcons name="close" size={21} color={colors.text} />
          </TouchableOpacity>
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
  snapshotImage: {
    width: '100%',
    height: '100%',
  },
  snapshotImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  // Hidden but mounted so the frame decodes before it is shown.
  preloaderImage: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  reconnecting: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    color: colors.subtext,
    fontSize: 13,
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
  fullscreenClose: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
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
