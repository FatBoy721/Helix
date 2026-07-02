import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { t } from '../services/i18n';
import { colors, spacing } from '../constants/theme';

interface Props {
  status: Record<string, any>;
  sendGcode: (script: string) => Promise<boolean>;
  disabled?: boolean;
}

const SPEED_STEPS = [0, 25, 50, 75, 100];

// purifier = the chamber air filter ("panda breath"). SET_PURIFIER_MODE is
// extras-registered so it doesn't show in gcode help, but it's real —
// PRINT_END calls it with MODE=0.
const PURIFIER_MODES = [
  { mode: 0, label: 'Off' },
  { mode: 1, label: 'On' },
  { mode: 2, label: 'Max' },
];

function FanRow({
  label,
  speed,
  onSet,
  disabled,
}: {
  label: string;
  speed: number; // 0..1
  onSet: (pct: number) => void;
  disabled?: boolean;
}) {
  const currentPct = Math.round(speed * 100);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>
        {label} <Text style={styles.rowValue}>{currentPct}%</Text>
      </Text>
      <View style={styles.chips}>
        {SPEED_STEPS.map((pct) => (
          <TouchableOpacity
            key={pct}
            style={[
              styles.chip,
              currentPct === pct && { backgroundColor: colors.primary },
              disabled && styles.disabled,
            ]}
            disabled={disabled}
            onPress={() => onSet(pct)}
          >
            <Text style={[styles.chipText, currentPct === pct && { color: '#fff' }]}>
              {pct === 0 ? t('Off') : `${pct}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function ControlsPanel({ status, sendGcode, disabled }: Props) {
  const [bedTarget, setBedTarget] = useState('60');

  const bed = status.heater_bed ?? {};
  const partFan = status.fan ?? {};
  const cavityFan = status['fan_generic cavity_fan'] ?? null;
  const purifier = status.purifier ?? null;
  const purifierMode: number = typeof purifier?.mode === 'number' ? purifier.mode : -1;

  return (
    <View style={styles.card}>
      {/* bed heater */}
      <View style={styles.row}>
        <Text style={styles.rowLabel}>
          {t('Bed')}{' '}
          <Text style={styles.rowValue}>
            {(bed.temperature ?? 0).toFixed(0)}°C
            {bed.target > 0 ? ` → ${bed.target.toFixed(0)}°C` : ''}
          </Text>
        </Text>
        <View style={styles.chips}>
          <TextInput
            style={styles.tempInput}
            value={bedTarget}
            onChangeText={setBedTarget}
            keyboardType="numeric"
            placeholderTextColor={colors.subtext}
          />
          <TouchableOpacity
            style={[styles.chip, { backgroundColor: colors.primary }, disabled && styles.disabled]}
            disabled={disabled}
            onPress={() => {
              const tgt = Math.max(0, Math.min(110, parseInt(bedTarget, 10) || 0));
              sendGcode(`SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${tgt}`);
            }}
          >
            <Text style={[styles.chipText, { color: '#fff' }]}>{t('Set')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, disabled && styles.disabled]}
            disabled={disabled}
            onPress={() => sendGcode('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=0')}
          >
            <Text style={styles.chipText}>{t('Off')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* part cooling fan on the active head */}
      <FanRow
        label={t('Part fan')}
        speed={partFan.speed ?? 0}
        disabled={disabled}
        onSet={(pct) => sendGcode(pct === 0 ? 'M107' : `M106 S${Math.round((pct / 100) * 255)}`)}
      />

      {/* chamber circulation fan */}
      {cavityFan && (
        <FanRow
          label={t('Cavity fan')}
          speed={cavityFan.speed ?? 0}
          disabled={disabled}
          onSet={(pct) => sendGcode(`SET_FAN_SPEED FAN=cavity_fan SPEED=${(pct / 100).toFixed(2)}`)}
        />
      )}

      {/* purifier / "panda breath" */}
      {purifier && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>
            {t('Purifier')}{' '}
            <Text style={styles.rowValue}>
              {purifier.exhaust_fan?.speed > 0 || purifier.inner_fan?.speed > 0
                ? `${Math.round((purifier.inner_fan?.speed ?? 0) * 100)}% / ${Math.round((purifier.exhaust_fan?.speed ?? 0) * 100)}%`
                : t('off')}
            </Text>
          </Text>
          <View style={styles.chips}>
            {PURIFIER_MODES.map((m) => (
              <TouchableOpacity
                key={m.mode}
                style={[
                  styles.chip,
                  purifierMode === m.mode && { backgroundColor: colors.primary },
                  disabled && styles.disabled,
                ]}
                disabled={disabled}
                onPress={() => sendGcode(`SET_PURIFIER_MODE MODE=${m.mode}`)}
              >
                <Text style={[styles.chipText, purifierMode === m.mode && { color: '#fff' }]}>
                  {t(m.label)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
    gap: spacing.md,
  },
  row: {
    gap: spacing.sm,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  rowValue: {
    color: colors.subtext,
    fontWeight: '400',
    fontSize: 12,
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    backgroundColor: colors.cardAlt,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minWidth: 42,
    alignItems: 'center',
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  tempInput: {
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
  disabled: {
    opacity: 0.4,
  },
});
