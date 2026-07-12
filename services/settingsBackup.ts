// Settings export/import for migrating between installs (e.g. the one-time
// signing-key reinstall). Export shares a JSON file; import accepts pasted
// JSON and runs it through the normal settings migration.

import { DEFAULT_SETTINGS, migrateSettings } from './settingsMigration';
import type { Settings } from './settingsMigration';

const BACKUP_KIND = 'helix-settings-backup';

export interface SettingsBackup {
  kind: typeof BACKUP_KIND;
  version: 1;
  exportedAt: string;
  settings: Settings;
}

function buildSettingsBackup(settings: Settings): string {
  const backup: SettingsBackup = {
    kind: BACKUP_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Parses pasted backup text. Accepts the wrapped backup format or a raw
 * settings object (the AsyncStorage blob), so a tester can paste either.
 * Throws with a user-readable message when the text is not a Helix backup.
 */
export function parseSettingsBackup(text: string): Settings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error('That is not valid JSON. Paste the whole backup text.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('That does not look like a Helix settings backup.');
  }

  const obj = parsed as Record<string, unknown>;
  const raw = obj.kind === BACKUP_KIND && obj.settings && typeof obj.settings === 'object'
    ? (obj.settings as Record<string, unknown>)
    : obj;

  // A real backup carries at least one known settings key; reject random JSON.
  const knownKeys = Object.keys(DEFAULT_SETTINGS);
  if (!Object.keys(raw).some((key) => knownKeys.includes(key))) {
    throw new Error('That does not look like a Helix settings backup.');
  }

  return migrateSettings(raw as Partial<Settings>);
}

/** Writes the backup JSON to a temp file and opens the Android share sheet. */
export async function shareSettingsBackup(settings: Settings): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const Sharing = await import('expo-sharing');

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileUri = `${FileSystem.cacheDirectory}helix-settings-${stamp}.json`;
  await FileSystem.writeAsStringAsync(fileUri, buildSettingsBackup(settings));

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: 'Save Helix settings backup',
  });
}
