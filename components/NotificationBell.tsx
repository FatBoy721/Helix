import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettings } from '../hooks/useSettings';
import {
  BAKED_NOTIFICATIONS,
  NOTIFICATIONS_URL,
  idsOf,
  mergeNotifications,
  parseNotifications,
  unreadCount,
} from '../constants/changelog';
import type { AppNotification, AppNotificationType } from '../constants/changelog';
import { t } from '../services/i18n';
import { colors, radius, shadow, spacing, withAlpha } from '../constants/theme';
import { PopIn, PressableScale } from './ui';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function typeIcon(type: AppNotificationType): IconName {
  if (type === 'alert') return 'alert-outline';
  if (type === 'changelog') return 'rocket-launch-outline';
  return 'information-outline';
}

function typeColor(type: AppNotificationType): string {
  if (type === 'alert') return colors.warning;
  return colors.primary;
}

const CACHE_KEY = 'u1control.notifications.cache.v1';
const FETCH_TIMEOUT_MS = 6000;

/** Baked feed, newest first — the instant fallback before cache/remote load. */
const INITIAL_LIST = mergeNotifications(BAKED_NOTIFICATIONS);

async function fetchRemoteNotifications(): Promise<AppNotification[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NOTIFICATIONS_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const items = parseNotifications(await res.json());
    return items;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default function NotificationBell() {
  const { settings, update } = useSettings();
  const window = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AppNotification[]>(INITIAL_LIST);

  // On mount: show cached feed instantly, then refresh from the remote JSON.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        const cached = raw ? parseNotifications(JSON.parse(raw)) : [];
        if (live && cached.length) {
          setList(mergeNotifications(BAKED_NOTIFICATIONS, cached));
        }
      } catch {
        // ignore corrupt cache
      }
      const remote = await fetchRemoteNotifications();
      if (remote && live) {
        setList(mergeNotifications(BAKED_NOTIFICATIONS, remote));
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(remote)).catch(() => {});
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const seen = settings.seenNotificationIds;
  const unread = useMemo(() => unreadCount(list, seen), [list, seen]);
  const seenSet = useMemo(() => new Set(seen), [seen]);

  const openCenter = () => {
    setOpen(true);
    if (unread > 0) update({ seenNotificationIds: idsOf(list) });
  };

  const sheetWidth = Math.min(window.width - spacing.lg * 2, 380);
  const sheetMaxHeight = Math.min(window.height * 0.7, 520);

  return (
    <>
      <PressableScale style={styles.bellButton} onPress={openCenter}>
        <MaterialCommunityIcons
          name={unread > 0 ? 'bell-badge-outline' : 'bell-outline'}
          size={20}
          color={colors.text}
        />
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        )}
      </PressableScale>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalLayer}>
          <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={() => setOpen(false)} />
          <PopIn style={[styles.sheet, { width: sheetWidth, maxHeight: sheetMaxHeight }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{t('Notifications')}</Text>
              <PressableScale style={styles.closeBtn} onPress={() => setOpen(false)}>
                <MaterialCommunityIcons name="close" size={18} color={colors.subtext} />
              </PressableScale>
            </View>
            {list.length === 0 ? (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="bell-sleep-outline" size={34} color={colors.subtext} />
                <Text style={styles.emptyText}>{t('Nothing new yet')}</Text>
              </View>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.list}
              >
                {list.map((n) => (
                  <NotificationRow key={n.id} item={n} fresh={!seenSet.has(n.id)} />
                ))}
              </ScrollView>
            )}
          </PopIn>
        </View>
      </Modal>
    </>
  );
}

function NotificationRow({ item, fresh }: { item: AppNotification; fresh: boolean }) {
  const accent = typeColor(item.type);
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: withAlpha(accent, 0.16) }]}>
        <MaterialCommunityIcons name={typeIcon(item.type)} size={18} color={accent} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {fresh && <View style={[styles.freshDot, { backgroundColor: accent }]} />}
        </View>
        <Text style={styles.rowDate}>{item.date}</Text>
        <Text style={styles.rowText}>{item.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: 0,
    top: 0,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  modalLayer: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    top: 70,
    left: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.hero,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardAlt,
  },
  list: { paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  freshDot: { width: 7, height: 7, borderRadius: 4 },
  rowDate: { color: colors.subtext, fontSize: 11, fontWeight: '700', marginTop: 1 },
  rowText: { color: colors.subtext, fontSize: 13, lineHeight: 18, marginTop: 4 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { color: colors.subtext, fontSize: 13, fontWeight: '700' },
});
