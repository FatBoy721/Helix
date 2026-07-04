import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ACE_MACROS, AceUnit, useACE } from '../../hooks/useACE';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import ACELaneRow from '../../components/ACELane';
import { t } from '../../services/i18n';
import {
  displayTemperature,
  formatTemperature,
  inputTemperatureToCelsius,
  temperatureUnitSymbol,
} from '../../services/temperature';
import type { TemperatureUnit } from '../../services/temperature';
import { colors, spacing } from '../../constants/theme';

export default function ACEScreen() {
  const { units, aceMacros, hardwareDetected, sendGcode } = useACE();
  const { connection } = useMoonraker();
  const { settings } = useSettings();
  const disabled = connection !== 'connected';

  if (connection === 'connected' && !hardwareDetected) {
    return (
      <View style={[styles.screen, styles.emptyScreen]}>
        <MaterialCommunityIcons name="cube-off-outline" size={40} color={colors.subtext} />
        <Text style={styles.emptyTitle}>{t('No ACE hardware detected')}</Text>
        <Text style={styles.emptyText}>
          {t(
            "The printer reports 0 connected ACE units. If you haven't installed multiACE yet, that's expected — this tab lights up once a unit is wired in."
          )}
        </Text>
      </View>
    );
  }

  // Safety: every ACE action is confirmed before execution.
  const confirmRun = (title: string, script: string) => {
    Alert.alert(title, script, [
      { text: t('Cancel'), style: 'cancel' },
      { text: 'Run', onPress: () => sendGcode(script) },
    ]);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {units.map((unit) => (
        <AceUnitCard
          key={unit.index}
          unit={unit}
          disabled={disabled}
          confirmRun={confirmRun}
          temperatureUnit={settings.temperatureUnit}
        />
      ))}

      {units.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Cross-ACE switching')}</Text>
          <View style={styles.switchRow}>
            {units.map((unit) => (
              <TouchableOpacity
                key={unit.index}
                style={[styles.switchBtn, disabled && styles.disabledBtn]}
                disabled={disabled}
                onPress={() =>
                  confirmRun(`Switch to ACE ${unit.index}?`, ACE_MACROS.switchAce(unit.index - 1))
                }
              >
                <Text style={styles.switchText}>ACE {unit.index}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {aceMacros.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>All ACE macros on printer</Text>
          <Text style={styles.hint}>
            If the buttons above use wrong macro names, run the real ones here (and adjust
            hooks/useACE.ts).
          </Text>
          <View style={styles.macroWrap}>
            {aceMacros.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.macroChip, disabled && styles.disabledBtn]}
                disabled={disabled}
                onPress={() => confirmRun('Run macro?', m)}
              >
                <Text style={styles.macroChipText}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function AceUnitCard({
  unit,
  disabled,
  confirmRun,
  temperatureUnit,
}: {
  unit: AceUnit;
  disabled: boolean;
  confirmRun: (title: string, script: string) => void;
  temperatureUnit: TemperatureUnit;
}) {
  const [dryTemp, setDryTemp] = useState(() =>
    Math.round(displayTemperature(45, temperatureUnit)).toString()
  );
  const [dryMins, setDryMins] = useState('240');
  const unitSymbol = temperatureUnitSymbol(temperatureUnit);

  useEffect(() => {
    setDryTemp(Math.round(displayTemperature(45, temperatureUnit)).toString());
  }, [temperatureUnit]);

  return (
    <View style={styles.card}>
      <View style={styles.unitHeader}>
        <Text style={styles.cardTitle}>ACE {unit.index}</Text>
        <View style={styles.unitStatus}>
          <View
            style={[
              styles.dot,
              { backgroundColor: unit.connected ? colors.success : colors.subtext },
            ]}
          />
          <Text style={styles.unitStatusText}>
            {unit.connected
              ? typeof unit.temp === 'number'
                ? formatTemperature(unit.temp, temperatureUnit, 0)
                : 'online'
              : 'no data'}
          </Text>
        </View>
      </View>

      {unit.lanes.map((lane) => (
        <ACELaneRow
          key={lane.index}
          lane={lane}
          disabled={disabled}
          onLoad={() =>
            confirmRun(
              `Load ACE ${unit.index} lane ${lane.index + 1} → head ${lane.index}?`,
              ACE_MACROS.load(unit.index - 1, lane.index)
            )
          }
          onUnload={() =>
            confirmRun(
              `Unload head ${lane.index} back to ACE?`,
              ACE_MACROS.unload(unit.index - 1, lane.index)
            )
          }
        />
      ))}

      <View style={styles.dryerBox}>
        <Text style={styles.dryerTitle}>
          {t('Dryer')}{' '}
          {unit.dryer.active
            ? `\u2014 ${
                typeof unit.dryer.targetTemp === 'number'
                  ? formatTemperature(unit.dryer.targetTemp, temperatureUnit, 0)
                  : '?'
              }` +
              (unit.dryer.remainingMin != null ? `, ${unit.dryer.remainingMin} min` : '')
            : `\u2014 ${t('off')}`}
        </Text>
        <View style={styles.dryerRow}>
          <TextInput
            style={styles.dryerInput}
            value={dryTemp}
            onChangeText={setDryTemp}
            keyboardType="numeric"
            placeholder={unitSymbol}
            placeholderTextColor={colors.subtext}
          />
          <Text style={styles.dryerUnit}>{unitSymbol}</Text>
          <TextInput
            style={styles.dryerInput}
            value={dryMins}
            onChangeText={setDryMins}
            keyboardType="numeric"
            placeholder="min"
            placeholderTextColor={colors.subtext}
          />
          <Text style={styles.dryerUnit}>min</Text>
          <TouchableOpacity
            style={[
              styles.dryerBtn,
              { backgroundColor: colors.primary },
              disabled && styles.disabledBtn,
            ]}
            disabled={disabled}
            onPress={() =>
              confirmRun(
                `Start drying ACE ${unit.index}?`,
                ACE_MACROS.dryStart(
                  unit.index - 1,
                  Math.round(inputTemperatureToCelsius(dryTemp, temperatureUnit)) || 45,
                  parseInt(dryMins, 10) || 240
                )
              )
            }
          >
            <Text style={styles.dryerBtnText}>{t('Start')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dryerBtn, styles.dryerStopBtn, disabled && styles.disabledBtn]}
            disabled={disabled}
            onPress={() =>
              confirmRun(`Stop drying ACE ${unit.index}?`, ACE_MACROS.dryStop(unit.index - 1))
            }
          >
            <Text style={styles.dryerBtnText}>{t('Stop')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
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
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  unitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  unitStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  unitStatusText: {
    color: colors.subtext,
    fontSize: 12,
  },
  dryerBox: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  dryerTitle: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  dryerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dryerInput: {
    backgroundColor: colors.bg,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    width: 56,
    fontSize: 13,
    textAlign: 'center',
  },
  dryerUnit: {
    color: colors.subtext,
    fontSize: 11,
  },
  dryerBtn: {
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    marginLeft: 'auto',
  },
  dryerStopBtn: {
    backgroundColor: colors.cardAlt,
    marginLeft: 0,
  },
  dryerBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.4,
  },
  switchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  switchBtn: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  switchText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  hint: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 4,
  },
  macroWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  macroChip: {
    backgroundColor: colors.cardAlt,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  macroChipText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
});
