import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import {
  MacroDisplaySettings,
  countSelectedMacros,
  getMacroDisplay,
  setMacroDisplayForPrinter,
  toggleMacroInDisplay,
} from '../../services/macroDisplay';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

export default function MacroDisplayCard() {
  const { settings, update } = useSettings();
  const { connection, macros } = useMoonraker();
  const [macroFilter, setMacroFilter] = useState('');

  const macroDisplay = getMacroDisplay(settings);
  const selectedMacroSet = new Set(macroDisplay.selected);
  const macroFilterText = macroFilter.trim().toLowerCase();
  const filteredMacros = macroFilterText
    ? macros.filter((name) => name.toLowerCase().includes(macroFilterText))
    : macros;
  const selectedMacroCount = countSelectedMacros(macros, macroDisplay);
  const totalMacroCount = macros.length || macroDisplay.selected.length;

  const setMacroDisplay = (next: MacroDisplaySettings) => {
    update({
      macroDisplayByPrinter: setMacroDisplayForPrinter(
        settings.macroDisplayByPrinter,
        settings.activePrinterId,
        next
      ),
      dashboard: { ...settings.dashboard, macros: true },
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('Macro display')}</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[
            styles.modeBtn,
            macroDisplay.mode === 'all' && { backgroundColor: colors.primary },
          ]}
          onPress={() => setMacroDisplay({ ...macroDisplay, mode: 'all' })}
        >
          <MaterialCommunityIcons
            name="format-list-bulleted"
            size={17}
            color={macroDisplay.mode === 'all' ? '#fff' : colors.text}
          />
          <Text style={[styles.modeText, macroDisplay.mode === 'all' && { color: '#fff' }]}>
            {t('Show all')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeBtn,
            macroDisplay.mode === 'selected' && { backgroundColor: colors.primary },
          ]}
          onPress={() => setMacroDisplay({ ...macroDisplay, mode: 'selected' })}
        >
          <MaterialCommunityIcons
            name="checkbox-multiple-marked-outline"
            size={17}
            color={macroDisplay.mode === 'selected' ? '#fff' : colors.text}
          />
          <Text style={[styles.modeText, macroDisplay.mode === 'selected' && { color: '#fff' }]}>
            {t('Selected only')}
          </Text>
        </TouchableOpacity>
      </View>

      {macroDisplay.mode === 'selected' && (
        <View style={styles.macroPicker}>
          <View style={styles.macroSummaryRow}>
            <Text style={styles.macroCount}>
              {totalMacroCount ? `${selectedMacroCount}/${totalMacroCount}` : '0'}{' '}
              {t('selected')}
            </Text>
            <View style={styles.macroActions}>
              <TouchableOpacity
                style={[styles.macroActionBtn, !macros.length && styles.disabledControl]}
                disabled={!macros.length}
                onPress={() => setMacroDisplay({ ...macroDisplay, mode: 'selected', selected: macros })}
              >
                <Text style={styles.macroActionText}>{t('Select all')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.macroActionBtn}
                onPress={() => setMacroDisplay({ ...macroDisplay, mode: 'selected', selected: [] })}
              >
                <Text style={styles.macroActionText}>{t('Clear')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TextInput
            style={styles.fieldInput}
            value={macroFilter}
            onChangeText={setMacroFilter}
            placeholder={t('Filter macros…')}
            placeholderTextColor={colors.subtext}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {connection !== 'connected' ? (
            <Text style={styles.note}>{t('Connect to a printer to choose macros.')}</Text>
          ) : filteredMacros.length ? (
            <View style={styles.macroList}>
              {filteredMacros.map((name) => {
                const selected = selectedMacroSet.has(name);
                return (
                  <TouchableOpacity
                    key={name}
                    style={styles.macroChoiceRow}
                    onPress={() => setMacroDisplay(toggleMacroInDisplay(macroDisplay, name))}
                  >
                    <MaterialCommunityIcons
                      name={selected ? 'checkbox-marked-outline' : 'checkbox-blank-outline'}
                      size={20}
                      color={selected ? colors.primary : colors.subtext}
                    />
                    <Text style={styles.macroChoiceText} numberOfLines={1}>
                      {name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.note}>{t('No macros found')}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
  },
  modeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  macroPicker: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  macroSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  macroCount: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
  },
  macroActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  macroActionBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  macroActionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  disabledControl: {
    opacity: 0.45,
  },
  fieldInput: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  note: {
    color: colors.subtext,
    fontSize: 11,
    fontStyle: 'italic',
  },
  macroList: {
    gap: 2,
  },
  macroChoiceRow: {
    minHeight: 40,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  macroChoiceText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
  },
});
