import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setLanguage } from '../services/i18n';
import { colors } from '../constants/theme';

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
        applyAppearance(merged);
        setSettings(merged);
      } catch {
        // corrupt/missing settings — fall back to defaults
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      applyAppearance(next);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
