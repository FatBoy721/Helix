// Notification feed state — baked list, cached copy, remote refresh, FCM
// announcements, and the unread count.
//
// Extracted from components/NotificationBell.tsx so the redesigned centre can
// reuse the behaviour instead of reimplementing the merge/cache rules, which
// are the fiddly part.
import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from './useSettings';
import {
  BAKED_NOTIFICATIONS,
  FCM_ANNOUNCEMENTS_KEY,
  NOTIFICATIONS_URL,
  idsOf,
  mergeNotifications,
  parseNotifications,
  unreadCount,
} from '../constants/changelog';
import type { AppNotification } from '../constants/changelog';

const CACHE_KEY = 'u1control.notifications.cache.v1';
const FETCH_TIMEOUT_MS = 6000;
const LEGACY_PRINTER_ALERT_TITLES = new Set([
  'Print complete',
  'Print failed',
  'Print paused',
  'Print cancelled',
  'Print progress',
  'Filament runout',
  'Filament swap complete',
  'Printer error',
  'Printer disconnected',
  'Temperature warning',
]);

/** Baked feed, newest first — the instant fallback before cache/remote load. */
const INITIAL_LIST = mergeNotifications(BAKED_NOTIFICATIONS);

async function fetchRemoteNotifications(): Promise<AppNotification[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NOTIFICATIONS_URL, { signal: controller.signal });
    if (!res.ok) return null;
    return parseNotifications(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readStored(key: string, repairLegacyAlerts = false): Promise<AppNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? parseNotifications(JSON.parse(raw)) : [];
    if (!repairLegacyAlerts) return parsed;

    let repaired = false;
    const normalized = parsed.map((item) => {
      if (item.type === 'alert' || !LEGACY_PRINTER_ALERT_TITLES.has(item.title)) return item;
      repaired = true;
      return { ...item, type: 'alert' as const };
    });
    if (repaired) AsyncStorage.setItem(key, JSON.stringify(normalized)).catch(() => {});
    return normalized;
  } catch {
    // Corrupt cache is not worth surfacing; the baked list still renders.
    return [];
  }
}

export interface NotificationsState {
  list: AppNotification[];
  alerts: AppNotification[];
  changelog: AppNotification[];
  unread: number;
  /** Marks printer alerts currently in the bell as seen. */
  markAllSeen: () => void;
}

export function useNotifications(): NotificationsState {
  const { settings, update } = useSettings();
  const [list, setList] = useState<AppNotification[]>(INITIAL_LIST);

  // On mount: show cached feed instantly, then refresh from the remote JSON.
  useEffect(() => {
    let live = true;
    (async () => {
      const [cached, fcm] = await Promise.all([
        readStored(CACHE_KEY),
        readStored(FCM_ANNOUNCEMENTS_KEY, true),
      ]);
      if (live && cached.length) {
        setList(mergeNotifications(BAKED_NOTIFICATIONS, cached, fcm));
      } else if (live && fcm.length) {
        setList(mergeNotifications(BAKED_NOTIFICATIONS, fcm));
      }

      const remote = await fetchRemoteNotifications();
      if (!remote || !live) return;
      const freshFcm = await readStored(FCM_ANNOUNCEMENTS_KEY, true);
      if (!live) return;
      setList(mergeNotifications(BAKED_NOTIFICATIONS, remote, freshFcm));
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(remote)).catch(() => {});
    })();
    return () => {
      live = false;
    };
  }, []);

  const seen = settings.seenNotificationIds;
  const alerts = useMemo(() => list.filter((item) => item.type === 'alert'), [list]);
  const changelog = useMemo(() => list.filter((item) => item.type !== 'alert'), [list]);
  const unread = useMemo(() => unreadCount(alerts, seen), [alerts, seen]);

  const markAllSeen = useCallback(() => {
    if (unread > 0) {
      void update({ seenNotificationIds: Array.from(new Set([...seen, ...idsOf(alerts)])) });
    }
  }, [alerts, seen, unread, update]);

  return { list, alerts, changelog, unread, markAllSeen };
}
