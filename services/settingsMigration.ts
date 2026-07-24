import { normalizeMacroDisplayByPrinter } from './macroDisplay';
import type { MacroDisplaySettings } from './macroDisplay';
import { normalizeMoonrakerUrl } from './moonraker';
import { normalizeTemperatureUnit } from './temperature';
import type { TemperatureUnit } from './temperature';
import {
  DEFAULT_FILAMENT_SLOT_COLORS,
  normalizeFilamentSlotColors,
} from '../constants/filamentColors';
import { DEFAULT_FILAMENT_SUBTYPE } from './filamentMaterials';

export interface PrinterEntry {
  id: string;
  name: string;
  url: string;
  tailscaleUrl: string;
  cameraUrl: string;
  connectionMode: ConnectionMode;
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
  gui: boolean;
  filaments: boolean;
  macros: boolean;
}

export type NotificationMode = 'off' | 'local' | 'ntfy' | 'fcm';
export type ConnectionMode = 'auto' | 'lan' | 'tailscale';

export interface Settings {
  settingsVersion: number;
  primaryUrl: string;
  tailscaleUrl: string;
  cameraUrl: string;
  connectionMode: ConnectionMode;
  printers: PrinterEntry[];
  activePrinterId: string;
  dashboard: DashboardSections;
  /** Show a confirmation dialog before firing the emergency stop. */
  estopConfirm: boolean;
  macroDisplayByPrinter: Record<string, MacroDisplaySettings>;
  notificationMode: NotificationMode;
  ntfyServer: string;
  ntfyTopic: string;
  notifyPrintComplete: boolean;
  notifyPrintFailed: boolean;
  notifyPrintPaused: boolean;
  notifyPrintCancelled: boolean;
  notifyPrintProgress: boolean;
  notifyFilamentRunout: boolean;
  notifySwapComplete: boolean;
  notifyPrinterError: boolean;
  notifyPrinterDisconnected: boolean;
  notifyTempWarning: boolean;
  aceUnits: number;
  accentColor: string;
  language: string;
  temperatureUnit: TemperatureUnit;
  /** Hex colours for the four physical filament slots (T0–T3), used by paint/preview. */
  filamentSlotColors: string[];
  /** Manual fallback material labels for the four physical filament slots. */
  filamentSlotMaterials: string[];
  /** Manual fallback subtype labels (CF, Silk, Matte, ...) for the four physical filament slots. */
  filamentSlotSubtypes: string[];
  /** Manual fallback brand labels for the four physical filament slots. */
  filamentSlotBrands: string[];
  /** Ids of in-app notifications the user has already opened. */
  seenNotificationIds: string[];
}

export const STORAGE_VERSION = 11;
export const LEGACY_DEFAULT_PRIMARY_URL = 'http://192.168.1.17:7125';

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: STORAGE_VERSION,
  primaryUrl: '',
  tailscaleUrl: '',
  cameraUrl: '/webcam/webrtc',
  connectionMode: 'lan',
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
    gui: true,
    filaments: true,
    macros: false,
  },
  estopConfirm: true,
  macroDisplayByPrinter: {},
  notificationMode: 'fcm',
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  notifyPrintComplete: true,
  notifyPrintFailed: true,
  notifyPrintPaused: true,
  notifyPrintCancelled: true,
  notifyPrintProgress: false,
  notifyFilamentRunout: true,
  notifySwapComplete: true,
  notifyPrinterError: true,
  notifyPrinterDisconnected: true,
  notifyTempWarning: true,
  aceUnits: 1,
  accentColor: '#2196f3',
  language: 'en',
  temperatureUnit: 'c',
  filamentSlotColors: [...DEFAULT_FILAMENT_SLOT_COLORS],
  filamentSlotMaterials: ['PLA', 'PLA', 'PLA', 'PLA'],
  filamentSlotSubtypes: [DEFAULT_FILAMENT_SUBTYPE, DEFAULT_FILAMENT_SUBTYPE, DEFAULT_FILAMENT_SUBTYPE, DEFAULT_FILAMENT_SUBTYPE],
  filamentSlotBrands: ['Generic', 'Generic', 'Generic', 'Generic'],
  seenNotificationIds: [],
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
  if (raw === 'off' || raw === 'local' || raw === 'ntfy' || raw === 'fcm') return raw;
  return stringValue(ntfyTopic)?.trim() ? 'ntfy' : DEFAULT_SETTINGS.notificationMode;
}

export function normalizeConnectionMode(raw: unknown): ConnectionMode {
  return raw === 'auto' || raw === 'lan' || raw === 'tailscale'
    ? raw
    : DEFAULT_SETTINGS.connectionMode;
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
    gui: booleanValue(dashboard.gui, DEFAULT_SETTINGS.dashboard.gui),
    filaments: booleanValue(dashboard.filaments, DEFAULT_SETTINGS.dashboard.filaments),
    macros: booleanValue(dashboard.macros, DEFAULT_SETTINGS.dashboard.macros),
  };
}

function normalizeFilamentSlotMaterials(raw: unknown): string[] {
  const src = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 4 }, (_, i) => {
    const value = stringValue(src[i])?.trim().toUpperCase();
    return value || DEFAULT_SETTINGS.filamentSlotMaterials[i];
  });
}

function normalizeFilamentSlotSubtypes(raw: unknown): string[] {
  const src = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 4 }, (_, i) => {
    const value = stringValue(src[i])?.trim();
    return value || DEFAULT_SETTINGS.filamentSlotSubtypes[i];
  });
}

function normalizeFilamentSlotBrands(raw: unknown): string[] {
  const src = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 4 }, (_, i) => {
    const value = stringValue(src[i])?.trim();
    return value || DEFAULT_SETTINGS.filamentSlotBrands[i];
  });
}

function normalizePrinter(raw: unknown, index: number): PrinterEntry {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Partial<PrinterEntry>)
    : {};

  return {
    id: stringValue(p.id) || `p${index + 1}`,
    name: stringValue(p.name) || `Snapmaker ${index + 1}`,
    url: normalizeMoonrakerUrl(stringValue(p.url) || ''),
    tailscaleUrl: normalizeMoonrakerUrl(stringValue(p.tailscaleUrl) || ''),
    cameraUrl: stringValue(p.cameraUrl) || DEFAULT_SETTINGS.cameraUrl,
    connectionMode: normalizeConnectionMode(p.connectionMode),
  };
}

export function migrateSettings(raw: Partial<Settings>): Settings {
  const parsed = { ...raw };
  const parsedPrimaryUrl = normalizeMoonrakerUrl(stringValue(parsed.primaryUrl) || '');
  const parsedTailscaleUrl = normalizeMoonrakerUrl(stringValue(parsed.tailscaleUrl) || '');
  const parsedConnectionMode = normalizeConnectionMode(parsed.connectionMode);
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
    primaryUrl: parsedPrimaryUrl,
    tailscaleUrl: parsedTailscaleUrl,
    cameraUrl: stringValue(parsed.cameraUrl) || DEFAULT_SETTINGS.cameraUrl,
    connectionMode: parsedConnectionMode,
    dashboard: normalizeDashboard(parsed.dashboard),
    estopConfirm: booleanValue(parsed.estopConfirm, DEFAULT_SETTINGS.estopConfirm),
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
    notifyPrintCancelled: booleanValue(
      parsed.notifyPrintCancelled,
      DEFAULT_SETTINGS.notifyPrintCancelled
    ),
    notifyPrintProgress: booleanValue(
      parsed.notifyPrintProgress,
      DEFAULT_SETTINGS.notifyPrintProgress
    ),
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
    filamentSlotColors: normalizeFilamentSlotColors(parsed.filamentSlotColors),
    filamentSlotMaterials: normalizeFilamentSlotMaterials(parsed.filamentSlotMaterials),
    filamentSlotSubtypes: normalizeFilamentSlotSubtypes(parsed.filamentSlotSubtypes),
    filamentSlotBrands: normalizeFilamentSlotBrands(parsed.filamentSlotBrands),
    seenNotificationIds: Array.isArray(parsed.seenNotificationIds)
      ? parsed.seenNotificationIds.filter((id): id is string => typeof id === 'string')
      : [],
    printers: Array.isArray(parsed.printers)
      ? parsed.printers
          .map((p, index) => normalizePrinter(p, index))
          .filter((p) => p.url || p.tailscaleUrl)
      : [],
  };

  if (!merged.printers.length) {
    if (merged.primaryUrl || merged.tailscaleUrl) {
      merged.printers = [
        {
          id: 'p1',
          name: 'Snapmaker U1',
          url: merged.primaryUrl,
          tailscaleUrl: merged.tailscaleUrl,
          cameraUrl: merged.cameraUrl,
          connectionMode: merged.connectionMode,
        },
      ];
      merged.activePrinterId = 'p1';
    } else {
      merged.activePrinterId = '';
    }
  }

  if (merged.printers.length && !merged.printers.some((p) => p.id === merged.activePrinterId)) {
    const active = merged.printers[0];
    merged.activePrinterId = active.id;
    merged.primaryUrl = active.url;
    merged.tailscaleUrl = active.tailscaleUrl;
    merged.cameraUrl = active.cameraUrl;
    merged.connectionMode = active.connectionMode;
  }

  const selectedPrinter = merged.printers.find((p) => p.id === merged.activePrinterId);
  if (selectedPrinter) {
    if (!stringValue(parsed.primaryUrl)) merged.primaryUrl = selectedPrinter.url;
    if (!stringValue(parsed.tailscaleUrl)) merged.tailscaleUrl = selectedPrinter.tailscaleUrl;
    if (!stringValue(parsed.cameraUrl)) merged.cameraUrl = selectedPrinter.cameraUrl;
    if (!stringValue(parsed.connectionMode)) merged.connectionMode = selectedPrinter.connectionMode;
  }

  merged.printers = merged.printers.map((p) =>
    p.id === merged.activePrinterId
      ? {
          ...p,
          url: merged.primaryUrl,
          tailscaleUrl: merged.tailscaleUrl,
          cameraUrl: merged.cameraUrl,
          connectionMode: merged.connectionMode,
        }
      : p
  );

  return merged;
}
