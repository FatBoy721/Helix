import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Settings } from '../hooks/useSettings';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function initNotifications(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Printer events',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    await ensureNotificationPermission();
  } catch {
    // notifications unavailable (e.g. web) — non-fatal
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

function normalizeNtfyServer(input: string): string {
  let server = (input || '').trim();
  if (!server) return '';
  if (!/^https?:\/\//i.test(server)) server = `https://${server}`;
  return server.replace(/\/+$/, '');
}

export function generateNtfyTopic(prefix = 'helix'): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 22; i += 1) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${token}`;
}

export async function sendNtfy(
  server: string,
  topic: string,
  title: string,
  message: string,
  priority = 4,
  tags = ''
): Promise<boolean> {
  const base = normalizeNtfyServer(server);
  if (!base || !topic.trim()) return false;
  try {
    const res = await fetch(`${base}/${encodeURIComponent(topic.trim())}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: String(priority),
        ...(tags ? { Tags: tags } : {}),
      },
      body: message,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyLocal(title: string, body: string): Promise<boolean> {
  try {
    const allowed = await ensureNotificationPermission();
    if (!allowed) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

export type NotifyKind =
  | 'complete'
  | 'failed'
  | 'paused'
  | 'runout'
  | 'swap'
  | 'error'
  | 'disconnected'
  | 'temp';

export async function notifyEvent(
  settings: Settings,
  kind: NotifyKind,
  title: string,
  message: string
): Promise<void> {
  const enabled: Record<NotifyKind, boolean> = {
    complete: settings.notifyPrintComplete,
    failed: settings.notifyPrintFailed,
    paused: settings.notifyPrintPaused,
    runout: settings.notifyFilamentRunout,
    swap: settings.notifySwapComplete,
    error: settings.notifyPrinterError,
    disconnected: settings.notifyPrinterDisconnected,
    temp: settings.notifyTempWarning,
  };
  if (!enabled[kind] || settings.notificationMode === 'off') return;

  const tags: Record<NotifyKind, string> = {
    complete: 'white_check_mark,printer',
    failed: 'rotating_light,printer',
    paused: 'pause_button,printer',
    runout: 'warning,printer',
    swap: 'arrows_counterclockwise,printer',
    error: 'rotating_light,fire',
    disconnected: 'electric_plug,printer',
    temp: 'thermometer,warning',
  };
  const priority =
    kind === 'failed' ||
    kind === 'runout' ||
    kind === 'error' ||
    kind === 'disconnected' ||
    kind === 'temp'
      ? 5
      : 4;

  if (settings.notificationMode === 'ntfy') {
    const sent = await sendNtfy(
      settings.ntfyServer,
      settings.ntfyTopic,
      title,
      message,
      priority,
      tags[kind]
    );
    if (sent) return;
  }

  if (settings.notificationMode === 'local' || settings.notificationMode === 'ntfy') {
    await notifyLocal(title, message);
  }
}
