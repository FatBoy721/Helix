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
import { isTailscaleUrl, normalizeMoonrakerUrl, WebcamInfo, wsUrl } from '../services/moonraker';
import { notifyEvent } from '../services/notifications';
import { Settings, useSettings } from './useSettings';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface ConsoleLine {
  id: number;
  time: number;
  type: 'command' | 'response' | 'error';
  text: string;
}

interface MoonrakerContextValue {
  connection: ConnectionState;
  klippyState: string;
  activeUrl: string;
  status: Record<string, any>;
  consoleLines: ConsoleLine[];
  macros: string[];
  objectList: string[];
  gcodeHelp: Record<string, string>;
  webcams: WebcamInfo[];
  sendGcode: (script: string) => Promise<boolean>;
  rpc: (method: string, params?: Record<string, any>) => Promise<any>;
  reconnect: () => void;
  clearConsole: () => void;
}

const MoonrakerContext = createContext<MoonrakerContextValue | null>(null);

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
  'fan',
];
const MAX_CONSOLE_LINES = 500;
const WS_OPEN = 1;
const TEMP_WARNING_DELTA_C = 15;
const TEMP_WARNING_RESET_DELTA_C = 5;
const EXTRUDER_TARGET_DROP_MIN_DELTA_C = 5;
const EXTRUDER_TARGET_DROP_SUPPRESS_MS = 5 * 60 * 1000;
const HEATER_KEY_RE = /^(heater_bed|extruder\d*|heater_generic\s+.+)$/;
const EXTRUDER_KEY_RE = /^extruder\d*$/;
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
  const { settings, loaded } = useSettings();

  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [klippyState, setKlippyState] = useState('unknown');
  const [activeUrl, setActiveUrl] = useState('');
  const [status, setStatus] = useState<Record<string, any>>({});
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
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
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const settingsRef = useRef<Settings>(settings);
  const prevPrintStateRef = useRef('');
  const prevKlippyRef = useRef('unknown');
  const sensorStateRef = useRef<Record<string, boolean>>({});
  const tempWarningRef = useRef<Record<string, boolean>>({});
  const heaterTargetRef = useRef<Record<string, number>>({});
  const extruderTargetDropRef = useRef<Record<string, number>>({});
  const connectedRef = useRef(false);
  const disconnectNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const checkTransitions = useCallback(() => {
    const s = statusRef.current;
    const ps = s.print_stats ?? {};
    const state: string = ps.state ?? '';
    const prev = prevPrintStateRef.current;

    if (prev && state !== prev) {
      const fname = ps.filename || 'print';
      if (state === 'complete') {
        notifyEvent(settingsRef.current, 'complete', 'Print complete', `${fname} finished`);
      } else if (state === 'error') {
        notifyEvent(
          settingsRef.current,
          'failed',
          'Print failed',
          `${fname}: ${ps.message || 'unknown error'}`
        );
      } else if (state === 'paused') {
        notifyEvent(settingsRef.current, 'paused', 'Print paused', `${fname} is paused`);
      }
    }
    prevPrintStateRef.current = state;

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
            `${heaterLabel(key)} is ${Math.round(temperature)}C with target ${Math.round(target)}C`
          );
        }

        tempWarningRef.current[key] = warning || (wasWarning && !reset);
      }
    }
  }, []);

  const handleGcodeResponse = useCallback(
    (msg: string) => {
      addLine(msg.startsWith('!!') ? 'error' : 'response', msg);
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

        const subs: Record<string, null> = {};
        for (const name of BASE_OBJECTS) if (objects.includes(name)) subs[name] = null;
        for (const name of objects) {
          if (name === 'panda_breath') subs[name] = null;
          if (/^filament_(switch|motion)_sensor /.test(name)) subs[name] = null;
          if (name === 'ace' || /^ace[\s_\d]/i.test(name)) subs[name] = null;
          if (/^(led|neopixel|dotstar) /.test(name)) subs[name] = null;
          if (/^fan_generic /.test(name)) subs[name] = null;
          if (/^heater_generic /.test(name)) subs[name] = null;
        }

        const res = await rpc('printer.objects.subscribe', { objects: subs });
        if (gen !== generationRef.current) return;
        statusRef.current = res?.status ?? {};
        prevPrintStateRef.current = statusRef.current.print_stats?.state ?? '';
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

  const getUrls = useCallback((): string[] => {
    const urls: string[] = [];
    const primary = normalizeMoonrakerUrl(settingsRef.current.primaryUrl);
    const tailscale = normalizeMoonrakerUrl(settingsRef.current.tailscaleUrl);
    if (primary) urls.push(primary);
    if (tailscale && tailscale !== primary) urls.push(tailscale);
    return urls;
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    failCountRef.current += 1;
    const urls = getUrls();
    // Alternate LAN and Tailscale after each failed connection attempt.
    if (urls.length > 1) {
      urlIndexRef.current = (urlIndexRef.current + 1) % urls.length;
    }
    const delay = Math.min(1000 * Math.pow(2, Math.min(failCountRef.current, 3)), 8000);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => connectRef.current(), delay);
  }, [getUrls]);

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
      setConnection('disconnected');
      return;
    }
    const url = urls[urlIndexRef.current % urls.length];
    setActiveUrl(url);
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
    const connectTimeoutMs = isTailscaleUrl(url) ? 15000 : 7000;
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = setTimeout(() => {
      if (gen === generationRef.current && ws.readyState !== WS_OPEN) {
        try {
          ws.close();
        } catch {}
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
      if (wasConnected && !disconnectNoticeTimerRef.current) {
        disconnectNoticeTimerRef.current = setTimeout(() => {
          disconnectNoticeTimerRef.current = null;
          if (!wsRef.current || wsRef.current.readyState !== WS_OPEN) {
            notifyEvent(
              settingsRef.current,
              'disconnected',
              'Printer disconnected',
              `${url} stopped responding`
            );
          }
        }, 12000);
      }
      scheduleReconnect();
    };
  }, [getUrls, scheduleReconnect, addLine, initPrinter, checkTransitions, flushStatus, handleGcodeResponse]);

  connectRef.current = connect;

  useEffect(() => {
    if (!loaded) return;
    urlIndexRef.current = 0;
    failCountRef.current = 0;
    connect();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (!wsRef.current || wsRef.current.readyState !== WS_OPEN)) {
        failCountRef.current = 0;
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
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
  }, [loaded, settings.primaryUrl, settings.tailscaleUrl, connect]);

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

  const value = useMemo<MoonrakerContextValue>(
    () => ({
      connection,
      klippyState,
      activeUrl,
      status,
      consoleLines,
      macros,
      objectList,
      gcodeHelp,
      webcams,
      sendGcode,
      rpc,
      reconnect,
      clearConsole,
    }),
    [connection, klippyState, activeUrl, status, consoleLines, macros, objectList, gcodeHelp, webcams, sendGcode, rpc, reconnect, clearConsole]
  );

  return <MoonrakerContext.Provider value={value}>{children}</MoonrakerContext.Provider>;
}

export function useMoonraker(): MoonrakerContextValue {
  const ctx = useContext(MoonrakerContext);
  if (!ctx) throw new Error('useMoonraker must be used inside MoonrakerProvider');
  return ctx;
}
