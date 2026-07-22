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

/** Local cache for announcements received through Firebase Cloud Messaging. */
export const FCM_ANNOUNCEMENTS_KEY = 'u1control.notifications.fcm.v1';

/** Fallback feed baked into the app. Remote entries with the same id override these. */
export const BAKED_NOTIFICATIONS: AppNotification[] = [
  {
    id: '2026-07-21-release-1-2-3',
    type: 'changelog',
    title: 'Helix 1.2.3 is available',
    date: '2026-07-21',
    body: 'Firebase push notifications now refresh the active printer registration when the phone token changes. Printer completion webhooks now use firmware-safe message templates so PAXX can send alerts reliably. The notification bell keeps alerts and changelog items in separate tabs, with GitHub as a fallback. Filament selection now follows the loaded PAXX toolheads and applies matching material profiles when available, with a generic profile fallback. This release also includes printer dashboard, print setup, calibration, and layout improvements.',
  },
  {
    id: '2026-07-19-bell-tabs',
    type: 'changelog',
    title: 'Bell history is organized',
    date: '2026-07-19',
    body: 'The bell now has separate Alerts and Changelog tabs. Firebase announcements and printer alerts can be saved for later, while GitHub remains a fallback when an announcement was missed.',
  },
  {
    id: '2026-07-10-signing-upgrade',
    type: 'alert',
    title: 'Heads up: one-time reinstall coming',
    date: '2026-07-10',
    body: 'The next Helix update switches to a proper release signing key. It is needed for update security and a future Play Store listing. Android treats the new key as a new app, so you will need to uninstall and reinstall once. Before that: Settings > Backup > Export settings to save your printers and preferences, then Import after reinstalling. MakerWorld needs a fresh login. We will post here when the new build is live.',
  },
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
