import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { t } from '../services/i18n';
import { colors, spacing } from '../constants/theme';

export interface DropdownOption {
  key: string;
  label: string;
  color?: string; // renders a color dot
  hint?: string; // small right-aligned text, e.g. "new"
  dimmed?: boolean; // secondary styling (e.g. create-on-save presets)
}

interface Props {
  label: string;
  placeholder?: string;
  value: string | null; // selected option key
  options: DropdownOption[];
  onSelect: (key: string | null) => void;
  clearable?: boolean;
}

// bottom-sheet picker. RN has no styled native dropdown and the chip walls
// were getting out of hand once the lists grew past ~8 entries.
// crabcore
export default function Dropdown({
  label,
  placeholder,
  value,
  options,
  onSelect,
  clearable,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const selected = options.find((o) => o.key === value) ?? null;
  const searchable = options.length > 8;

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options;
  }, [options, filter]);

  const close = () => {
    setOpen(false);
    setFilter('');
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)}>
        {selected?.color ? (
          <View style={[styles.dot, { backgroundColor: selected.color }]} />
        ) : null}
        <Text style={[styles.triggerText, !selected && { color: colors.subtext }]} numberOfLines={1}>
          {selected?.label ?? placeholder ?? t('Select…')}
        </Text>
        {clearable && selected ? (
          <TouchableOpacity hitSlop={8} onPress={() => onSelect(null)}>
            <MaterialCommunityIcons name="close-circle" size={16} color={colors.subtext} />
          </TouchableOpacity>
        ) : null}
        <MaterialCommunityIcons name="chevron-down" size={20} color={colors.subtext} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <TouchableOpacity hitSlop={8} onPress={close}>
                <MaterialCommunityIcons name="close" size={20} color={colors.subtext} />
              </TouchableOpacity>
            </View>
            {searchable && (
              <TextInput
                style={styles.search}
                value={filter}
                onChangeText={setFilter}
                placeholder={t('Search…')}
                placeholderTextColor={colors.subtext}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <FlatList
              data={visible}
              keyExtractor={(o) => o.key}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSel = item.key === value;
                return (
                  <TouchableOpacity
                    style={[styles.row, isSel && styles.rowSelected]}
                    onPress={() => {
                      onSelect(item.key);
                      close();
                    }}
                  >
                    {item.color ? (
                      <View style={[styles.dot, { backgroundColor: item.color }]} />
                    ) : null}
                    <Text
                      style={[
                        styles.rowText,
                        item.dimmed && { color: colors.subtext },
                        isSel && { color: colors.primary, fontWeight: '700' },
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    {item.hint ? <Text style={styles.hint}>{item.hint}</Text> : null}
                    {isSel && (
                      <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.empty}>{t('No matches')}</Text>}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  triggerText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '70%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  search: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowSelected: {},
  rowText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  hint: {
    color: colors.subtext,
    fontSize: 11,
    fontStyle: 'italic',
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
