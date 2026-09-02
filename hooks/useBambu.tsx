// Bambu as a drop-in for MoonrakerProvider.
//
// It fills the same MoonrakerContext, so every consumer — the dashboard, the
// temperature cards, the filament slots, the console — works against a Bambu
// printer without knowing one exists. What arrives as MQTT JSON is reshaped
// into Klipper's vocabulary by services/bambuAdapter.ts.
//
// What Bambu genuinely cannot do is left honestly absent rather than faked:
// there are no macros, no printer objects to enumerate, and `rpc` rejects,
// because Moonraker's JSON-RPC has no counterpart here. File browsing needs
// FTPS and is not wired up yet.
// crabcore

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { bambuStatus } from '../services/bambuAdapter';
import {
  connectBambu,
  disconnectBambu,
  onBambuCameraStopped,
  onBambuMessage,
  onBambuState,
  pauseBambuPrint,
  requestBambuFullState,
  resumeBambuPrint,
  sendBambuGcode,
  setBambuChamberLight,
  startBambuCamera,
  stopBambuCamera,
  stopBambuPrint,
  BambuError,
} from '../services/bambuMqtt';
import { applyBambuReport, type BambuState } from '../services/bambuReport';
import {
  MoonrakerContext,
  type ConnectionState,
  type ConsoleLine,
  type MoonrakerContextValue,
} from './useMoonraker';
import { useSettings } from './useSettings';
import type { WebcamInfo } from '../services/moonraker';

/** Bambu deltas land about once a second, so no extra batching is needed. */
const CAMERA_RETRY_MS = 5000;
let lineIdCounter = 0;

/** Host without scheme or port — the transport dials an IP, not a URL. */
function bambuHost(url: string): string {
  return (url || '')
    .trim()
    .replace(/^\w+:\/\//, '')
    .replace(/[/:].*$/, '');
}

export function BambuProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const printer = settings.printers.find((p) => p.id === settings.activePrinterId);

  const host = bambuHost(printer?.url ?? '');
  const serial = (printer?.serialNumber ?? '').trim();
  const accessCode = (printer?.checkCode ?? '').trim();

  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [status, setStatus] = useState<Record<string, any>>({});
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [cameraUrl, setCameraUrl] = useState('');
  const [generation, setGeneration] = useState(0);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  const stateRef = useRef<BambuState>({});
  const appStateRef = useRef(AppState.currentState);

  const addLine = useCallback((type: ConsoleLine['type'], text: string) => {
    setConsoleLines((prev) => [...prev.slice(-499), { id: ++lineIdCounter, time: Date.now(), type, text }]);
  }, []);

  // The MQTT connection and its report stream.
  useEffect(() => {
    if (!host || !serial || !accessCode) {
      setConnection('disconnected');
      return;
    }

    let cancelled = false;
    setConnection('connecting');
    stateRef.current = {};

    const messages = onBambuMessage((report) => {
      const next = applyBambuReport(stateRef.current, report);
      stateRef.current = next.state;
      setStatus(bambuStatus(next.state));
    });

    const states = onBambuState((event) => {
      if (cancelled) return;
      setConnection(event.state === 'connected' ? 'connected' : 'disconnected');
      // A recovered link only carries deltas, so the held picture has to be
      // rebuilt from scratch or it silently keeps showing stale values.
      if (event.state === 'connected') void requestBambuFullState().catch(() => {});
    });

    connectBambu({ host, serial, accessCode })
      .then(() => {
        if (cancelled) return;
        setConnection('connected');
        return requestBambuFullState();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setConnection('disconnected');
        addLine('error', e instanceof BambuError ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      messages.remove();
      states.remove();
      void disconnectBambu();
    };
  }, [host, serial, accessCode, generation, addLine]);

  // The chamber camera is a separate socket with its own failure modes, so it
  // gets its own lifecycle rather than riding on the MQTT connection.
  useEffect(() => {
    if (!host || !serial || !accessCode || !appActive) {
      setCameraUrl('');
      return;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    let reported = false;
    // A stream that dies leaves the URL pointing at nothing, so treat it like
    // a failed open and go round again.
    const stopped = onBambuCameraStopped(() => {
      if (cancelled) return;
      setCameraUrl('');
      if (!retry) retry = setTimeout(open, CAMERA_RETRY_MS);
    });

    const open = () => {
      retry = null;
      startBambuCamera({ host, serial, accessCode })
        .then((url) => {
          if (!cancelled) setCameraUrl(url);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // The printer refuses a second viewer while Bambu Studio is watching,
          // so this retries rather than giving up — but staying silent about it
          // leaves a blank camera pane with nothing to diagnose, so say it once.
          if (!reported) {
            reported = true;
            addLine('error', `Camera: ${e instanceof BambuError ? e.message : String(e)}`);
          }
          retry = setTimeout(open, CAMERA_RETRY_MS);
        });
    };
    open();

    return () => {
      cancelled = true;
      stopped.remove();
      if (retry) clearTimeout(retry);
      void stopBambuCamera();
    };
  }, [host, serial, accessCode, appActive, addLine]);

  const reconnect = useCallback(() => setGeneration((n) => n + 1), []);

  // Android can freeze both sockets while backgrounded. Always replace the
  // MQTT session after a real background -> active transition; asking a
  // half-open connection for pushall can succeed locally while no report ever
  // comes back. appActive independently tears down/reopens the camera.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = next;
      const isActive = next === 'active';
      setAppActive(isActive);
      if (isActive && !wasActive) reconnect();
    });
    return () => sub.remove();
  }, [reconnect]);

  const webcams = useMemo<WebcamInfo[]>(
    () =>
      cameraUrl
        ? [
            {
              name: 'Chamber',
              enabled: true,
              service: 'mjpegstreamer',
              stream_url: cameraUrl,
              // Stills come from the loopback server's /frame endpoint, which
              // serves the newest buffered frame — no second printer connection.
              snapshot_url: cameraUrl.replace('/stream/', '/frame/'),
            },
          ]
        : [],
    [cameraUrl]
  );

  const sendGcode = useCallback(
    async (script: string): Promise<boolean> => {
      const cmd = script.trim();
      if (!cmd) return false;
      addLine('command', cmd);
      try {
        // The dashboard drives the chamber light with Klipper's SET_LED, which
        // Bambu does not implement — it has a dedicated ledctrl command. The
        // adapter presents the light as a Klipper LED, so this is where that
        // pretence has to be undone.
        const led = cmd.match(/^SET_LED\b.*?\b(?:WHITE|RED)=(\d+)/i);
        if (led) {
          await setBambuChamberLight(Number(led[1]) > 0);
          return true;
        }
        await sendBambuGcode(cmd);
        return true;
      } catch (e: any) {
        addLine('error', `!! ${e?.message ?? e}`);
        return false;
      }
    },
    [addLine]
  );

  /**
   * Bambu has no JSON-RPC. The print controls are mapped because the dashboard
   * drives them through Moonraker method names; everything else rejects, which
   * the callers already treat as "unsupported on this printer".
   */
  const rpc = useCallback(async (method: string): Promise<any> => {
    if (method === 'printer.print.pause') return pauseBambuPrint();
    if (method === 'printer.print.resume') return resumeBambuPrint();
    if (method === 'printer.print.cancel') return stopBambuPrint();
    throw new Error(`${method} is not available on Bambu printers`);
  }, []);

  const clearConsole = useCallback(() => setConsoleLines([]), []);

  const value = useMemo<MoonrakerContextValue>(
    () => ({
      connection,
      klippyState: connection === 'connected' ? 'ready' : 'disconnected',
      activeUrl: host ? `http://${host}` : '',
      status,
      consoleLines,
      // Bambu speaks MQTT, not Klipper, so there is no action:prompt protocol
      // to render and nothing to answer.
      prompt: null,
      answerPrompt: async () => {},
      dismissPrompt: async () => {},
      // Bambu exposes no macros and no object list to enumerate.
      macros: [],
      objectList: Object.keys(status),
      gcodeHelp: {},
      webcams,
      sendGcode,
      rpc,
      reconnect,
      clearConsole,
    }),
    [connection, host, status, consoleLines, webcams, sendGcode, rpc, reconnect, clearConsole]
  );

  return <MoonrakerContext.Provider value={value}>{children}</MoonrakerContext.Provider>;
}
