import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setLanguage } from '../services/i18n';
import { colors } from '../constants/theme';
import { normalizeMoonrakerUrl } from '../services/moonraker';

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
  temps: boolean;
  camera: boolean;
}

export interface Settings {
  settingsVersion: number;
  primaryUrl: string;
  tailscaleUrl: string;
  cameraUrl: string;
  printers: PrinterEntry[];
  activePrinterId: string;
  dashboard: DashboardSections;
  ntfyServer: string;
  ntfyTopic: string;
  notifyPrintComplete: boolean;
  notifyPrintFailed: boolean;
  notifyFilamentRunout: boolean;
  notifySwapComplete: boolean;
  notifyPrinterError: boolean;
  aceUnits: number;
  accentColor: string;
  language: string;
}

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 2,
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
    temps: true,
    camera: true,
  },
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  notifyPrintComplete: true,
  notifyPrintFailed: true,
  notifyFilamentRunout: true,
  notifySwapComplete: true,
  notifyPrinterError: true,
  aceUnits: 1,
  accentColor: '#2196f3',
  language: 'en',
};

// theming gotcha that ate an afternoon: StyleSheet.create runs at import time
// so anything in there is frozen forever. colors.primary is mutated here and
// every accent-colored style reads it INLINE at render instead. if you add a
// new accent-colored thing, don't put colors.primary in a StyleSheet.
function applyAppearance(s: Settings) {
  colors.primary = s.accentColor || DEFAULT_SETTINGS.accentColor;
  setLanguage(s.language || 'en');
}

const STORAGE_KEY = 'u1control.settings.v1';
const STORAGE_VERSION = 2;

function normalizePrinter(p: Partial<PrinterEntry>, index: number): PrinterEntry {
  return {
    id: p.id || `p${index + 1}`,
    name: p.name || `Snapmaker ${index + 1}`,
    url: normalizeMoonrakerUrl(p.url || DEFAULT_SETTINGS.primaryUrl),
    tailscaleUrl: normalizeMoonrakerUrl(p.tailscaleUrl || ''),
    cameraUrl: p.cameraUrl || DEFAULT_SETTINGS.cameraUrl,
  };
}

function migrateSettings(raw: Partial<Settings>): Settings {
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
    primaryUrl: normalizeMoonrakerUrl(parsed.primaryUrl || DEFAULT_SETTINGS.primaryUrl),
    tailscaleUrl: normalizeMoonrakerUrl(parsed.tailscaleUrl || ''),
    cameraUrl: parsed.cameraUrl || DEFAULT_SETTINGS.cameraUrl,
    dashboard: { ...DEFAULT_SETTINGS.dashboard, ...(parsed.dashboard ?? {}) },
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

  if (
    merged.primaryUrl === DEFAULT_SETTINGS.primaryUrl &&
    merged.printers.length > 1
  ) {
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

interface SettingsContextValue {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        // Migrate previous defaults: /webcam/stream 404s on PAXX; stream.mjpg
        // lags (35 Mbit/s MJPEG) — WebRTC is the intended realtime stream.
        if (
          parsed.cameraUrl === 'http://192.168.1.17/webcam/stream' ||
          parsed.cameraUrl === '/webcam/stream.mjpg'
        ) {
          parsed.cameraUrl = DEFAULT_SETTINGS.cameraUrl;
        }
        const merged: Settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          dashboard: { ...DEFAULT_SETTINGS.dashboard, ...(parsed.dashboard ?? {}) },
        };
        // migrate single-printer settings into the printers list (also seeds
        // the very first launch)
        if (!merged.printers?.length) {
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
        if (
          merged.primaryUrl === DEFAULT_SETTINGS.primaryUrl &&
          merged.printers.length > 1
        ) {
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
        const migrated = migrateSettings(merged);
        applyAppearance(migrated);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)).catch(() => {});
        setSettings(migrated);
      } catch {
        // corrupt/missing settings — fall back to defaults
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    let nextSettings = DEFAULT_SETTINGS;
    setSettings((prev) => {
      const next = migrateSettings({ ...prev, ...patch });
      nextSettings = next;
      applyAppearance(next);
      return next;
    });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
  }, []);

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
