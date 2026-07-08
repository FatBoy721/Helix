// In-app notification feed.
//
// Two sources, merged by id (remote wins):
//   1. BAKED_NOTIFICATIONS below — ships in the APK, shown offline / before first fetch.
//   2. NOTIFICATIONS_URL — a JSON array hosted on GitHub, edited any time without a rebuild.
//
// To announce something to everyone instantly: edit notifications.json in the
// helix-notifications repo. No APK rebuild needed.

export type AppNotificationType = 'changelog' | 'info' | 'alert';

export interface AppNotification {
  /** Stable unique id. Never reuse — read-state is keyed on it. */
  id: string;
  type: AppNotificationType;
  title: string;
  /** ISO date (YYYY-MM-DD). Used for display and newest-first sort. */
  date: string;
  body: string;
}

export const NOTIFICATIONS_URL =
  'https://raw.githubusercontent.com/FatBoy721/helix-notifications/refs/heads/main/notifications.json';

/** Fallback feed baked into the app. Remote entries with the same id override these. */
export const BAKED_NOTIFICATIONS: AppNotification[] = [
  {
    id: '2026-07-08-notifications',
    type: 'info',
    title: 'Notifications are here',
    date: '2026-07-08',
    body: 'Tap the bell any time to catch up on changelogs and app news. New items show a dot.',
  },
];

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asType(v: unknown): AppNotificationType {
  return v === 'changelog' || v === 'info' || v === 'alert' ? v : 'info';
}

/** Validate untrusted JSON (remote or cache) into clean notifications. */
export function parseNotifications(raw: unknown): AppNotification[] {
  if (!Array.isArray(raw)) return [];
  const out: AppNotification[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const id = asString(o.id).trim();
    const title = asString(o.title).trim();
    if (!id || !title) continue;
    out.push({
      id,
      title,
      type: asType(o.type),
      date: asString(o.date).trim(),
      body: asString(o.body).trim(),
    });
  }
  return out;
}

/** Merge lists by id (later lists win) and sort newest date first. */
export function mergeNotifications(...lists: AppNotification[][]): AppNotification[] {
  const byId = new Map<string, AppNotification>();
  for (const list of lists) {
    for (const n of list) byId.set(n.id, n);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
}

export function unreadCount(list: AppNotification[], seenIds: string[]): number {
  const seen = new Set(seenIds);
  return list.reduce((count, n) => (seen.has(n.id) ? count : count + 1), 0);
}

export function idsOf(list: AppNotification[]): string[] {
  return list.map((n) => n.id);
}
