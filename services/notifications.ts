import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { normalizeBaseUrl } from './moonraker';
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
    await Notifications.requestPermissionsAsync();
  } catch {
    // notifications unavailable (e.g. web) — non-fatal
  }
}

export async function sendNtfy(
  server: string,
  topic: string,
  title: string,
  message: string,
  priority = 4,
  tags = ''
): Promise<boolean> {
  const base = normalizeBaseUrl(server);
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

export async function notifyLocal(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // ignore — local notifications are a best-effort fallback
  }
}

export type NotifyKind = 'complete' | 'failed' | 'runout' | 'swap' | 'error';

export async function notifyEvent(
  settings: Settings,
  kind: NotifyKind,
  title: string,
  message: string
): Promise<void> {
  const enabled: Record<NotifyKind, boolean> = {
    complete: settings.notifyPrintComplete,
    failed: settings.notifyPrintFailed,
    runout: settings.notifyFilamentRunout,
    swap: settings.notifySwapComplete,
    error: settings.notifyPrinterError,
  };
  if (!enabled[kind]) return;

  const tags: Record<NotifyKind, string> = {
    complete: 'white_check_mark,printer',
    failed: 'rotating_light,printer',
    runout: 'warning,printer',
    swap: 'arrows_counterclockwise,printer',
    error: 'rotating_light,fire',
  };
  const priority = kind === 'failed' || kind === 'runout' || kind === 'error' ? 5 : 4;

  sendNtfy(settings.ntfyServer, settings.ntfyTopic, title, message, priority, tags[kind]).catch(
    () => {}
  );
  notifyLocal(title, message).catch(() => {});
}
