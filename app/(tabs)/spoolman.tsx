import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import { api } from '../../services/moonraker';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

interface Spool {
  id: number;
  remaining_weight?: number;
  used_weight?: number;
  archived?: boolean;
  filament?: {
    name?: string;
    material?: string;
    color_hex?: string;
    weight?: number; // net weight of a full spool
    vendor?: { name?: string };
  };
}

function spoolTitle(s: Spool): string {
  const parts = [s.filament?.vendor?.name, s.filament?.name].filter(Boolean);
  return parts.join(' ') || `Spool #${s.id}`;
}

export default function SpoolmanScreen() {
  const { connection, activeUrl } = useMoonraker();
  useSettings(); // re-render on language/theme change
  const [spools, setSpools] = useState<Spool[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<'none' | 'no-component' | 'no-server'>('none');

  const refresh = useCallback(async () => {
    if (!activeUrl) return;
    setLoading(true);
    try {
      const idRes = await api.spoolmanGetSpoolId(activeUrl);
      setActiveId(idRes?.spool_id ?? null);
      const proxied = await api.spoolmanProxy(activeUrl, 'GET', '/v1/spool');
      if (proxied?.error) {
        // moonraker is configured but can't reach the Spoolman server
        setUnavailable('no-server');
        setSpools([]);
      } else {
        setUnavailable('none');
        const list: Spool[] = Array.isArray(proxied?.response) ? proxied.response : [];
        setSpools(list.filter((s) => !s.archived));
      }
    } catch (e: any) {
      // 404 = [spoolman] section missing from moonraker.conf entirely
      setUnavailable(String(e?.message ?? '').includes('404') ? 'no-component' : 'no-server');
      setSpools([]);
    } finally {
      setLoading(false);
    }
  }, [activeUrl]);

  useEffect(() => {
    if (connection === 'connected') refresh();
  }, [connection, refresh]);

  const setActive = (spool: Spool | null) => {
    const label = spool ? spoolTitle(spool) : t('No spool active');
    Alert.alert(t('Set active spool?'), label, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Set'),
        onPress: async () => {
          try {
            const res = await api.spoolmanSetSpoolId(activeUrl, spool?.id ?? null);
            setActiveId(res?.spool_id ?? null);
          } catch (e: any) {
            Alert.alert(t('Error'), String(e?.message ?? e));
          }
        },
      },
    ]);
  };

  if (connection === 'connected' && unavailable !== 'none' && !loading) {
    return (
      <View style={[styles.screen, styles.emptyScreen]}>
        <MaterialCommunityIcons name="paper-roll-outline" size={40} color={colors.subtext} />
        <Text style={styles.emptyTitle}>
          {unavailable === 'no-component'
            ? t('Spoolman not configured')
            : t('Spoolman server unreachable')}
        </Text>
        <Text style={styles.emptyText}>
          {unavailable === 'no-component'
            ? t("Add a [spoolman] section to the printer's moonraker.conf pointing at your Spoolman server, then restart Moonraker.")
            : t('Moonraker is configured for Spoolman but the server is not responding. Check that the Spoolman container is running.')}
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
          <Text style={styles.retryText}>{t('Retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const active = spools.find((s) => s.id === activeId) ?? null;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={spools}
      keyExtractor={(s) => String(s.id)}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.subtext} />
      }
      ListHeaderComponent={
        <View style={styles.activeCard}>
          <Text style={styles.activeLabel}>{t('Active spool')}</Text>
          {active ? (
            <SpoolRow spool={active} active onPress={() => setActive(null)} />
          ) : (
            <Text style={styles.noneActive}>{t('No spool active')}</Text>
          )}
        </View>
      }
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            {connection === 'connected' ? t('No spools in Spoolman yet') : t('Not connected')}
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <SpoolRow spool={item} active={item.id === activeId} onPress={() => setActive(item)} />
      )}
    />
  );
}

function SpoolRow({
  spool,
  active,
  onPress,
}: {
  spool: Spool;
  active?: boolean;
  onPress: () => void;
}) {
  const remaining = spool.remaining_weight;
  const net = spool.filament?.weight;
  const pct =
    typeof remaining === 'number' && typeof net === 'number' && net > 0
      ? Math.max(0, Math.min(1, remaining / net))
      : null;

  return (
    <TouchableOpacity
      style={[styles.spoolCard, active && { borderColor: colors.primary }]}
      onPress={onPress}
    >
      <View
        style={[
          styles.colorDot,
          spool.filament?.color_hex
            ? { backgroundColor: `#${spool.filament.color_hex.replace('#', '')}` }
            : { borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
        ]}
      />
      <View style={styles.spoolInfo}>
        <Text style={styles.spoolName} numberOfLines={1}>
          {spoolTitle(spool)}
        </Text>
        <Text style={styles.spoolMeta}>
          {[spool.filament?.material, typeof remaining === 'number' ? `${Math.round(remaining)} g ${t('left')}` : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {pct != null && (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.round(pct * 100)}%`,
                  backgroundColor: pct < 0.15 ? colors.danger : colors.primary,
                },
              ]}
            />
          </View>
        )}
      </View>
      {active && <MaterialCommunityIcons name="check-circle" size={20} color={colors.primary} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xl * 2,
  },
  activeCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  activeLabel: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  noneActive: {
    color: colors.subtext,
    fontSize: 13,
  },
  spoolCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  spoolInfo: {
    flex: 1,
  },
  spoolName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  spoolMeta: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 1,
  },
  track: {
    height: 4,
    backgroundColor: colors.cardAlt,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  emptyScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  emptyText: {
    color: colors.subtext,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  retryText: {
    color: colors.text,
    fontWeight: '600',
  },
});
