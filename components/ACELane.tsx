import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { t } from '../services/i18n';
import type { AceLane, LaneStatus } from '../hooks/useACE';

interface Props {
  lane: AceLane;
  onLoad: () => void;
  onUnload: () => void;
  onEdit?: () => void;
  fallbackColor?: string;
  disabled?: boolean;
}

const STATUS_COLORS: Record<LaneStatus, string> = {
  loaded: colors.success,
  empty: colors.subtext,
  busy: colors.warning,
  drying: colors.primary,
  unknown: colors.border,
};

export default function ACELaneRow({ lane, onLoad, onUnload, onEdit, fallbackColor, disabled }: Props) {
  const info = [lane.brand, lane.material, lane.sku].filter(Boolean).join(' · ');
  const color = lane.colorHex ?? fallbackColor;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.editTarget}
        onPress={onEdit}
        disabled={!onEdit || disabled}
        accessibilityLabel={`Edit lane ${lane.index + 1} filament`}
      >
        <View
          style={[
            styles.colorDot,
            color
              ? { backgroundColor: color }
              : { borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
          ]}
        />
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.laneName}>{t('Lane')} {lane.index + 1}</Text>
            <View style={[styles.chip, { backgroundColor: STATUS_COLORS[lane.status] + '33' }]}>
              <Text style={[styles.chipText, { color: STATUS_COLORS[lane.status] }]}> 
                {lane.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.detail} numberOfLines={1}>
            {info || t('No RFID data')}
          </Text>
        </View>
        {onEdit ? <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.subtext} /> : null}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: colors.primary }, disabled && styles.disabled]}
        onPress={onLoad}
        disabled={disabled}
      >
        <Text style={styles.actionText}>{t('Load')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.actionBtn, styles.unloadBtn, disabled && styles.disabled]}
        onPress={onUnload}
        disabled={disabled}
      >
        <Text style={styles.actionText}>{t('Unload')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  colorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  editTarget: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  info: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  laneName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chip: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  chipText: {
    fontSize: 9,
    fontWeight: '700',
  },
  detail: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 1,
  },
  actionBtn: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  unloadBtn: {
    backgroundColor: colors.cardAlt,
  },
  disabled: {
    opacity: 0.4,
  },
  actionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
});
