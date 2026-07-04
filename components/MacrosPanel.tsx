import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMoonraker } from '../hooks/useMoonraker';
import { useSettings } from '../hooks/useSettings';
import { filterMacrosForDisplay, getMacroDisplay } from '../services/macroDisplay';
import MacroButton from './MacroButton';
import { t } from '../services/i18n';
import { colors, spacing } from '../constants/theme';

// PAXX exposes many macros. First matching category wins, with virtual tool
// macros grouped separately from manual filament actions.
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

// lives on the Home tab (toggleable section) since Spoolman took the tab slot
export default function MacrosPanel() {
  const { macros, sendGcode, connection } = useMoonraker();
  const { settings } = useSettings();
  const [filter, setFilter] = useState('');
  const macroDisplay = useMemo(() => getMacroDisplay(settings), [settings]);

  const configuredMacros = useMemo(() => {
    return filterMacrosForDisplay(macros, macroDisplay);
  }, [macros, macroDisplay]);

  const sections = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const visible = f
      ? configuredMacros.filter((m) => m.toLowerCase().includes(f))
      : configuredMacros;
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
  }, [configuredMacros, filter]);

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
    <View style={styles.wrap}>
      <TextInput
        style={styles.search}
        placeholder={t('Filter macros…')}
        placeholderTextColor={colors.subtext}
        value={filter}
        onChangeText={setFilter}
        autoCapitalize="none"
      />
      {sections.map((section) => (
        <View key={section.name}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.primary }]}>{t(section.name)}</Text>
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
          {connection === 'connected'
            ? macroDisplay.mode === 'selected' && configuredMacros.length === 0
              ? t('No macros selected in Settings')
              : t('No macros found')
            : t('Not connected')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
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
    marginTop: spacing.md,
  },
});
