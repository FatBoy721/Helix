import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setLanguage } from '../services/i18n';
import { colors } from '../constants/theme';
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

// StyleSheet.create captures color values at module load time. Accent-colored
// styles should read colors.primary at render time after this mutation runs.
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
        const migrated = migrateSettings(parsed);
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
