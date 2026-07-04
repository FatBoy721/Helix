import { normalizeMacroDisplayByPrinter } from './macroDisplay';
import type { MacroDisplaySettings } from './macroDisplay';
import { normalizeMoonrakerUrl } from './moonraker';
import { normalizeTemperatureUnit } from './temperature';
import type { TemperatureUnit } from './temperature';

export interface PrinterEntry {
  id: string;
  name: string;
  url: string;
  tailscaleUrl: string;
  cameraUrl: string;
}

export interface DashboardSections {
  progress: boolean;
  actions: boolean;
  estop: boolean;
  homeDock: boolean;
  controls: boolean;
  pandaBreath: boolean;
  temps: boolean;
  camera: boolean;
  macros: boolean;
}

export type NotificationMode = 'off' | 'local' | 'ntfy';

export interface Settings {
  settingsVersion: number;
  primaryUrl: string;
  tailscaleUrl: string;
  cameraUrl: string;
  printers: PrinterEntry[];
  activePrinterId: string;
  dashboard: DashboardSections;
  macroDisplayByPrinter: Record<string, MacroDisplaySettings>;
  notificationMode: NotificationMode;
  ntfyServer: string;
  ntfyTopic: string;
  notifyPrintComplete: boolean;
  notifyPrintFailed: boolean;
  notifyPrintPaused: boolean;
  notifyFilamentRunout: boolean;
  notifySwapComplete: boolean;
  notifyPrinterError: boolean;
  notifyPrinterDisconnected: boolean;
  notifyTempWarning: boolean;
  aceUnits: number;
  accentColor: string;
  language: string;
  temperatureUnit: TemperatureUnit;
}

export const STORAGE_VERSION = 6;

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: STORAGE_VERSION,
  primaryUrl: 'http://192.168.1.17:7125',
  tailscaleUrl: '',
  cameraUrl: '/webcam/webrtc',
  printers: [],
  activePrinterId: '',
  dashboard: {
    progress: true,
    actions: true,
    estop: true,
    homeDock: true,
    controls: true,
    pandaBreath: false,
    temps: true,
    camera: true,
    macros: false,
  },
  macroDisplayByPrinter: {},
  notificationMode: 'local',
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  notifyPrintComplete: true,
  notifyPrintFailed: true,
  notifyPrintPaused: true,
  notifyFilamentRunout: true,
  notifySwapComplete: true,
  notifyPrinterError: true,
  notifyPrinterDisconnected: true,
  notifyTempWarning: true,
  aceUnits: 1,
  accentColor: '#2196f3',
  language: 'en',
  temperatureUnit: 'c',
};

function stringValue(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

function booleanValue(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function numberValue(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function notificationMode(raw: unknown, ntfyTopic?: unknown): NotificationMode {
  if (raw === 'off' || raw === 'local' || raw === 'ntfy') return raw;
  return stringValue(ntfyTopic)?.trim() ? 'ntfy' : DEFAULT_SETTINGS.notificationMode;
}

function normalizeDashboard(raw: unknown): DashboardSections {
  const dashboard = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Partial<DashboardSections>)
    : {};

  return {
    progress: booleanValue(dashboard.progress, DEFAULT_SETTINGS.dashboard.progress),
    actions: booleanValue(dashboard.actions, DEFAULT_SETTINGS.dashboard.actions),
    estop: booleanValue(dashboard.estop, DEFAULT_SETTINGS.dashboard.estop),
    homeDock: booleanValue(dashboard.homeDock, DEFAULT_SETTINGS.dashboard.homeDock),
    controls: booleanValue(dashboard.controls, DEFAULT_SETTINGS.dashboard.controls),
    pandaBreath: booleanValue(dashboard.pandaBreath, DEFAULT_SETTINGS.dashboard.pandaBreath),
    temps: booleanValue(dashboard.temps, DEFAULT_SETTINGS.dashboard.temps),
    camera: booleanValue(dashboard.camera, DEFAULT_SETTINGS.dashboard.camera),
    macros: booleanValue(dashboard.macros, DEFAULT_SETTINGS.dashboard.macros),
  };
}

function normalizePrinter(raw: unknown, index: number): PrinterEntry {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Partial<PrinterEntry>)
    : {};

  return {
    id: stringValue(p.id) || `p${index + 1}`,
    name: stringValue(p.name) || `Snapmaker ${index + 1}`,
    url: normalizeMoonrakerUrl(stringValue(p.url) || DEFAULT_SETTINGS.primaryUrl),
    tailscaleUrl: normalizeMoonrakerUrl(stringValue(p.tailscaleUrl) || ''),
    cameraUrl: stringValue(p.cameraUrl) || DEFAULT_SETTINGS.cameraUrl,
  };
}

export function migrateSettings(raw: Partial<Settings>): Settings {
  const parsed = { ...raw };
  if (
    parsed.cameraUrl === 'http://192.168.1.17/webcam/stream' ||
    parsed.cameraUrl === '/webcam/stream.mjpg'
  ) {
    parsed.cameraUrl = DEFAULT_SETTINGS.cameraUrl;
  }

  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    settingsVersion: STORAGE_VERSION,
    primaryUrl: normalizeMoonrakerUrl(stringValue(parsed.primaryUrl) || DEFAULT_SETTINGS.primaryUrl),
    tailscaleUrl: normalizeMoonrakerUrl(stringValue(parsed.tailscaleUrl) || ''),
    cameraUrl: stringValue(parsed.cameraUrl) || DEFAULT_SETTINGS.cameraUrl,
    dashboard: normalizeDashboard(parsed.dashboard),
    macroDisplayByPrinter: normalizeMacroDisplayByPrinter(parsed.macroDisplayByPrinter),
    notificationMode: notificationMode(parsed.notificationMode, parsed.ntfyTopic),
    ntfyServer: stringValue(parsed.ntfyServer) || DEFAULT_SETTINGS.ntfyServer,
    ntfyTopic: stringValue(parsed.ntfyTopic) || DEFAULT_SETTINGS.ntfyTopic,
    notifyPrintComplete: booleanValue(
      parsed.notifyPrintComplete,
      DEFAULT_SETTINGS.notifyPrintComplete
    ),
    notifyPrintFailed: booleanValue(parsed.notifyPrintFailed, DEFAULT_SETTINGS.notifyPrintFailed),
    notifyPrintPaused: booleanValue(parsed.notifyPrintPaused, DEFAULT_SETTINGS.notifyPrintPaused),
    notifyFilamentRunout: booleanValue(
      parsed.notifyFilamentRunout,
      DEFAULT_SETTINGS.notifyFilamentRunout
    ),
    notifySwapComplete: booleanValue(
      parsed.notifySwapComplete,
      DEFAULT_SETTINGS.notifySwapComplete
    ),
    notifyPrinterError: booleanValue(
      parsed.notifyPrinterError,
      DEFAULT_SETTINGS.notifyPrinterError
    ),
    notifyPrinterDisconnected: booleanValue(
      parsed.notifyPrinterDisconnected,
      DEFAULT_SETTINGS.notifyPrinterDisconnected
    ),
    notifyTempWarning: booleanValue(parsed.notifyTempWarning, DEFAULT_SETTINGS.notifyTempWarning),
    aceUnits: numberValue(parsed.aceUnits, DEFAULT_SETTINGS.aceUnits),
    accentColor: stringValue(parsed.accentColor) || DEFAULT_SETTINGS.accentColor,
    language: stringValue(parsed.language) || DEFAULT_SETTINGS.language,
    temperatureUnit: normalizeTemperatureUnit(parsed.temperatureUnit),
    printers: Array.isArray(parsed.printers)
      ? parsed.printers.map((p, index) => normalizePrinter(p, index))
      : [],
  };

  if (!merged.printers.length) {
    merged.printers = [
      {
        id: 'p1',
        name: 'Snapmaker U1',
        url: merged.primaryUrl,
        tailscaleUrl: merged.tailscaleUrl,
        cameraUrl: merged.cameraUrl,
      },
    ];
    merged.activePrinterId = 'p1';
  }

  if (!merged.printers.some((p) => p.id === merged.activePrinterId)) {
    const active = merged.printers[0];
    merged.activePrinterId = active.id;
    merged.primaryUrl = active.url;
    merged.tailscaleUrl = active.tailscaleUrl;
    merged.cameraUrl = active.cameraUrl;
  }

  if (merged.primaryUrl === DEFAULT_SETTINGS.primaryUrl && merged.printers.length > 1) {
    const configured = [...merged.printers]
      .reverse()
      .find((p) => p.url && p.url !== DEFAULT_SETTINGS.primaryUrl);
    if (configured) {
      merged.activePrinterId = configured.id;
      merged.primaryUrl = configured.url;
      merged.tailscaleUrl = configured.tailscaleUrl;
      merged.cameraUrl = configured.cameraUrl;
    }
  }

  merged.printers = merged.printers.map((p) =>
    p.id === merged.activePrinterId
      ? {
          ...p,
          url: merged.primaryUrl,
          tailscaleUrl: merged.tailscaleUrl,
          cameraUrl: merged.cameraUrl,
        }
      : p
  );

  return merged;
}
