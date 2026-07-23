import { NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import type { Settings } from '../hooks/useSettings';
import {
  FCM_ANNOUNCEMENTS_KEY,
  type AppNotification,
} from '../constants/changelog';
import { restartMoonraker, uploadConfigFile } from './moonraker';
import { withQueryParameter } from './notificationEvents';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FCM_TOKEN_KEY = 'helix.fcm.device-token.v1';
const FCM_CONFIGURED_TOKEN_KEY = 'helix.fcm.configured-registration.v3';
const HELIX_RELAY_URL = 'https://us-east1-helix-edba4.cloudfunctions.net/relay';

type HelixSlicerNotificationsModule = {
  subscribeToFcmAnnouncements?: () => Promise<boolean>;
  getFcmToken?: () => Promise<string>;
};

export type PrinterEvent =
  | 'print_complete'
  | 'print_failed'
  | 'paused'
  | 'runout'
  | 'swap_complete'
  | 'printer_error'
  | 'printer_disconnected'
  | 'temperature_warning';

export interface PrinterEventPayload {
  type: 'printer_event';
  event: PrinterEvent;
  printerId: string;
  title: string;
  body: string;
  route?: string;
  routeParams?: Record<string, string>;
}

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

    Notifications.addNotificationResponseReceivedListener((response) => {
      cacheAnnouncement(response.notification.request.content);
      routeNotificationTap(response.notification.request.content.data);
    });

    Notifications.addNotificationReceivedListener((notification) => {
      cacheAnnouncement(notification.request.content);
    });

    const initialResponse = await Notifications.getLastNotificationResponseAsync();
    if (initialResponse) {
      cacheAnnouncement(initialResponse.notification.request.content);
      routeNotificationTap(initialResponse.notification.request.content.data);
    }

    Notifications.addPushTokenListener(({ data }) => {
      if (Platform.OS === 'android' && typeof data === 'string') {
        SecureStore.setItemAsync(FCM_TOKEN_KEY, data).catch(() => {});
      }
    });
  } catch {
    // notifications unavailable (e.g. web) — non-fatal
  }
}

function cacheAnnouncement(content: Notifications.NotificationContent): void {
  const data = content.data as Record<string, unknown> | undefined;
  if (data?.type === 'helix_test') return;

  const title = typeof content.title === 'string' ? content.title.trim() : '';
  const body = typeof content.body === 'string' ? content.body.trim() : '';
  if (!title && !body) return;

  const suppliedId = typeof data?.announcementId === 'string' ? data.announcementId.trim() : '';
  const item: AppNotification = {
    id: suppliedId || `fcm-${Date.now()}`,
    type: data?.type === 'printer_event' ? 'alert' : 'changelog',
    title: title || 'Helix update',
    date: new Date().toISOString().slice(0, 10),
    body,
  };

  AsyncStorage.getItem(FCM_ANNOUNCEMENTS_KEY)
    .then((raw) => {
      const existing = raw ? JSON.parse(raw) : [];
      const items = Array.isArray(existing) ? existing : [];
      const next = [item, ...items.filter((entry) => entry?.id !== item.id)].slice(0, 50);
      return AsyncStorage.setItem(FCM_ANNOUNCEMENTS_KEY, JSON.stringify(next));
    })
    .catch(() => {});
}

/** Gets and securely stores the native Android FCM token. */
export async function registerFcmDeviceToken(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const allowed = await ensureNotificationPermission();
    if (!allowed) return null;

    const native = NativeModules.HelixSlicer as HelixSlicerNotificationsModule | undefined;
    if (native?.getFcmToken) {
      const token = await native.getFcmToken();
      if (token) {
        await SecureStore.setItemAsync(FCM_TOKEN_KEY, token);
        return token;
      }
    }

    const token = await Notifications.getDevicePushTokenAsync();
    if (token.type !== 'fcm' || typeof token.data !== 'string' || !token.data) return null;
    await SecureStore.setItemAsync(FCM_TOKEN_KEY, token.data);
    return token.data;
  } catch {
    // Firebase is intentionally optional for local development and iOS builds.
    return null;
  }
}

/** Subscribes Firebase-enabled Android users to app announcements. */
export async function subscribeToFcmAnnouncements(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const native = NativeModules.HelixSlicer as HelixSlicerNotificationsModule | undefined;
  if (!native?.subscribeToFcmAnnouncements) return false;

  try {
    return await native.subscribeToFcmAnnouncements();
  } catch {
    return false;
  }
}

export async function getStoredFcmDeviceToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(FCM_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Sends a direct FCM test to this phone without requiring a connected printer. */
export async function sendFcmTestNotification(): Promise<boolean> {
  const token = await registerFcmDeviceToken();
  if (!token) return false;

  try {
    const response = await fetch(`${HELIX_RELAY_URL}/v1/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function clearStoredFcmDeviceToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(FCM_TOKEN_KEY);
    await SecureStore.deleteItemAsync(FCM_CONFIGURED_TOKEN_KEY);
  } catch {
    // Secure storage may be unavailable on web or an unconfigured native build.
  }
}

function moonrakerWebhookUrl(webhookUrl: string, event: string): string {
  const appriseUrl = webhookUrl.replace(/^https:\/\//i, 'jsons://');
  return withQueryParameter(appriseUrl, '-event', event);
}

/** Registers this phone and installs Helix's notifier into PAXX's include directory. */
export async function configureFcmForPrinter(
  printerBaseUrl: string,
  printerId: string,
  options?: { sendTest?: boolean }
): Promise<boolean> {
  const token = await registerFcmDeviceToken();
  if (!token || !printerBaseUrl || !printerId) return false;

  const registration = await fetch(`${HELIX_RELAY_URL}/v1/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: token, printerId }),
  });
  if (!registration.ok) return false;

  const payload = (await registration.json()) as { webhookUrl?: unknown };
  if (typeof payload.webhookUrl !== 'string' || !payload.webhookUrl.startsWith('https://')) {
    return false;
  }

  const notifier = [
    ['complete', 'Print complete', '{event_args[1].filename} finished'],
    ['error', 'Print failed', '{event_args[1].filename} failed'],
    ['cancelled', 'Print cancelled', '{event_args[1].filename} was cancelled'],
    ['paused', 'Print paused', '{event_args[1].filename} is paused'],
  ].map(([event, title, body]) => [
    `[notifier helix_${event}]`,
    `url: ${moonrakerWebhookUrl(payload.webhookUrl as string, event)}`,
    `events: ${event}`,
    `title: ${title}`,
    `body: ${body}`,
    '',
  ].join('\n')).join('\n');

  try {
    await uploadConfigFile(
      printerBaseUrl,
      'extended/moonraker',
      'helix-push.cfg',
      `# Managed by Helix. Do not edit manually.\n${notifier}`
    );
    await restartMoonraker(printerBaseUrl);
    const registrationMarker = `${printerId}:${token}`;
    if (options?.sendTest === false) {
      await SecureStore.setItemAsync(FCM_CONFIGURED_TOKEN_KEY, registrationMarker);
      return true;
    }

    const test = await fetch(withQueryParameter(payload.webhookUrl, 'event', 'complete'), {
      method: 'POST',
      headers: {
        'X-Title': 'Helix test',
        'X-Message': 'Firebase push notifications are working.',
      },
    });
    if (test.ok) {
      await SecureStore.setItemAsync(FCM_CONFIGURED_TOKEN_KEY, registrationMarker);
    }
    return test.ok;
  } catch {
    return false;
  }
}

export async function getConfiguredFcmDeviceToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(FCM_CONFIGURED_TOKEN_KEY);
  } catch {
    return null;
  }
}

function routeNotificationTap(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const payload = data as Partial<PrinterEventPayload>;
  if (payload.type !== 'printer_event' || typeof payload.printerId !== 'string') return;

  const route = typeof payload.route === 'string' && payload.route.startsWith('/')
    ? payload.route
    : '/';
  const params = payload.routeParams && typeof payload.routeParams === 'object'
    ? Object.entries(payload.routeParams)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')
    : '';
  const path = `${route}${params ? (route.includes('?') ? '&' : '?') + params : ''}`;
  Linking.openURL(Linking.createURL(path.replace(/^\//, ''))).catch(() => {});
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
  | 'cancelled'
  | 'progress'
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
    cancelled: settings.notifyPrintCancelled,
    progress: settings.notifyPrintProgress,
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
    cancelled: 'no_entry_sign,printer',
    progress: 'chart_with_upwards_trend,printer',
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

  // FCM is the closed-app transport. Keep a local fallback for an open Helix
  // session so a temporary printer webhook failure does not hide an event.
  if (settings.notificationMode === 'fcm') {
    await notifyLocal(title, message);
    return;
  }

  if (settings.notificationMode === 'local' || settings.notificationMode === 'ntfy') {
    await notifyLocal(title, message);
  }
}
