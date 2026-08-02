// Search, sort and thumbnail pieces shared by the Files screen's panels.
import React from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COCKPIT as P, alpha } from '../dashboard/shared';
import type { LibraryFile, SortKey } from '../../hooks/useFileLibrary';
import { t } from '../../services/i18n';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'duration', label: 'Longest' },
];

export function SearchBar({
  value,
  onChange,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
}) {
  return (
    <View style={styles.searchRow}>
      <MaterialCommunityIcons name="magnify" size={19} color={P.dim} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={`${t('Search')} ${count} ${t(count === 1 ? 'file' : 'files')}`}
        placeholderTextColor={P.dim}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={10}>
          <MaterialCommunityIcons name="close-circle" size={18} color={P.dim} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function SortChips({ value, onChange }: { value: SortKey; onChange: (s: SortKey) => void }) {
  return (
    <View style={styles.sortRow}>
      {SORTS.map((s) => {
        const on = s.key === value;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            style={[styles.sortChip, on && styles.sortChipOn]}
          >
            <Text style={[styles.sortText, on && styles.sortTextOn]}>{t(s.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Thumbnail with a placeholder for files that have none (or aren't loaded). */
export function Thumb({
  file,
  size,
  radius = 14,
}: {
  file: LibraryFile;
  size: number;
  radius?: number;
}) {
  if (file.thumbUri) {
    return (
      <Image
        source={{ uri: file.thumbUri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: P.surfaceAlt }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        styles.thumbEmpty,
        { width: size, height: size, borderRadius: radius },
        // Not-yet-fetched vs genuinely absent: a dimmer box avoids the list
        // flashing "no preview" icons while metadata is still streaming in.
        file.thumbUri === undefined && { opacity: 0.45 },
      ]}
    >
      <MaterialCommunityIcons
        name={file.thumbUri === undefined ? 'progress-clock' : 'cube-outline'}
        size={size * 0.3}
        color={P.dim}
      />
    </View>
  );
}

export function EmptyState({ connected, error }: { connected: boolean; error: string }) {
  const message = !connected
    ? t('Not connected to the printer.')
    : error
      ? error
      : t('No G-code files on the printer yet.');
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons
        name={!connected ? 'lan-disconnect' : 'folder-open-outline'}
        size={30}
        color={P.dim}
      />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 46,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  searchInput: { flex: 1, color: P.text, fontSize: 14, fontWeight: '600', padding: 0 },

  sortRow: { flexDirection: 'row', gap: 7 },
  sortChip: {
    paddingHorizontal: 12,
    height: 34,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  sortChipOn: { backgroundColor: alpha(P.accent, 0.16), borderColor: P.accent },
  sortText: { color: P.dim, fontSize: 12, fontWeight: '800' },
  sortTextOn: { color: P.accent },

  thumbEmpty: {
    backgroundColor: P.surfaceAlt,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  emptyText: { color: P.dim, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
