import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import MacroButton from '../../components/MacroButton';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

// PAXX ships like 120 macros and dumping them in one wall scared everyone I
// showed it to. buckets below, first match wins top to bottom. T4-T31 are
// multiACE virtual tools (slicer-facing, you basically never tap these by
// hand) so they get shoved into their own section out of the way.
const CATEGORIES: { name: string; match: (m: string) => boolean }[] = [
  { name: 'Print Control', match: (m) => /^(PRINT_|PAUSE|RESUME|CANCEL|M600$|SET_PAUSE)/i.test(m) },
  { name: 'Tool Change', match: (m) => /^T\d+$/.test(m) },
  {
    name: 'ACE & Filament',
    match: (m) => /ACE|FEED|FILAMENT|LOAD|UNLOAD|RUNOUT|FLUSH|DISCARD/i.test(m),
  },
  {
    name: 'Calibration',
    match: (m) => /CALIBRATE|SHAPER|PID|PROBE|OFFSET|MESH|TILT|RESONANCE|FLOW|MEASURE/i.test(m),
  },
  { name: 'Cleaning', match: (m) => /CLEAN|CUTOFF|NOZZLE/i.test(m) },
  { name: 'Homing & Motion', match: (m) => /HOME|HOMING|PARK|SHAKE|MOVE/i.test(m) },
];

export default function MacrosScreen() {
  const { macros, sendGcode, connection } = useMoonraker();
  useSettings(); // re-render on language/theme change
  const [filter, setFilter] = useState('');

  const sections = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const visible = f ? macros.filter((m) => m.toLowerCase().includes(f)) : macros;
    const buckets = new Map<string, string[]>();
    for (const name of visible) {
      const cat = CATEGORIES.find((c) => c.match(name))?.name ?? 'Other';
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat)!.push(name);
    }
    const order = [...CATEGORIES.map((c) => c.name), 'Other'];
    return order
      .filter((name) => buckets.has(name))
      .map((name) => ({ name, macros: buckets.get(name)! }));
  }, [macros, filter]);

  const run = (name: string) => {
    // multiACE macros get a confirmation for safety
    if (/ace/i.test(name)) {
      Alert.alert(t('Run ACE macro?'), name, [
        { text: t('Cancel'), style: 'cancel' },
        { text: 'Run', onPress: () => sendGcode(name) },
      ]);
    } else {
      sendGcode(name);
    }
  };

  return (
    <View style={styles.screen}>
      <TextInput
        style={styles.search}
        placeholder={t('Filter macros…')}
        placeholderTextColor={colors.subtext}
        value={filter}
        onChangeText={setFilter}
        autoCapitalize="none"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {sections.map((section) => (
          <View key={section.name}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.primary }]}>
                {t(section.name)}
              </Text>
              <Text style={styles.sectionCount}>{section.macros.length}</Text>
            </View>
            <View style={styles.grid}>
              {section.macros.map((name) => (
                <MacroButton
                  key={name}
                  name={name}
                  onPress={() => run(name)}
                  disabled={connection !== 'connected'}
                />
              ))}
            </View>
          </View>
        ))}
        {!sections.length && (
          <Text style={styles.empty}>
            {connection === 'connected' ? t('No macros found') : t('Not connected')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  search: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    fontSize: 14,
  },
  scroll: {
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sectionCount: {
    color: colors.subtext,
    fontSize: 11,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    width: '100%',
    marginTop: spacing.xl,
  },
});
