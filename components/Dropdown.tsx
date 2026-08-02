import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
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

// Layer picker. RN has no styled native dropdown and the chip walls were
// getting out of hand once the lists grew past ~8 entries.
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
  const [anchor, setAnchor] = useState({ x: spacing.lg, y: 100, width: 320, height: 48 });
  const triggerRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const window = useWindowDimensions();
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

  const openPicker = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  };

  const belowSpace = window.height - anchor.y - anchor.height - 12;
  const opensAbove = belowSpace < 220;
  const popoverMaxHeight = Math.max(
    160,
    Math.min(window.height * 0.55, opensAbove ? anchor.y - 12 : belowSpace)
  );

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity ref={triggerRef} style={styles.trigger} onPress={openPicker}>
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

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
            <View
              style={[
                styles.anchorField,
                { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height },
              ]}
              onStartShouldSetResponder={() => true}
            >
              {selected?.color ? (
                <View style={[styles.dot, { backgroundColor: selected.color }]} />
              ) : null}
              <Text
                style={[styles.triggerText, !selected && { color: colors.subtext }]}
                numberOfLines={1}
              >
                {selected?.label ?? placeholder ?? t('Select…')}
              </Text>
              <MaterialCommunityIcons name="chevron-up" size={20} color={colors.primary} />
            </View>

            <View
              style={[
                styles.popover,
                {
                  left: anchor.x,
                  width: anchor.width,
                  maxHeight: popoverMaxHeight,
                  ...(opensAbove
                    ? { bottom: window.height - anchor.y }
                    : { top: anchor.y + anchor.height }),
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
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
        </KeyboardAvoidingView>
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
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  anchorField: {
    position: 'absolute',
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
  },
  popover: {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  search: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    margin: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
