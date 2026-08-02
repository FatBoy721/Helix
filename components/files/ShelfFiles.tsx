// The gcode list — "Shelf".
//
// Built around the observation that most trips to Files are to reprint
// something recent, not to browse. The four newest files get large cards in a
// horizontal shelf at the top; everything else falls into a compact list below.
//
// Trade-off: two ways to reach the same file, and the shelf costs vertical
// space that a pure list would spend on more rows.
import React, { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COCKPIT as P, alpha } from '../dashboard/shared';
import { EmptyState, SearchBar, SortChips, Thumb } from './shared';
import {
  formatDuration,
  formatWhen,
  type FileLibrary,
  type LibraryFile,
} from '../../hooks/useFileLibrary';
import { t } from '../../services/i18n';

const PAGE = 16;
const SHELF_COUNT = 4;

export default function ShelfFiles({
  library,
  onOpen,
}: {
  library: FileLibrary;
  onOpen: (file: LibraryFile) => void;
}) {
  // The shelf is always newest-first regardless of the list's sort, and is
  // suppressed while searching — a "recent" strip is noise once you're hunting
  // for something specific.
  const searching = library.query.trim().length > 0;
  const shelf = useMemo(() => {
    if (searching) return [];
    return [...library.files].sort((a, b) => b.modified - a.modified).slice(0, SHELF_COUNT);
  }, [library.files, searching]);

  const shelfPaths = useMemo(() => new Set(shelf.map((f) => f.path)), [shelf]);
  const rest = useMemo(
    () => library.files.filter((f) => !shelfPaths.has(f.path)),
    [library.files, shelfPaths]
  );

  return (
    <FlatList
      data={rest}
      keyExtractor={(f) => f.path}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={library.loading}
          onRefresh={library.refresh}
          tintColor={P.dim}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <SearchBar
            value={library.query}
            onChange={library.setQuery}
            count={library.files.length}
          />

          {shelf.length > 0 ? (
            <View style={styles.shelfBlock}>
              <Text style={styles.sectionLabel}>{t('Recent')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.shelfRow}
              >
                {shelf.map((file) => (
                  <Pressable
                    key={file.path}
                    onPress={() => onOpen(file)}
                    style={({ pressed }) => [styles.shelfCard, pressed && { opacity: 0.75 }]}
                  >
                    <Thumb file={file} size={140} radius={0} />
                    <View style={styles.shelfBody}>
                      <Text style={styles.shelfName} numberOfLines={1}>
                        {file.name}
                      </Text>
                      <Text style={styles.shelfMeta}>{formatDuration(file.estSeconds)}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.allHead}>
            <Text style={styles.sectionLabel}>
              {searching ? t('Results') : t('All files')}
            </Text>
            <SortChips value={library.sort} onChange={library.setSort} />
          </View>
        </View>
      }
      ListEmptyComponent={
        library.loading || shelf.length > 0 ? null : (
          <EmptyState connected={library.connected} error={library.error} />
        )
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
        >
          <Thumb file={item} size={46} radius={10} />
          <View style={styles.rowInfo}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {[
                item.folder,
                formatDuration(item.estSeconds),
                formatWhen(item.modified),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={P.dim} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: PAGE, paddingBottom: 40, gap: 8 },
  header: { gap: 16, marginBottom: 6 },
  sectionLabel: {
    color: P.dim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },

  shelfBlock: { gap: 9 },
  shelfRow: { gap: 10, paddingRight: 4 },
  shelfCard: {
    width: 140,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  shelfBody: { padding: 9, gap: 2 },
  shelfName: { color: P.text, fontSize: 12, fontWeight: '800' },
  shelfMeta: { color: P.dim, fontSize: 11, fontWeight: '700' },

  allHead: { gap: 9 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 9,
    borderRadius: 14,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: alpha(P.border, 0.7),
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: P.text, fontSize: 13, fontWeight: '800' },
  rowMeta: { color: P.dim, fontSize: 11, fontWeight: '600' },
});
