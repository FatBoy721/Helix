import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setLanguage } from '../services/i18n';
import { colors } from '../constants/theme';
import { colors as cockpitColors } from '../components/settings/cockpitTheme';
import { setAccent } from '../components/dashboard/shared';
import { setNativeAiDetectionSensitivity } from '../services/nativeSlicer';
import { DEFAULT_SETTINGS, migrateSettings } from '../services/settingsMigration';
import type { Settings } from '../services/settingsMigration';

export {
  DEFAULT_MACRO_DISPLAY,
  getMacroDisplay,
} from '../services/macroDisplay';
export type { MacroDisplayMode, MacroDisplaySettings } from '../services/macroDisplay';
export { DEFAULT_SETTINGS } from '../services/settingsMigration';
export type {
  DashboardSections,
  ConnectionMode,
  NotificationMode,
  PrinterEntry,
  Settings,
} from '../services/settingsMigration';

// The accent has to land on three separate objects because each surface reads a
// different one: the dashboard reads `COCKPIT` (via setAccent), the Settings
// screen reads `cockpitColors.primary`, and the older tabs (files, slicer, ace,
// progress ring, …) read `colors.primary`. StyleSheet.create values are baked at
// module load, so accent styles must be read inline to pick this mutation up.
function applyAppearance(s: Settings) {
  const accent = s.accentColor || DEFAULT_SETTINGS.accentColor;
  setAccent(accent);
  cockpitColors.primary = accent;
  colors.primary = accent;
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
  // Source of truth for update(): updated synchronously so rapid updates
  // compose and the persisted JSON never captures a stale snapshot.
  const latestRef = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const migrated = migrateSettings(parsed);
        applyAppearance(migrated);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)).catch(() => {});
        latestRef.current = migrated;
        setSettings(migrated);
        // Printer transport must not wait on an unrelated native preference
        // mirror. On a cold Android launch the bridge can still be warming up,
        // which used to delay `loaded` and therefore the initial connection.
        void setNativeAiDetectionSensitivity(migrated.aiDetectionSensitivity).catch(() => {});
      } catch {
        // corrupt/missing settings — fall back to defaults
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = migrateSettings({ ...latestRef.current, ...patch });
    latestRef.current = next;
    applyAppearance(next);
    setSettings(next);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)),
      setNativeAiDetectionSensitivity(next.aiDetectionSensitivity),
    ]);
  }, []);

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
