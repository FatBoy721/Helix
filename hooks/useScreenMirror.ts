// useScreenMirror — polls helixd's /api/screen/* endpoints for the AD5X
// touchscreen mirror, and forwards single taps.
//
// helixd runs on port 80 of the same host Moonraker uses. Capture is CPU-heavy
// on the printer (~125 ms/frame; JPEG quality barely changes that), so frames
// are chained from the previous frame's onLoad/onError — never a fixed timer,
// which would pile requests up on a slow device. During a print the cadence
// drops to ~1 fps to leave Klipper alone; the server separately refuses taps.
//
// To avoid the per-frame flicker of a single <Image> reloading, frames are
// double-buffered: `pendingUri` loads hidden on top of the committed frame,
// and is only promoted to `committedUri` once decoded — so the displayed image
// is never blank between frames.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from './useSettings';
import { printerConnectionUrl, resolveScreenApiUrl } from '../services/moonraker';

export interface ScreenInfo {
  width: number;
  height: number;
  touch_ok: boolean;
  print_state: string;
  touch_error?: string;
}

export interface TapError {
  /** HTTP status, or 0 for a network failure. */
  status: number;
  message: string;
  /** print_state echoed back by a 409 ("printing" / "paused"). */
  state?: string;
}

export interface TapResult {
  ok: boolean;
  status: number;
  x?: number;
  y?: number;
}

// Pure chaining: arm the next frame the instant the current one finishes
// (gap 0). Each frame costs the printer ~125 ms of CPU — that capture time is
// the rate limiter (~8 fps ceiling), not this gap. Adding a gap here would
// only stack on top of it and slow the mirror below the ceiling. inFlightRef
// still prevents overlap, so there's no pile-up on a slow device.
const IDLE_GAP_MS = 0;
// Klipper needs the CPU while printing — drop to ~1 fps.
const PRINTING_GAP_MS = 1000;
// After a failed fetch (printer offline / rebooting) back off so a dead host
// isn't hammered at 7 fps.
const ERROR_GAP_MS = 1500;
const INFO_POLL_MS = 5000;
// Watchdog. The frame chain is driven entirely by the pending <Image>'s
// onLoad/onError, and React Native fires NEITHER often enough to matter: a
// dropped decode on Android leaves inFlightRef stuck true, every later
// armFrame() returns at the guard, and the mirror is frozen on its last frame
// until the section is unmounted. Taps look dead too, because refresh() also
// routes through armFrame(). A capture measured ~180 ms on the AD5X, so 8 s is
// far beyond any healthy frame and only ever fires on a genuine stall.
const FRAME_TIMEOUT_MS = 8000;
const SNAPSHOT_QUALITY = 60;
const PRINT_STATES = new Set(['printing', 'paused']);
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;

function isThrottled(state: string | undefined): boolean {
  return !!state && PRINT_STATES.has(state);
}

export function useScreenMirror(active: boolean) {
  const { settings } = useSettings();

  const baseUrl = useMemo(() => {
    const activePrinter = settings.printers.find((p) => p.id === settings.activePrinterId);
    const moonrakerBase = activePrinter
      ? printerConnectionUrl(activePrinter)
      : settings.primaryUrl;
    return resolveScreenApiUrl(moonrakerBase);
  }, [settings.printers, settings.activePrinterId, settings.primaryUrl]);

  // committed = the frame currently shown; pending = the next frame loading on
  // top of it. Promotion happens only after the pending frame decodes.
  const [committedUri, setCommittedUri] = useState<string | null>(null);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ScreenInfo | null>(null);
  const [tapError, setTapError] = useState<TapError | null>(null);

  // Refs mirror state for use inside the polling loop and the async tap, so
  // the loop doesn't tear down/restart whenever a value it only reads changes.
  const activeRef = useRef(active);
  const baseUrlRef = useRef(baseUrl);
  const pendingRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const erroredRef = useRef(false);
  const boundsRef = useRef({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lets the watchdog reuse the error path without armFrame having to depend on
  // scheduleNext (which depends on armFrame).
  const onPendingErrorRef = useRef<() => void>(() => {});

  activeRef.current = active;
  baseUrlRef.current = baseUrl;

  const printState = info?.print_state;
  const throttled = isThrottled(printState);
  const width = info?.width ?? DEFAULT_WIDTH;
  const height = info?.height ?? DEFAULT_HEIGHT;
  boundsRef.current = { w: width, h: height };
  const touchOk = info ? info.touch_ok : true;
  const touchError = info?.touch_error ?? null;

  // Throttle is read via ref so scheduleNext stays referentially stable and
  // the frame loop never closes over a stale cadence.
  const throttledRef = useRef(throttled);
  throttledRef.current = throttled;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armFrame = useCallback(() => {
    const base = baseUrlRef.current;
    if (!activeRef.current || !base || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    seqRef.current += 1;
    // Cache-bust with a unique token: RN's Image dedupes by URI, so a fresh
    // query string is what actually forces a reload on every frame. The same
    // token is then reused as the committed URI, so promotion is a cache hit.
    const uri = `${base}/api/screen/snapshot?q=${SNAPSHOT_QUALITY}&t=${Date.now()}_${seqRef.current}`;
    pendingRef.current = uri;
    setPendingUri(uri);

    const seq = seqRef.current;
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      // Only fire for the frame this watchdog was armed for, and only if it is
      // still outstanding.
      if (seq !== seqRef.current || !inFlightRef.current) return;
      onPendingErrorRef.current();
    }, FRAME_TIMEOUT_MS);
  }, [clearWatchdog]);

  const scheduleNext = useCallback(() => {
    clearTimer();
    const gap = erroredRef.current
      ? ERROR_GAP_MS
      : throttledRef.current
        ? PRINTING_GAP_MS
        : IDLE_GAP_MS;
    timerRef.current = setTimeout(armFrame, gap);
  }, [armFrame, clearTimer]);

  // Wired to the pending <Image>'s onLoad. Promotes it to the committed slot
  // (cache hit, so the swap is instantaneous and flicker-free), then arms the
  // next frame. There is always at most one frame in flight.
  const onPendingLoaded = useCallback(() => {
    // The watchdog may already have written this frame off and re-armed; a late
    // decode must not promote a stale URI or reset the new frame's tracking.
    if (!inFlightRef.current) return;
    clearWatchdog();
    const uri = pendingRef.current;
    pendingRef.current = null;
    inFlightRef.current = false;
    erroredRef.current = false;
    setLoading(false);
    if (uri) {
      setCommittedUri(uri);
      setHasFrame(true);
    }
    setPendingUri(null);
    if (activeRef.current && baseUrlRef.current) scheduleNext();
  }, [scheduleNext, clearWatchdog]);

  const onPendingError = useCallback(() => {
    clearWatchdog();
    pendingRef.current = null;
    inFlightRef.current = false;
    erroredRef.current = true;
    setLoading(false);
    setPendingUri(null);
    if (activeRef.current && baseUrlRef.current) scheduleNext();
  }, [scheduleNext, clearWatchdog]);

  onPendingErrorRef.current = onPendingError;

  // Force the next frame immediately — used right after a tap so the mirror
  // reflects the result without waiting out the idle gap.
  const refresh = useCallback(() => {
    clearTimer();
    armFrame();
  }, [armFrame, clearTimer]);

  const fetchInfo = useCallback(async () => {
    const base = baseUrlRef.current;
    if (!base) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base}/api/screen/info`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return;
      const data = (await res.json()) as ScreenInfo;
      if (data && typeof data.width === 'number' && typeof data.height === 'number') {
        setInfo(data);
      }
    } catch {
      // Info is best-effort; the next poll retries.
    }
  }, []);

  // Lifecycle: (re)start when activated or when the printer host changes;
  // tear everything down when inactive so a backgrounded section isn't
  // loading the printer.
  useEffect(() => {
    if (!active || !baseUrl) {
      clearTimer();
      clearWatchdog();
      inFlightRef.current = false;
      setLoading(false);
      return;
    }
    setHasFrame(false);
    erroredRef.current = false;
    inFlightRef.current = false;
    void fetchInfo();
    armFrame();
    const infoTimer = setInterval(fetchInfo, INFO_POLL_MS);
    return () => {
      clearTimer();
      clearWatchdog();
      clearInterval(infoTimer);
      inFlightRef.current = false;
      setLoading(false);
    };
  }, [active, baseUrl, armFrame, clearTimer, clearWatchdog, fetchInfo]);

  const tap = useCallback(async (x: number, y: number, force = false): Promise<TapResult> => {
    const base = baseUrlRef.current;
    if (!base) return { ok: false, status: 0 };
    const { w, h } = boundsRef.current;
    const cx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(y)));
    try {
      const res = await fetch(`${base}/api/screen/tap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: cx, y: cy, force }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        x?: number;
        y?: number;
        error?: string;
        state?: string;
      };
      if (res.ok) {
        setTapError(null);
        return { ok: true, status: 200, x: data.x ?? cx, y: data.y ?? cy };
      }
      if (res.status === 409) {
        setTapError({ status: 409, message: 'Taps are blocked while printing', state: data.state });
      } else {
        setTapError({ status: res.status, message: data.error || `Tap failed (HTTP ${res.status})` });
      }
      return { ok: false, status: res.status };
    } catch {
      setTapError({ status: 0, message: 'Network error — is the printer reachable?' });
      return { ok: false, status: 0 };
    }
  }, []);

  const clearTapError = useCallback(() => setTapError(null), []);

  return {
    baseUrl,
    committedUri,
    pendingUri,
    hasFrame,
    loading,
    info,
    printState: printState ?? 'standby',
    throttled,
    touchOk,
    touchError,
    tapError,
    clearTapError,
    tap,
    refresh,
    onPendingLoaded,
    onPendingError,
    width,
    height,
  };
}
