// Cockpit notification centre — bell button plus its panel.
//
// Replaces the reuse of the app's NotificationBell, which brought the old
// theme's card/border colours into an otherwise Cockpit surface. The feed
// behaviour (baked + cached + remote + FCM merge, unread count) lives in
// hooks/useNotifications so there's still only one implementation of it.
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AppNotification } from '../../../constants/changelog';
import { alpha, COCKPIT as P } from '../shared';
import { t } from '../../../services/i18n';

/**
 * The bell only. Its panel is exported separately and must be rendered at the
 * screen root — an overlay mounted here would anchor to the scrolling content
 * and render clipped at the top of the page.
 */
export function NotificationButton({ unread, onPress }: { unread: number; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.bell, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <MaterialCommunityIcons
        name={unread > 0 ? 'bell-badge-outline' : 'bell-outline'}
        size={20}
        color={unread > 0 ? P.accent : P.text}
      />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function NotificationPanel({
  list,
  onClose,
}: {
  list: AppNotification[];
  onClose: () => void;
}) {
  const visible = useMemo(() => list.filter((item) => item.type === 'alert'), [list]);

  return (
    <View style={styles.layer}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={[styles.iconBadge, { backgroundColor: alpha(P.accent, 0.14) }]}>
            <MaterialCommunityIcons name="bell-outline" size={26} color={P.accent} />
          </View>
          <Text style={styles.title}>{t('Printer alerts')}</Text>
        </View>

        <ScrollView style={styles.scroller} contentContainerStyle={styles.list}>
          {visible.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="check-circle-outline" size={28} color={P.dim} />
              <Text style={styles.emptyText}>{t('No alerts right now.')}</Text>
            </View>
          ) : (
            visible.map((item) => (
              <View key={item.id} style={styles.row}>
                <View
                  style={[styles.rowIcon, { backgroundColor: alpha(P.warn, 0.14) }]}
                >
                  <MaterialCommunityIcons
                    name="alert-outline"
                    size={18}
                    color={P.warn}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowDate}>{item.date}</Text>
                  <Text style={styles.rowBody}>{item.body}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: P.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: P.bg,
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },

  layer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha('#000000', 0.74),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '70%',
    backgroundColor: P.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: P.border,
    padding: 22,
    gap: 13,
  },
  head: {
    alignItems: 'center',
    gap: 13,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: P.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },

  scroller: { alignSelf: 'stretch' },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 13,
    borderRadius: 16,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { color: P.text, fontSize: 14, fontWeight: '800' },
  rowDate: { color: P.dim, fontSize: 11, fontWeight: '700' },
  rowBody: { color: P.dim, fontSize: 13, fontWeight: '600', lineHeight: 18 },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 34 },
  emptyText: { color: P.dim, fontSize: 13, fontWeight: '600' },
});
