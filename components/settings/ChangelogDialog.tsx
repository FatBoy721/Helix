import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AppNotification } from '../../constants/changelog';
import { t } from '../../services/i18n';
import ThemedDialog from '../ThemedDialog';
import { alpha, COCKPIT as P } from '../dashboard/shared';

interface Props {
  visible: boolean;
  items: AppNotification[];
  onClose: () => void;
}

const COLLAPSED_BODY_LINES = 3;
const EXPANDABLE_BODY_LENGTH = 140;

export default function ChangelogDialog({ visible, items, onClose }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!visible) setExpandedIds(new Set());
  }, [visible]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <ThemedDialog
      visible={visible}
      title={t('Changelog')}
      icon="history"
      actions={[{ text: t('OK'), variant: 'primary', onPress: onClose }]}
      onClose={onClose}
    >
      <View style={styles.list}>
        {items.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="notebook-check-outline" size={30} color={P.dim} />
            <Text style={styles.emptyText}>{t('Nothing new to report.')}</Text>
          </View>
        ) : (
          items.map((item) => {
            const expanded = expandedIds.has(item.id);
            const expandable = item.body.length > EXPANDABLE_BODY_LENGTH;

            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.header}>
                  <View style={styles.iconBadge}>
                    <MaterialCommunityIcons name="rocket-launch-outline" size={18} color={P.accent} />
                  </View>
                  <View style={styles.heading}>
                    <Text style={styles.title}>{item.title}</Text>
                    {item.date ? <Text style={styles.date}>{item.date}</Text> : null}
                  </View>
                </View>

                {item.body ? (
                  <Text
                    style={styles.body}
                    numberOfLines={expandable && !expanded ? COLLAPSED_BODY_LINES : undefined}
                  >
                    {item.body}
                  </Text>
                ) : null}

                {expandable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    onPress={() => toggleExpanded(item.id)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.moreText}>{t(expanded ? 'Show less' : 'View more')}</Text>
                    <MaterialCommunityIcons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={17}
                      color={P.accent}
                    />
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </ThemedDialog>
  );
}

const styles = StyleSheet.create({
  list: {
    alignSelf: 'stretch',
    gap: 12,
  },
  card: {
    gap: 11,
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(P.accent, 0.14),
  },
  heading: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: P.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  date: {
    color: P.dim,
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    color: P.dim,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  moreButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  moreText: {
    color: P.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.65,
  },
  empty: {
    alignItems: 'center',
    gap: 9,
    paddingVertical: 36,
  },
  emptyText: {
    color: P.dim,
    fontSize: 13,
    fontWeight: '600',
  },
});
