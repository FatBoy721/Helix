import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  discoverHelixdRemoteBase,
  helixdLanBaseUrl,
  helixdRemoteMoonrakerUrl,
  isTailscaleUrl,
  normalizeBaseUrl,
  normalizeMoonrakerUrl,
  WebcamInfo,
  wsUrl,
} from '../services/moonraker';
import {
  PROMPT_DISMISS_GCODE,
  reducePromptLine,
  visiblePrompt,
  type KlipperPrompt,
  type PromptBuildState,
} from '../services/klipperPrompt';
import { notifyEvent } from '../services/notifications';
import {
  historyFailureMessage,
  terminalPrintStateForHistory,
} from '../services/notificationEvents';
import { Settings, useSettings } from './useSettings';
import { formatTemperature } from '../services/temperature';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface ConsoleLine {
  id: number;
  time: number;
  type: 'command' | 'response' | 'error';
  text: string;
}

/**
 * The shape every transport must present. Moonraker is one implementation;
 * hooks/useBambu.tsx is another, for printers that do not speak Moonraker at
 * all. Consumers only ever see this interface, which is why adding Bambu needed
 * no changes to the dashboard.
 */
export interface MoonrakerContextValue {
  connection: ConnectionState;
  klippyState: string;
  activeUrl: string;
  /** Same-route HTTP origin for camera/screen traffic when it differs from Moonraker. */
  proxyUrl?: string;
  status: Record<string, any>;
  consoleLines: ConsoleLine[];
  macros: string[];
  objectList: string[];
  gcodeHelp: Record<string, string>;
  webcams: WebcamInfo[];
  /**
   * Dialog the printer is waiting on, or null. Klipper prompts block the
   * command that raised them until a client answers, so an unrendered prompt
   * looks exactly like a print that silently never started.
   */
  prompt: KlipperPrompt | null;
  /** Runs a prompt button's G-code and closes the dialog. */
  answerPrompt: (gcode: string) => Promise<void>;
  /** Closes the dialog and tells the printer the prompt was dismissed. */
  dismissPrompt: () => Promise<void>;
  sendGcode: (script: string) => Promise<boolean>;
  rpc: (method: string, params?: Record<string, any>) => Promise<any>;
  reconnect: () => void;
  clearConsole: () => void;
}

export const MoonrakerContext = createContext<MoonrakerContextValue | null>(null);

// Base objects used for dashboard state. extruder1-3 cover the U1 tool heads,
// and gcode_move supplies position data used by Fluidd-style controls.
const BASE_OBJECTS = [
  'print_stats',
  'heater_bed',
  'virtual_sdcard',
  'bed_mesh',
  'display_status',
  'toolhead',
  'gcode_move',
  'extruder',
  'extruder1',
  'extruder2',
  'extruder3',
  'print_task_config',
  'fan',
];
const MAX_CONSOLE_LINES = 500;
/** Filament swaps are a human-speed event; this only needs to feel prompt. */
const PRINT_TASK_CONFIG_POLL_MS = 8000;
const WS_OPEN = 1;
const TEMP_WARNING_DELTA_C = 15;
const TEMP_WARNING_RESET_DELTA_C = 5;
const EXTRUDER_ACTIVE_TARGET_MIN_C = 120;
const EXTRUDER_TARGET_DROP_MIN_DELTA_C = 5;
const EXTRUDER_TARGET_DROP_SUPPRESS_MS = 5 * 60 * 1000;
const HEATER_KEY_RE = /^(heater_bed|extruder\d*|heater_generic\s+.+)$/;
const EXTRUDER_KEY_RE = /^extruder\d*$/;
// Android Doze can silently kill the TCP socket while the app is backgrounded:
// ws.readyState stays OPEN and onclose never fires, so the UI shows "connected"
// but no data flows. A periodic probe detects these zombie sockets and forces a
// reconnect when the printer stops answering.
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 6000;
let lineIdCounter = 0;

function heaterLabel(key: string): string {
  if (key === 'heater_bed') return 'Bed';
  if (key === 'extruder') return 'Extruder';
  if (/^extruder\d+$/.test(key)) return `Extruder ${key.replace('extruder', '')}`;
  return key.replace(/^heater_generic\s+/, '');
}

function isExtruderKey(key: string): boolean {
  return EXTRUDER_KEY_RE.test(key);
}

export function MoonrakerProvider({ children }: { children: React.ReactNode }) {
  const { settings, loaded, update } = useSettings();

  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [klippyState, setKlippyState] = useState('unknown');
  const [activeUrl, setActiveUrl] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [status, setStatus] = useState<Record<string, any>>({});
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [promptState, setPromptState] = useState<PromptBuildState | null>(null);
  const [objectList, setObjectList] = useState<string[]>([]);
  const [gcodeHelp, setGcodeHelp] = useState<Record<string, string>>({});
  const [webcams, setWebcams] = useState<WebcamInfo[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<Record<string, any>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(1);
  const pendingRef = useRef(
    new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: any }>()
  );
  const failCountRef = useRef(0);
  const urlIndexRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The in-flight heartbeat probe. Held so a printer switch can cancel it —
  // otherwise it outlives its own connection and reconnects the next one.
  const heartbeatProbeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const settingsRef = useRef<Settings>(settings);
  const prevPrintStateRef = useRef('');
  const lastTerminalNotificationRef = useRef('');
  const lastGcodeErrorRef = useRef('');
  const progressBucketRef = useRef<{ filename: string; bucket: number } | null>(null);
  const prevKlippyRef = useRef('unknown');
  const sensorStateRef = useRef<Record<string, boolean>>({});
  const tempWarningRef = useRef<Record<string, boolean>>({});
  const heaterTargetRef = useRef<Record<string, number>>({});
  const extruderTargetDropRef = useRef<Record<string, number>>({});
  const connectedRef = useRef(false);
  const disconnectNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const freshAd5xRemoteRef = useRef<{ printerId: string; url: string } | null>(null);

  settingsRef.current = settings;

  const addLine = useCallback((type: ConsoleLine['type'], text: string) => {
    const line: ConsoleLine = { id: ++lineIdCounter, time: Date.now(), type, text };
    setConsoleLines((prev) => {
      const next = prev.length >= MAX_CONSOLE_LINES ? prev.slice(prev.length - MAX_CONSOLE_LINES + 1) : prev.slice();
      next.push(line);
      return next;
    });
  }, []);

  // Moonraker can push status updates every ~250ms. Batch UI state writes so
  // React Native does not re-render for every websocket message.
  const flushStatus = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      setStatus({ ...statusRef.current });
    }, 400);
  }, []);

  const rpc = useCallback((method: string, params?: Record<string, any>): Promise<any> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WS_OPEN) {
        reject(new Error('Not connected to printer'));
        return;
      }
      const id = reqIdRef.current++;
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);
      pendingRef.current.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {}, id }));
    });
  }, []);

  const emitTerminalNotification = useCallback((state: string, filename: string, message?: string) => {
    const key = `${settingsRef.current.activePrinterId}:${filename}:${state}`;
    if (lastTerminalNotificationRef.current === key) return;
    lastTerminalNotificationRef.current = key;
    if (state === 'complete') {
      notifyEvent(settingsRef.current, 'complete', 'Print complete', `${filename} finished`);
    } else if (state === 'error') {
      notifyEvent(settingsRef.current, 'failed', 'Print failed', `${filename}: ${message || 'unknown error'}`);
    } else if (state === 'cancelled') {
      notifyEvent(settingsRef.current, 'cancelled', 'Print cancelled', `${filename} was cancelled`);
    }
  }, []);

  const checkTransitions = useCallback(() => {
    const s = statusRef.current;
    const ps = s.print_stats ?? {};
    const state: string = ps.state ?? '';
    const prev = prevPrintStateRef.current;
    const fname = ps.filename || 'print';

    if (prev && state !== prev) {
      if (state === 'printing') {
        lastTerminalNotificationRef.current = '';
        lastGcodeErrorRef.current = '';
      }
      if (state === 'complete') {
        emitTerminalNotification('complete', fname);
      } else if (state === 'error') {
        emitTerminalNotification('error', fname, ps.message || lastGcodeErrorRef.current);
      } else if (state === 'paused') {
        notifyEvent(settingsRef.current, 'paused', 'Print paused', `${fname} is paused`);
      } else if (state === 'cancelled') {
        emitTerminalNotification('cancelled', fname);
      }
    }
    prevPrintStateRef.current = state;

    if (state !== 'printing') {
      progressBucketRef.current = null;
    } else {
      const fileProgress = Number(s.virtual_sdcard?.progress);
      const displayProgress = Number(s.display_status?.progress);
      const currentLayer = Number(ps.info?.current_layer);
      const totalLayer = Number(ps.info?.total_layer);
      const ratio = Number.isFinite(fileProgress)
        ? fileProgress
        : Number.isFinite(displayProgress)
          ? displayProgress
          : totalLayer > 0
            ? currentLayer / totalLayer
            : NaN;
      if (Number.isFinite(ratio)) {
        const percent = Math.max(0, Math.min(99, Math.round(ratio * 100)));
        const bucket = Math.min(90, Math.floor(percent / 10) * 10);
        const previous = progressBucketRef.current;
        if (!previous || previous.filename !== fname) {
          progressBucketRef.current = { filename: fname, bucket };
        } else if (bucket > previous.bucket && bucket >= 10) {
          progressBucketRef.current = { filename: fname, bucket };
          notifyEvent(
            settingsRef.current,
            'progress',
            'Print progress',
            `${fname}: ${bucket}% complete`
          );
        }
      }
    }

    for (const key of Object.keys(s)) {
      if (/^filament_(switch|motion)_sensor /.test(key)) {
        const detected = !!s[key]?.filament_detected;
        const prevDet = sensorStateRef.current[key];
        if (prevDet === true && !detected && (state === 'printing' || prev === 'printing')) {
          const name = key.replace(/^filament_(switch|motion)_sensor\s*/, '');
          notifyEvent(settingsRef.current, 'runout', 'Filament runout', `Sensor: ${name}`);
        }
        sensorStateRef.current[key] = detected;
      }

      if (HEATER_KEY_RE.test(key)) {
        const temperature = Number(s[key]?.temperature);
        const target = Number(s[key]?.target);
        if (!Number.isFinite(temperature) || !Number.isFinite(target)) continue;

        const previousTarget = heaterTargetRef.current[key];
        heaterTargetRef.current[key] = target;
        const targetDropped =
          previousTarget != null && target <= previousTarget - EXTRUDER_TARGET_DROP_MIN_DELTA_C;
        if (isExtruderKey(key) && targetDropped) {
          extruderTargetDropRef.current[key] = Date.now();
          tempWarningRef.current[key] = false;
        }

        const active = target >= 40;
        const activeExtruder = typeof s.toolhead?.extruder === 'string' ? s.toolhead.extruder : '';
        const inactiveExtruder = isExtruderKey(key) && !!activeExtruder && activeExtruder !== key;
        const suppressExtruderCooldown =
          inactiveExtruder ||
          (isExtruderKey(key) && target > 0 && target < EXTRUDER_ACTIVE_TARGET_MIN_C) ||
          (isExtruderKey(key) &&
            (Date.now() - (extruderTargetDropRef.current[key] ?? 0)) <
              EXTRUDER_TARGET_DROP_SUPPRESS_MS);
        const warning =
          active && !suppressExtruderCooldown && temperature >= target + TEMP_WARNING_DELTA_C;
        const reset =
          suppressExtruderCooldown ||
          !active ||
          temperature <= target + TEMP_WARNING_RESET_DELTA_C;
        const wasWarning = tempWarningRef.current[key] === true;

        if (!wasWarning && warning) {
          notifyEvent(
            settingsRef.current,
            'temp',
            'Temperature warning',
            `${heaterLabel(key)} is ${formatTemperature(
              temperature,
              settingsRef.current.temperatureUnit,
              0
            )} with target ${formatTemperature(target, settingsRef.current.temperatureUnit, 0)}`
          );
        }

        tempWarningRef.current[key] = warning || (wasWarning && !reset);
      }
    }
  }, [emitTerminalNotification]);

  const handleGcodeResponse = useCallback(
    (msg: string) => {
      addLine(msg.startsWith('!!') ? 'error' : 'response', msg);
      // reducePromptLine returns the same reference for non-prompt lines, so
      // ordinary console chatter does not re-render anything.
      setPromptState((previous) => reducePromptLine(previous, msg));
      if (msg.startsWith('!!')) lastGcodeErrorRef.current = msg.replace(/^!!\s*/, '').trim();
      // multiACE does not emit a dedicated swap-complete event, so this uses
      // broad console response matching.
      if (
        /ace/i.test(msg) &&
        /(complete|done|finished|success)/i.test(msg) &&
        /(swap|change|load|unload|toolchange)/i.test(msg)
      ) {
        notifyEvent(settingsRef.current, 'swap', 'Filament swap complete', msg.trim());
      }
    },
    [addLine]
  );

  const initPrinter = useCallback(
    async (gen: number) => {
      try {
        const info = await rpc('server.info');
        if (gen !== generationRef.current) return;
        const kstate: string = info?.klippy_state ?? 'unknown';
        setKlippyState(kstate);
        if (kstate !== 'ready') {
          setTimeout(() => {
            if (gen === generationRef.current) initPrinter(gen);
          }, 3000);
          return;
        }

        const list = await rpc('printer.objects.list');
        if (gen !== generationRef.current) return;
        const objects: string[] = list?.objects ?? [];
        setObjectList(objects);
        setGcodeHelp({});
        prevKlippyRef.current = 'ready';

        rpc('printer.gcode.help')
          .then((r: any) => {
            if (gen === generationRef.current && r && typeof r === 'object') {
              setGcodeHelp(r);
            }
          })
          .catch(() => {
            if (gen === generationRef.current) setGcodeHelp({});
          });

        // Webcams can change while the printer is running, so refresh on each connection.
        rpc('server.webcams.list')
          .then((r: any) => {
            if (gen === generationRef.current && Array.isArray(r?.webcams)) {
              setWebcams(r.webcams.filter((w: WebcamInfo) => w.enabled !== false));
            }
          })
          .catch(() => {});

        // Recover a prompt the printer raised before this client connected.
        // Klipper prompts are ordinary G-code responses, so a client that joins
        // afterwards never sees them and the dialog would stay invisible while
        // the printer waits. Moonraker keeps a rolling buffer; folding it
        // replays the whole conversation, and any prompt already answered or
        // ended reduces back to null on its own.
        rpc('server.gcode_store', { count: 100 })
          .then((store: { gcode_store?: { message?: string }[] }) => {
            if (gen !== generationRef.current) return;
            const lines = store?.gcode_store ?? [];
            let recovered: PromptBuildState | null = null;
            for (const entry of lines) {
              recovered = reducePromptLine(recovered, String(entry?.message ?? ''));
            }
            if (recovered) setPromptState(recovered);
          })
          .catch(() => {});

        const subs: Record<string, null> = {};
        for (const name of BASE_OBJECTS) if (objects.includes(name)) subs[name] = null;
        for (const name of objects) {
          if (name === 'panda_breath') subs[name] = null;
          if (/^filament_(switch|motion)_sensor /.test(name)) subs[name] = null;
          if (name === 'ace' || /^ace[\s_\d]/i.test(name)) subs[name] = null;
          if (/^(led|neopixel|dotstar) /.test(name)) subs[name] = null;
          if (/^fan_generic /.test(name)) subs[name] = null;
          if (/^heater_generic /.test(name)) subs[name] = null;
          if (/^temperature_sensor /.test(name)) subs[name] = null;
        }

        const res = await rpc('printer.objects.subscribe', { objects: subs });
        if (gen !== generationRef.current) return;
        statusRef.current = res?.status ?? {};
        const initialPrintState = statusRef.current.print_stats?.state ?? '';
        prevPrintStateRef.current = initialPrintState;
        progressBucketRef.current = null;
        if (initialPrintState === 'printing') {
          lastTerminalNotificationRef.current = '';
          lastGcodeErrorRef.current = '';
        }
        sensorStateRef.current = {};
        tempWarningRef.current = {};
        heaterTargetRef.current = {};
        extruderTargetDropRef.current = {};
        for (const key of Object.keys(statusRef.current)) {
          if (/^filament_(switch|motion)_sensor /.test(key)) {
            sensorStateRef.current[key] = !!statusRef.current[key]?.filament_detected;
          }
        }
        setStatus({ ...statusRef.current });
      } catch (e: any) {
        if (gen !== generationRef.current) return;
        addLine('error', `Printer init failed: ${e?.message ?? e}`);
        setTimeout(() => {
          if (gen === generationRef.current) initPrinter(gen);
        }, 3000);
      }
    },
    [rpc, addLine]
  );

  const refreshAd5xRemoteBase = useCallback(async () => {
    const current = settingsRef.current;
    const printer = current.printers.find((entry) => entry.id === current.activePrinterId);
    if (printer?.kind !== 'flashforge-ad5x') return;

    const discovered = await discoverHelixdRemoteBase(printer.url || current.primaryUrl);
    if (discovered === null) return;

    // The active printer may have changed while the LAN request was in flight.
    const latest = settingsRef.current;
    const latestPrinter = latest.printers.find((entry) => entry.id === printer.id);
    if (latest.activePrinterId !== printer.id || latestPrinter?.kind !== 'flashforge-ad5x') return;

    freshAd5xRemoteRef.current = { printerId: printer.id, url: discovered };
    const savedPrinterUrl = normalizeBaseUrl(latestPrinter.tailscaleUrl || '');
    const savedActiveUrl = normalizeBaseUrl(latest.tailscaleUrl || '');
    if (savedPrinterUrl === discovered && savedActiveUrl === discovered) return;

    await update({
      tailscaleUrl: discovered,
      printers: latest.printers.map((entry) =>
        entry.id === printer.id ? { ...entry, tailscaleUrl: discovered } : entry
      ),
    });
  }, [update]);

  const getUrls = useCallback((): string[] => {
    const urls: string[] = [];
    const current = settingsRef.current;
    const activePrinter = current.printers.find((entry) => entry.id === current.activePrinterId);
    const mode = current.connectionMode;

    if (activePrinter?.kind === 'flashforge-ad5x') {
      const primary = normalizeMoonrakerUrl(activePrinter.url || current.primaryUrl);
      const fresh = freshAd5xRemoteRef.current;
      const tailscaleProxy = fresh?.printerId === activePrinter.id
        ? fresh.url
        : normalizeBaseUrl(activePrinter.tailscaleUrl || current.tailscaleUrl);
      const tailscale = helixdRemoteMoonrakerUrl(tailscaleProxy);

      if (mode === 'lan') {
        if (primary) urls.push(primary);
        return urls;
      }
      if (mode === 'tailscale') {
        if (tailscale) urls.push(tailscale);
        return urls;
      }
      if (primary) urls.push(primary);
      if (tailscale && tailscale !== primary) urls.push(tailscale);
      return urls;
    }

    const primary = normalizeMoonrakerUrl(current.primaryUrl);
    const tailscale = normalizeMoonrakerUrl(current.tailscaleUrl);

    // tailscale-only means tailscale-only!!!!!!!!!!!
    // crabcore
    if (mode === 'tailscale') {
      if (tailscale) urls.push(tailscale);
      return urls;
    }

    if (mode === 'lan') {
      if (primary) urls.push(primary);
      return urls;
    }

    if (primary) urls.push(primary);
    if (tailscale && tailscale !== primary) urls.push(tailscale);
    return urls;
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (heartbeatProbeRef.current) {
      clearTimeout(heartbeatProbeRef.current);
      heartbeatProbeRef.current = null;
    }
  }, []);

  // Takes the generation of the socket it belongs to. Without that guard a probe
  // started for the previous printer stays armed across a switch and, six
  // seconds later, tears down the healthy connection to the printer the user
  // just picked — which then backs off up to the 8s cap before trying again.
  // Measured on device: switching AD5X -> U1 connected in ~2s, was killed at
  // ~15s, and only settled after ~25s.
  const startHeartbeat = useCallback((gen: number) => {
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      if (gen !== generationRef.current) return;
      if (!connectedRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WS_OPEN) return;
      let answered = false;
      if (heartbeatProbeRef.current) clearTimeout(heartbeatProbeRef.current);
      heartbeatProbeRef.current = setTimeout(() => {
        heartbeatProbeRef.current = null;
        if (gen !== generationRef.current) return;
        if (!answered && connectedRef.current) {
          addLine('error', '// Printer connection stalled — reconnecting');
          connectRef.current();
        }
      }, HEARTBEAT_TIMEOUT_MS);
      const settle = () => {
        answered = true;
        if (heartbeatProbeRef.current) {
          clearTimeout(heartbeatProbeRef.current);
          heartbeatProbeRef.current = null;
        }
      };
      rpc('server.info').then(settle).catch(settle);
    }, HEARTBEAT_INTERVAL_MS);
  }, [rpc, addLine, stopHeartbeat]);

  const scheduleReconnect = useCallback(() => {
    failCountRef.current += 1;
    void refreshAd5xRemoteBase();
    const urls = getUrls();
    const hasAlternate = urls.length > 1;
    const nextIndex = hasAlternate
      ? (urlIndexRef.current + 1) % urls.length
      : urlIndexRef.current;
    urlIndexRef.current = nextIndex;

    // Try every configured route once before backing off. A dead LAN address
    // in Auto mode must hand directly to Tailscale instead of adding a retry
    // delay between candidates. Backoff starts only after the full set failed.
    const completedCycle = !hasAlternate || nextIndex === 0;
    const failedCycles = Math.ceil(failCountRef.current / Math.max(1, urls.length));
    const delay = completedCycle
      ? Math.min(1000 * Math.pow(2, Math.min(failedCycles, 3)), 8000)
      : 0;
    if (!completedCycle) setConnection('connecting');
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => connectRef.current(), delay);
  }, [getUrls, refreshAd5xRemoteBase]);

  const connect = useCallback(() => {
    const gen = ++generationRef.current;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const old = wsRef.current;
    wsRef.current = null;
    if (old) {
      try {
        old.close();
      } catch {}
    }
    for (const [, p] of pendingRef.current) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection reset'));
    }
    pendingRef.current.clear();

    const urls = getUrls();
    if (!urls.length) {
      connectedRef.current = false;
      setProxyUrl('');
      setConnection('disconnected');
      return;
    }
    const url = urls[urlIndexRef.current % urls.length];
    setActiveUrl(url);
    const current = settingsRef.current;
    const activePrinter = current.printers.find((entry) => entry.id === current.activePrinterId);
    if (activePrinter?.kind === 'flashforge-ad5x') {
      const fresh = freshAd5xRemoteRef.current;
      const remoteProxy = fresh?.printerId === activePrinter.id
        ? fresh.url
        : normalizeBaseUrl(activePrinter.tailscaleUrl || current.tailscaleUrl);
      const remoteMoonraker = helixdRemoteMoonrakerUrl(remoteProxy);
      setProxyUrl(
        remoteMoonraker && url === remoteMoonraker
          ? remoteProxy
          : helixdLanBaseUrl(activePrinter.url || current.primaryUrl)
      );
    } else {
      setProxyUrl(url);
    }
    setConnection('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(url));
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    // React Native WebSocket has no connection timeout, so enforce one to keep
    // LAN/Tailscale failover moving when a network path hangs.
    // Auto gets a short LAN probe because another viable route is waiting.
    // LAN-only keeps the longer window for printers on weak Wi-Fi.
    const autoFailover = current.connectionMode === 'auto' && urls.length > 1;
    const connectTimeoutMs = isTailscaleUrl(url) ? 15000 : autoFailover ? 3000 : 7000;
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = setTimeout(() => {
      if (gen === generationRef.current && ws.readyState !== WS_OPEN) {
        // Closing a CONNECTING React Native socket can take Android several
        // more seconds to emit onclose. Invalidate this generation first so
        // its eventual callback cannot rotate the URL a second time, then
        // schedule the alternate route ourselves immediately.
        generationRef.current += 1;
        connectTimeoutRef.current = null;
        try {
          ws.close();
        } catch {}
        scheduleReconnect();
      }
    }, connectTimeoutMs);

    ws.onopen = () => {
      if (gen !== generationRef.current) return;
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      if (disconnectNoticeTimerRef.current) {
        clearTimeout(disconnectNoticeTimerRef.current);
        disconnectNoticeTimerRef.current = null;
      }
      connectedRef.current = true;
      failCountRef.current = 0;
      setConnection('connected');
      addLine('response', `// Connected to ${url}`);
      initPrinter(gen);
      startHeartbeat(gen);
    };

    ws.onmessage = (ev) => {
      if (gen !== generationRef.current) return;
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      if (msg.id != null && pendingRef.current.has(msg.id)) {
        const p = pendingRef.current.get(msg.id)!;
        pendingRef.current.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message ?? 'RPC error'));
        else p.resolve(msg.result);
        return;
      }

      switch (msg.method) {
        case 'notify_status_update': {
          const data = msg.params?.[0] ?? {};
          for (const key of Object.keys(data)) {
            statusRef.current[key] = { ...statusRef.current[key], ...data[key] };
          }
          checkTransitions();
          flushStatus();
          break;
        }
        case 'notify_history_changed': {
          const event = msg.params?.[0] ?? {};
          if (event.action !== 'finished') break;
          const job = event.job ?? {};
          const state = terminalPrintStateForHistory(job.status);
          if (state) {
            const filename = job.filename || statusRef.current.print_stats?.filename || 'print';
            emitTerminalNotification(state, filename, historyFailureMessage(job));
          }
          break;
        }
        case 'notify_gcode_response':
          handleGcodeResponse(String(msg.params?.[0] ?? ''));
          break;
        case 'notify_klippy_ready':
          setKlippyState('ready');
          prevKlippyRef.current = 'ready';
          initPrinter(gen);
          break;
        case 'notify_klippy_shutdown':
          setKlippyState('shutdown');
          // only alert on a real ready->shutdown transition, not startup noise
          if (prevKlippyRef.current === 'ready') {
            notifyEvent(
              settingsRef.current,
              'error',
              'Printer error',
              'Klipper shut down — check the printer'
            );
          }
          prevKlippyRef.current = 'shutdown';
          break;
        case 'notify_klippy_disconnected':
          setKlippyState('disconnected');
          break;
      }
    };

    ws.onerror = () => {
      // onclose follows; handled there
    };

    ws.onclose = () => {
      if (gen !== generationRef.current) return;
      stopHeartbeat();
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      const wasConnected = connectedRef.current;
      connectedRef.current = false;
      setConnection('disconnected');
      setKlippyState('unknown');
      for (const [, p] of pendingRef.current) {
        clearTimeout(p.timer);
        p.reject(new Error('Connection closed'));
      }
      pendingRef.current.clear();
      if (wasConnected && appStateRef.current === 'active' && !disconnectNoticeTimerRef.current) {
        disconnectNoticeTimerRef.current = setTimeout(() => {
          disconnectNoticeTimerRef.current = null;
          const printState = statusRef.current.print_stats?.state;
          const activePrint = printState === 'printing' || printState === 'paused';
          if (activePrint && (!wsRef.current || wsRef.current.readyState !== WS_OPEN)) {
            notifyEvent(
              settingsRef.current,
              'disconnected',
              'Printer disconnected',
              'The printer connection was lost during an active print'
            );
          }
        }, 12000);
      }
      scheduleReconnect();
    };
  }, [getUrls, scheduleReconnect, addLine, initPrinter, checkTransitions, emitTerminalNotification, flushStatus, handleGcodeResponse, startHeartbeat, stopHeartbeat]);

  connectRef.current = connect;

  useEffect(() => {
    if (!loaded) return;
    urlIndexRef.current = 0;
    failCountRef.current = 0;
    void refreshAd5xRemoteBase();
    connect();

    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
      if (state !== 'active') {
        if (disconnectNoticeTimerRef.current) {
          clearTimeout(disconnectNoticeTimerRef.current);
          disconnectNoticeTimerRef.current = null;
        }
        if (backgroundedAtRef.current == null) {
          backgroundedAtRef.current = Date.now();
        }
        return;
      }
      // Returning to the foreground. React Native WebSockets can report OPEN
      // after Android Doze silently killed the underlying TCP connection, so
      // don't trust readyState alone — force a reconnect when the app was
      // backgrounded long enough for that to happen.
      const bgGap = backgroundedAtRef.current ? Date.now() - backgroundedAtRef.current : 0;
      backgroundedAtRef.current = null;
      const socketDead = !wsRef.current || wsRef.current.readyState !== WS_OPEN;
      if (socketDead || bgGap > 3000) {
        failCountRef.current = 0;
        if (settingsRef.current.connectionMode === 'auto') {
          urlIndexRef.current = 0;
        }
        connect();
      }
    });

    return () => {
      generationRef.current++;
      sub.remove();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      if (disconnectNoticeTimerRef.current) clearTimeout(disconnectNoticeTimerRef.current);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
  }, [
    loaded,
    settings.activePrinterId,
    settings.primaryUrl,
    settings.tailscaleUrl,
    settings.connectionMode,
    connect,
    refreshAd5xRemoteBase,
  ]);

  // print_task_config carries the loaded filament (colour, vendor, type) but the
  // U1 never emits notify_status_update for it — subscribing only ever yields
  // the value read at connect time. Loading a new spool therefore left the app
  // showing the previous filament until it was restarted, so poll it instead.
  useEffect(() => {
    if (connection !== 'connected') return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await rpc('printer.objects.query', {
          objects: { print_task_config: null },
        });
        const next = res?.status?.print_task_config;
        if (cancelled || !next) return;
        statusRef.current.print_task_config = {
          ...statusRef.current.print_task_config,
          ...next,
        };
        flushStatus();
      } catch {
        // A dropped poll is harmless — the next one picks the change up.
      }
    };

    const timer = setInterval(() => void poll(), PRINT_TASK_CONFIG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, rpc, flushStatus]);

  const sendGcode = useCallback(
    async (script: string): Promise<boolean> => {
      const cmd = script.trim();
      if (!cmd) return false;
      addLine('command', cmd);
      try {
        await rpc('printer.gcode.script', { script: cmd });
        return true;
      } catch (e: any) {
        addLine('error', `!! ${e?.message ?? e}`);
        return false;
      }
    },
    [rpc, addLine]
  );

  const reconnect = useCallback(() => {
    urlIndexRef.current = 0;
    failCountRef.current = 0;
    connect();
  }, [connect]);

  const clearConsole = useCallback(() => setConsoleLines([]), []);

  const macros = useMemo(
    () =>
      objectList
        .filter((o) => o.startsWith('gcode_macro '))
        .map((o) => o.slice('gcode_macro '.length))
        .filter((n) => !n.startsWith('_'))
        .sort(),
    [objectList]
  );

  const prompt = useMemo(() => visiblePrompt(promptState), [promptState]);

  // Close locally first: the dialog must never outlive the tap, even if the
  // printer is slow or the socket has dropped.
  const answerPrompt = useCallback(
    async (gcode: string) => {
      setPromptState(null);
      await sendGcode(gcode).catch(() => false);
    },
    [sendGcode]
  );

  const dismissPrompt = useCallback(async () => {
    setPromptState(null);
    await sendGcode(PROMPT_DISMISS_GCODE).catch(() => false);
  }, [sendGcode]);

  const value = useMemo<MoonrakerContextValue>(
    () => ({
      connection,
      klippyState,
      activeUrl,
      proxyUrl,
      status,
      consoleLines,
      macros,
      objectList,
      gcodeHelp,
      webcams,
      prompt,
      answerPrompt,
      dismissPrompt,
      sendGcode,
      rpc,
      reconnect,
      clearConsole,
    }),
    [connection, klippyState, activeUrl, proxyUrl, status, consoleLines, macros, objectList, gcodeHelp, webcams, prompt, answerPrompt, dismissPrompt, sendGcode, rpc, reconnect, clearConsole]
  );

  return <MoonrakerContext.Provider value={value}>{children}</MoonrakerContext.Provider>;
}

export function useMoonraker(): MoonrakerContextValue {
  const ctx = useContext(MoonrakerContext);
  if (!ctx) throw new Error('useMoonraker must be used inside MoonrakerProvider');
  return ctx;
}
