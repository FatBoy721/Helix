// Live dashboard view-model.
//
// Turns raw Moonraker status into the shape a dashboard actually wants to
// render. Built for the redesign so the design lab and the eventual Home screen
// share one derivation instead of each growing their own copy — the current
// app/(tabs)/index.tsx does this inline, which is a large part of why it is
// 1400 lines.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMoonraker } from './useMoonraker';
import { useSettings } from './useSettings';
import { findMachineChamberTemperatureSource } from '../services/chamberTemperature';
import {
  api,
  isGuiWebcam,
  normalizeMoonrakerUrl,
  printerConnectionUrl,
  resolveCameraUrl,
  resolveSnapshotUrl,
  thumbnailUrl,
} from '../services/moonraker';
import { calculatePrintEtas } from '../services/printEta';
import { formatDuration } from '../components/PrintProgress';
import { filterMacrosForDisplay, getMacroDisplay } from '../services/macroDisplay';
import {
  resolveFilamentSlots,
  type FilamentSlotStatus,
} from '../services/filamentSlots';
import { t } from '../services/i18n';

export type DashboardState = 'offline' | 'idle' | 'printing' | 'finished' | 'error';

export interface DashboardTool {
  id: number;
  color: string;
  brand: string;
  /** Main type + sub type as the printer/settings report it, e.g. "PLA MATTE". */
  material: string;
  /** Main type alone — what narrow cards should show. */
  mainType: string;
  temp: number;
  target: number;
  active: boolean;
  loaded: FilamentSlotStatus;
  /** Whether the values came from the printer or fell back to saved settings. */
  source: 'printer' | 'manual';
}

export interface DashboardTemp {
  /** Stable identity for history + icon lookup: 'nozzle' | 'bed' | 'chamber'. */
  key: string;
  label: string;
  value: number;
  target: number;
  history: number[];
}

export interface DashboardJob {
  name: string;
  progress: number;
  layer: number | null;
  layers: number | null;
  remaining: string;
  eta: string;
  thumbUri: string | null;
}

export interface DashboardActions {
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  /** Re-run the job currently shown on the finished card. */
  reprint: () => void;
  /** Clear a finished job's card without touching the printer. */
  dismissFinished: () => void;
  /** Halts the printer. Fired over the websocket AND both REST URLs, because
   *  an e-stop must not depend on the socket being healthy. */
  emergencyStop: () => void;
  /** Runs a Klipper macro by name. */
  runMacro: (name: string) => void;
  /** Panda Breath chamber heater / dryer. The model owns command construction
   *  because the combined `stop` and the START-vs-RUN dry dispatch depend on
   *  feature-detected state (`gcodeHelp`) the component can't see. */
  panda: {
    setTarget: (temp: number) => void;
    setAuto: (temp: number, enabled: boolean) => void;
    dry: (temp: number, hours: number) => void;
    stop: () => void;
  };
}

export interface DashboardPandaBreath {
  /** A matching heater_generic was found in status. */
  detected: boolean;
  temp: number;
  target: number;
  /** Localized run-state: Idle / Manual / Auto / Dry <remaining> / offline / not detected. */
  mode: string;
  /** Firmware exposes PANDA_BREATH_AUTO (or reports auto_target). */
  supportsAuto: boolean;
  /** Auto mode is currently engaged (highlights the Auto chip). */
  autoOn: boolean;
  /** Which dry gcode the firmware speaks, if any. */
  dryCommand: 'start' | 'run' | '';
  dryActive: boolean;
}

export interface DashboardModel {
  printerName: string;
  online: boolean;
  connectionLabel: string;
  state: DashboardState;
  paused: boolean;
  errorMessage: string;
  job: DashboardJob | null;
  tools: DashboardTool[];
  temps: DashboardTemp[];
  macros: string[];
  camera: { url: string; snapshotUrl?: string } | null;
  /** The printer's own touchscreen, mirrored. Separate from the print camera. */
  guiScreen: { url: string; snapshotUrl?: string } | null;
  lightOn: boolean;
  toggleLight: (() => void) | undefined;
  pandaBreath: DashboardPandaBreath;
  actions: DashboardActions;
}

const EXTRUDERS = ['extruder', 'extruder1', 'extruder2', 'extruder3'];
// 40 samples at 2s ≈ 80s of trace — long enough to show a heat-up ramp without
// the sparkline degenerating into a flat line at steady state.
const HISTORY_LENGTH = 40;
const SAMPLE_MS = 2000;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Clock time when the print is expected to finish. */
function etaClock(remainingSeconds: number | null): string {
  if (remainingSeconds == null) return '--';
  const done = new Date(Date.now() + remainingSeconds * 1000);
  return done.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------- panda breath
// The Panda Breath chamber heater / filament dryer. Klipper surfaces it as a
// `panda_breath` state object plus a `heater_generic` whose name matches
// panda|breath|chamber. The Auto/Dry gcodes are extras-registered, so they're
// missing from gcode_help on firmware that doesn't support them — feature-detect
// before offering those controls. Mirrors the deleted ControlsPanel logic.
const GENERIC_HEATER_PREFIX = 'heater_generic ';
const PANDA_BREATH_NAME_RE = /(panda|breath|chamber)/i;
const PANDA_BREATH_MAX_TEMP = 60;
const PANDA_AUTO_FILTER_TEMP = 30;
const PANDA_AUTO_HOTBED_TEMP = 80;

function findPandaBreathHeater(status: Record<string, any>): Record<string, any> | null {
  const heaterKeys = Object.keys(status).filter(
    (key) =>
      key.startsWith(GENERIC_HEATER_PREFIX) &&
      typeof status[key]?.temperature === 'number'
  );
  const namedKey = heaterKeys.find((key) =>
    PANDA_BREATH_NAME_RE.test(key.slice(GENERIC_HEATER_PREFIX.length))
  );
  // If there's exactly one generic heater and nothing names it, assume it's the
  // Panda Breath. Multiple unnamed heaters is ambiguous — don't guess.
  const objectKey = namedKey ?? (heaterKeys.length === 1 ? heaterKeys[0] : '');
  return objectKey ? status[objectKey] ?? null : null;
}

function hasGcode(help: Record<string, string> | undefined, command: string): boolean {
  return Object.prototype.hasOwnProperty.call(help ?? {}, command);
}

function clampPandaTemp(value: number): number {
  return Math.max(0, Math.min(PANDA_BREATH_MAX_TEMP, Number.isFinite(value) ? Math.round(value) : 0));
}

function pandaDryTimeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function pandaModeLabel(
  state: Record<string, any>,
  heater: Record<string, any> | null,
  target: number
): string {
  if (state.connected === false) return t('offline');
  const mode = Number(state.work_mode);
  const remaining = Number(state.remaining_seconds);
  const drying =
    state.filament_drying_active === true ||
    (Number.isFinite(remaining) && remaining > 0) ||
    mode === 3;
  if (drying) {
    const remainingText = pandaDryTimeLabel(remaining);
    return remainingText ? `${t('Dry')} ${remainingText}` : t('Dry');
  }
  if (state.auto_enabled === true || mode === 1) return t('Auto');
  if (target > 0 || state.work_on === true) return t('Manual');
  return heater ? t('Idle') : t('not detected');
}

export function useDashboardModel(): DashboardModel {
  const { status, connection, klippyState, activeUrl, macros, webcams, sendGcode, rpc, gcodeHelp } =
    useMoonraker();
  const { settings } = useSettings();

  const ps = status.print_stats ?? {};
  const vsd = status.virtual_sdcard ?? {};
  const filename: string = ps.filename ?? '';
  const rawState: string = ps.state ?? 'unknown';
  const connected = connection === 'connected' && klippyState === 'ready';

  // ---------------------------------------------------------------- temps
  const chamberSource = useMemo(() => findMachineChamberTemperatureSource(status), [status]);

  // Sampled on a timer rather than on every websocket frame: the chart wants
  // evenly spaced points, and status can arrive many times a second.
  const statusRef = useRef(status);
  statusRef.current = status;
  const chamberKeyRef = useRef<string | null>(null);
  chamberKeyRef.current = chamberSource?.label ?? null;
  const [history, setHistory] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const sample = () => {
      const s = statusRef.current;
      const chamber = findMachineChamberTemperatureSource(s);
      // Follow the ACTIVE extruder, not always `extruder`: on the U1 the four
      // toolheads are separate heaters, and during a print the firmware heats
      // whichever tool is active — reading `extruder` alone sits frozen at its
      // last value for the whole job.
      const activeHeater = s[s.toolhead?.extruder ?? 'extruder'] ?? s.extruder;
      const readings: [string, number][] = [
        ['nozzle', num(activeHeater?.temperature)],
        ['bed', num(s.heater_bed?.temperature)],
      ];
      if (chamber?.data) readings.push(['chamber', num(chamber.data.temperature)]);

      setHistory((prev) => {
        const next = { ...prev };
        for (const [key, value] of readings) {
          const series = next[key] ? [...next[key], value] : [value];
          next[key] = series.length > HISTORY_LENGTH ? series.slice(-HISTORY_LENGTH) : series;
        }
        return next;
      });
    };
    sample();
    const id = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  const temps = useMemo<DashboardTemp[]>(() => {
    const chamber = chamberSource?.data ?? null;
    // Same active-extruder resolution as the sampler above — see its comment.
    const activeHeater =
      status[status.toolhead?.extruder ?? 'extruder'] ?? status.extruder ?? {};
    const out: DashboardTemp[] = [
      {
        key: 'nozzle',
        label: t('Nozzle'),
        value: Math.round(num(activeHeater.temperature)),
        target: Math.round(num(activeHeater.target)),
        history: history.nozzle ?? [],
      },
      {
        key: 'bed',
        label: t('Bed'),
        value: Math.round(num(status.heater_bed?.temperature)),
        target: Math.round(num(status.heater_bed?.target)),
        history: history.bed ?? [],
      },
    ];
    if (chamber) {
      out.push({
        key: 'chamber',
        label: chamberSource?.label ?? t('Chamber'),
        value: Math.round(num(chamber.temperature)),
        target: Math.round(num(chamber.target)),
        history: history.chamber ?? [],
      });
    }
    return out;
  }, [chamberSource, history, status]);

  // ---------------------------------------------------------------- tools
  const tools = useMemo<DashboardTool[]>(() => {
    // Same resolution the existing Filaments card uses: printer-reported values
    // from print_task_config, falling back to the slot config the user picked.
    const slots = resolveFilamentSlots(status, {
      slotColors: settings.filamentSlotColors ?? [],
      slotBrands: settings.filamentSlotBrands ?? [],
      slotMaterials: settings.filamentSlotMaterials ?? [],
      slotSubtypes: settings.filamentSlotSubtypes ?? [],
    });
    const activeExtruder: string = status.toolhead?.extruder ?? 'extruder';

    return EXTRUDERS.map((name, i) => {
      const heater = status[name] ?? {};
      const slot = slots[i];
      return {
        id: i,
        color: slot.color,
        brand: slot.brand ?? t('Generic'),
        material: slot.material,
        mainType: slot.mainType,
        temp: Math.round(num(heater.temperature)),
        target: Math.round(num(heater.target)),
        active: name === activeExtruder,
        loaded: slot.status,
        source: slot.source ?? 'manual',
      };
    });
  }, [
    settings.filamentSlotBrands,
    settings.filamentSlotColors,
    settings.filamentSlotMaterials,
    settings.filamentSlotSubtypes,
    status,
  ]);

  // ---------------------------------------------------------------- job
  const [slicerEstimate, setSlicerEstimate] = useState<number | null>(null);
  const [thumbUri, setThumbUri] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSlicerEstimate(null);
    setThumbUri(null);
    if (!filename || !activeUrl) return;
    api
      .metadata(activeUrl, filename)
      .then((m: { estimated_time?: number; thumbnails?: { width?: number; relative_path?: string }[] }) => {
        if (!live) return;
        setSlicerEstimate(typeof m?.estimated_time === 'number' ? m.estimated_time : null);
        const thumbs = Array.isArray(m?.thumbnails) ? m.thumbnails : [];
        // Largest available — these are tiny either way, and the card is 76px.
        const best = thumbs.reduce<{ width?: number; relative_path?: string } | null>(
          (winner, current) => (!winner || (current.width ?? 0) > (winner.width ?? 0) ? current : winner),
          null
        );
        setThumbUri(
          best?.relative_path ? thumbnailUrl(activeUrl, filename, best.relative_path) : null
        );
      })
      .catch(() => {
        if (live) setThumbUri(null);
      });
    return () => {
      live = false;
    };
  }, [activeUrl, filename]);

  const progress = Math.max(0, Math.min(1, num(vsd.progress ?? status.display_status?.progress)));
  const printing = rawState === 'printing';
  const paused = rawState === 'paused';
  const activeJob = printing || paused;

  const etas = useMemo(
    () =>
      calculatePrintEtas({
        printDuration: num(ps.print_duration),
        slicerTotalSeconds: slicerEstimate,
        m73: null,
        fallbackProgress: progress,
      }),
    [progress, ps.print_duration, slicerEstimate]
  );

  // A finished job should only take over the dashboard if THIS session watched
  // it running. Without that gate, `print_stats.state` stays 'complete' long
  // after the fact and the card is stuck on a print from days ago.
  const finished = ['complete', 'cancelled', 'error'].includes(rawState);
  const jobKey = `${filename}|${rawState}`;
  const [observedLiveFilename, setObservedLiveFilename] = useState('');
  const [dismissedJob, setDismissedJob] = useState('');

  useEffect(() => {
    if (!activeJob || !filename) return;
    setObservedLiveFilename(filename);
    // A new run clears any earlier dismissal.
    setDismissedJob('');
  }, [activeJob, filename]);

  const observedFinished =
    finished && !!filename && observedLiveFilename === filename && dismissedJob !== jobKey;

  const state = useMemo<DashboardState>(() => {
    if (connection !== 'connected') return 'offline';
    if (klippyState === 'error' || klippyState === 'shutdown') return 'error';
    if (printing || paused) return 'printing';
    if (observedFinished) return rawState === 'error' ? 'error' : 'finished';
    return 'idle';
  }, [connection, klippyState, observedFinished, paused, printing, rawState]);

  // The Auto/Dry chips are gated on what the firmware actually speaks — those
  // commands are extras-registered, so probing gcodeHelp keeps the UI honest.
  const pandaBreath = useMemo<DashboardPandaBreath>(() => {
    const heater = findPandaBreathHeater(status);
    const pandaState = status.panda_breath ?? {};
    const supportsAuto =
      hasGcode(gcodeHelp, 'PANDA_BREATH_AUTO') || typeof pandaState.auto_target === 'number';
    const dryCommand: 'start' | 'run' | '' = hasGcode(gcodeHelp, 'PANDA_BREATH_DRY_START')
      ? 'start'
      : hasGcode(gcodeHelp, 'PANDA_BREATH_DRY_RUN')
        ? 'run'
        : '';
    const target = num(heater?.target);
    return {
      detected: !!heater,
      temp: num(heater?.temperature),
      target,
      mode: pandaModeLabel(pandaState, heater, target),
      supportsAuto,
      autoOn: pandaState.auto_enabled === true || Number(pandaState.work_mode) === 1,
      dryCommand,
      dryActive:
        pandaState.filament_drying_active === true ||
        Number(pandaState.remaining_seconds) > 0 ||
        Number(pandaState.work_mode) === 3,
    };
  }, [gcodeHelp, status]);

  const actions = useMemo<DashboardActions>(
    () => ({
      pause: () => void rpc('printer.print.pause').catch(() => {}),
      resume: () => void rpc('printer.print.resume').catch(() => {}),
      cancel: () => void rpc('printer.print.cancel').catch(() => {}),
      reprint: () => {
        if (!filename || !activeUrl) return;
        void api.startPrint(activeUrl, filename).catch(() => {});
      },
      dismissFinished: () => setDismissedJob(jobKey),
      emergencyStop: () => {
        void rpc('printer.emergency_stop').catch(() => {});
        // Belt and braces, matching the existing dashboard: hit both configured
        // URLs directly so a wedged websocket can't swallow the stop.
        const primary = normalizeMoonrakerUrl(settings.primaryUrl);
        const tailscale = normalizeMoonrakerUrl(settings.tailscaleUrl);
        if (primary) api.emergencyStop(primary).catch(() => {});
        if (tailscale && tailscale !== primary) api.emergencyStop(tailscale).catch(() => {});
      },
      runMacro: (name: string) => sendGcode(name),
      panda: {
        setTarget: (temp: number) => sendGcode(`M141 S${clampPandaTemp(temp)}`),
        setAuto: (temp: number, enabled: boolean) =>
          enabled
            ? sendGcode(
                `PANDA_BREATH_AUTO ENABLE=1 TARGET=${clampPandaTemp(temp)} FILTERTEMP=${PANDA_AUTO_FILTER_TEMP} HOTBEDTEMP=${PANDA_AUTO_HOTBED_TEMP}`
              )
            : sendGcode('PANDA_BREATH_AUTO ENABLE=0'),
        dry: (temp: number, hours: number) => {
          if (pandaBreath.dryCommand === 'start') {
            sendGcode(`PANDA_BREATH_DRY_START TEMP=${clampPandaTemp(temp)} HOURS=${hours}`);
          } else if (pandaBreath.dryCommand === 'run') {
            sendGcode(`PANDA_BREATH_DRY_RUN TARGET=${clampPandaTemp(temp)} DURATION=${hours * 60}`);
          }
        },
        stop: () => {
          const lines: string[] = [];
          if (pandaBreath.dryActive && hasGcode(gcodeHelp, 'PANDA_BREATH_DRY_STOP')) {
            lines.push('PANDA_BREATH_DRY_STOP');
          }
          if (pandaBreath.supportsAuto) lines.push('PANDA_BREATH_AUTO ENABLE=0');
          lines.push('M141 S0');
          sendGcode(lines.join('\n'));
        },
      },
    }),
    [
      activeUrl,
      filename,
      gcodeHelp,
      jobKey,
      pandaBreath.dryActive,
      pandaBreath.dryCommand,
      pandaBreath.supportsAuto,
      rpc,
      sendGcode,
      settings.primaryUrl,
      settings.tailscaleUrl,
    ]
  );

  const job = useMemo<DashboardJob | null>(() => {
    if (!filename) return null;
    const layer = ps.info?.current_layer ?? null;
    const layers = ps.info?.total_layer ?? null;
    return {
      name: filename.split('/').pop() ?? filename,
      progress,
      layer: typeof layer === 'number' ? layer : null,
      layers: typeof layers === 'number' && layers > 0 ? layers : null,
      remaining:
        etas.liveRemainingSeconds == null ? '--' : formatDuration(etas.liveRemainingSeconds),
      eta: etaClock(etas.liveRemainingSeconds),
      thumbUri,
    };
  }, [etas.liveRemainingSeconds, filename, progress, ps.info, thumbUri]);

  // ---------------------------------------------------------------- camera
  const activePrinter = settings.printers.find((p) => p.id === settings.activePrinterId);
  const baseUrl = activeUrl || (activePrinter ? printerConnectionUrl(activePrinter) : '');
  const camera = useMemo(() => {
    const url = resolveCameraUrl(settings.cameraUrl, baseUrl);
    if (!url) return null;
    const match = webcams.find((w) => resolveCameraUrl(w.stream_url, baseUrl) === url);
    return {
      url,
      snapshotUrl: resolveSnapshotUrl(match?.snapshot_url, settings.cameraUrl, baseUrl),
    };
  }, [baseUrl, settings.cameraUrl, webcams]);

  const guiScreen = useMemo(() => {
    const match = webcams.find(isGuiWebcam);
    if (!match) return null;
    const url = resolveCameraUrl(match.stream_url, baseUrl);
    if (!url) return null;
    return {
      url,
      snapshotUrl: resolveSnapshotUrl(match.snapshot_url, match.stream_url, baseUrl),
    };
  }, [baseUrl, webcams]);

  // ---------------------------------------------------------------- light
  // Mirrors the LED handling in app/(tabs)/index.tsx: find the first led-like
  // object, treat any non-zero channel as "on".
  const ledKey = useMemo(
    () => Object.keys(status).find((k) => /^(led|neopixel|dotstar)\s/.test(k)),
    [status]
  );
  const ledColors: number[][] = status[ledKey ?? '']?.color_data ?? [];
  const lightOn = ledColors.some((c) => Array.isArray(c) && c.some((v) => num(v) > 0));
  const toggleLight = useMemo(() => {
    if (!ledKey) return undefined;
    return () => {
      const name = ledKey.replace(/^(led|neopixel|dotstar)\s+/, '');
      const hasWhite = ledColors.some((c) => Array.isArray(c) && c.length > 3);
      const v = lightOn ? 0 : 1;
      sendGcode(
        hasWhite
          ? `SET_LED LED=${name} RED=0 GREEN=0 BLUE=0 WHITE=${v} SYNC=0`
          : `SET_LED LED=${name} RED=${v} GREEN=${v} BLUE=${v} SYNC=0`
      );
    };
  }, [ledColors, ledKey, lightOn, sendGcode]);

  // ---------------------------------------------------------------- misc
  const visibleMacros = useMemo(
    () =>
      filterMacrosForDisplay(
        macros,
        getMacroDisplay({
          activePrinterId: settings.activePrinterId,
          macroDisplayByPrinter: settings.macroDisplayByPrinter,
        })
      ),
    [macros, settings.activePrinterId, settings.macroDisplayByPrinter]
  );

  return {
    printerName: activePrinter?.name || t('Printer'),
    online: connected,
    connectionLabel:
      connection === 'connected'
        ? klippyState === 'ready'
          ? t('Online')
          : `Klipper: ${klippyState}`
        : connection === 'connecting'
          ? t('Connecting…')
          : t('Offline'),
    state,
    paused,
    errorMessage:
      (typeof ps.message === 'string' && ps.message) ||
      (typeof status.webhooks?.state_message === 'string' && status.webhooks.state_message) ||
      '',
    job: activeJob || observedFinished ? job : null,
    tools,
    temps,
    macros: visibleMacros,
    camera,
    guiScreen,
    lightOn,
    toggleLight,
    pandaBreath,
    actions,
  };
}
