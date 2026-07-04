import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { t } from '../services/i18n';
import {
  displayTemperature,
  formatTemperature,
  inputTemperatureToCelsius,
} from '../services/temperature';
import type { TemperatureUnit } from '../services/temperature';
import { colors, spacing } from '../constants/theme';

interface Props {
  status: Record<string, any>;
  sendGcode: (script: string) => Promise<boolean>;
  disabled?: boolean;
  showPandaBreath?: boolean;
  gcodeHelp?: Record<string, string>;
  temperatureUnit?: TemperatureUnit;
}

const SPEED_STEPS = [0, 25, 50, 75, 100];
const GENERIC_HEATER_PREFIX = 'heater_generic ';
const PANDA_BREATH_MAX_TEMP = 60;
const PANDA_BREATH_NAME_RE = /(panda|breath|chamber)/i;
const PANDA_AUTO_FILTER_TEMP = 30;
const PANDA_AUTO_HOTBED_TEMP = 80;
const PANDA_DRY_PRESETS = [
  { material: 'PLA', temp: 55, hours: 12 },
  { material: 'PETG', temp: 60, hours: 12 },
];

function genericHeaterName(objectKey: string): string {
  return objectKey.startsWith(GENERIC_HEATER_PREFIX)
    ? objectKey.slice(GENERIC_HEATER_PREFIX.length)
    : objectKey;
}

function findPandaBreathHeater(status: Record<string, any>): Record<string, any> | null {
  const heaterKeys = Object.keys(status).filter(
    (key) =>
      key.startsWith(GENERIC_HEATER_PREFIX) &&
      typeof status[key]?.temperature === 'number'
  );
  const namedKey = heaterKeys.find((key) => PANDA_BREATH_NAME_RE.test(genericHeaterName(key)));
  const objectKey = namedKey ?? (heaterKeys.length === 1 ? heaterKeys[0] : '');
  if (!objectKey) return null;

  return status[objectKey] ?? {};
}

function hasGcode(gcodeHelp: Record<string, string> | undefined, command: string): boolean {
  return Object.prototype.hasOwnProperty.call(gcodeHelp ?? {}, command);
}

function dryCommand(gcodeHelp: Record<string, string> | undefined): 'start' | 'run' | '' {
  if (hasGcode(gcodeHelp, 'PANDA_BREATH_DRY_START')) return 'start';
  if (hasGcode(gcodeHelp, 'PANDA_BREATH_DRY_RUN')) return 'run';
  return '';
}

function defaultTargetInput(celsius: number, unit: TemperatureUnit): string {
  return Math.round(displayTemperature(celsius, unit)).toString();
}

function clampInputToCelsius(value: string, unit: TemperatureUnit, maxCelsius: number): number {
  const celsius = inputTemperatureToCelsius(value, unit);
  return Math.max(0, Math.min(maxCelsius, Math.round(celsius)));
}

function dryTimeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function pandaModeLabel(
  pandaState: Record<string, any>,
  heater: Record<string, any> | null,
  target: number
): string {
  if (pandaState.connected === false) return t('offline');

  const mode = Number(pandaState.work_mode);
  const remaining = Number(pandaState.remaining_seconds);
  const drying =
    pandaState.filament_drying_active === true ||
    (Number.isFinite(remaining) && remaining > 0) ||
    mode === 3;
  if (drying) {
    const remainingText = dryTimeLabel(remaining);
    return remainingText ? `${t('Dry')} ${remainingText}` : t('Dry');
  }

  if (pandaState.auto_enabled === true || mode === 1) return t('Auto');
  if (target > 0 || pandaState.work_on === true) return t('Manual');
  return heater ? t('Idle') : t('not detected');
}

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

export default function ControlsPanel({
  status,
  sendGcode,
  disabled,
  showPandaBreath,
  gcodeHelp,
  temperatureUnit = 'c',
}: Props) {
  const [bedTarget, setBedTarget] = useState(() => defaultTargetInput(60, temperatureUnit));
  const [pandaTarget, setPandaTarget] = useState(() => defaultTargetInput(45, temperatureUnit));

  useEffect(() => {
    setBedTarget(defaultTargetInput(60, temperatureUnit));
    setPandaTarget(defaultTargetInput(45, temperatureUnit));
  }, [temperatureUnit]);

  const bed = status.heater_bed ?? {};
  const pandaBreath = showPandaBreath ? findPandaBreathHeater(status) : null;
  const pandaState = showPandaBreath ? status.panda_breath ?? {} : {};
  const pandaTemp =
    typeof pandaBreath?.temperature === 'number' ? pandaBreath.temperature : 0;
  const pandaActiveTarget =
    typeof pandaBreath?.target === 'number' ? pandaBreath.target : 0;
  const supportsPandaAuto =
    hasGcode(gcodeHelp, 'PANDA_BREATH_AUTO') || typeof pandaState.auto_target === 'number';
  const pandaDryCommand = dryCommand(gcodeHelp);
  const pandaDryActive =
    pandaState.filament_drying_active === true ||
    Number(pandaState.remaining_seconds) > 0 ||
    Number(pandaState.work_mode) === 3;
  const pandaMode = pandaModeLabel(pandaState, pandaBreath, pandaActiveTarget);
  const partFan = status.fan ?? {};
  const cavityFan = status['fan_generic cavity_fan'] ?? null;

  const startPandaDry = (preset: (typeof PANDA_DRY_PRESETS)[number]) => {
    if (pandaDryCommand === 'start') {
      sendGcode(`PANDA_BREATH_DRY_START TEMP=${preset.temp} HOURS=${preset.hours}`);
    } else if (pandaDryCommand === 'run') {
      sendGcode(`PANDA_BREATH_DRY_RUN TARGET=${preset.temp} DURATION=${preset.hours * 60}`);
    }
  };

  const choosePandaDryPreset = () => {
    Alert.alert(t('Dry filament'), t('Choose a drying preset.'), [
      { text: t('Cancel'), style: 'cancel' },
      ...PANDA_DRY_PRESETS.map((preset) => ({
        text: `${preset.material} ${formatTemperature(preset.temp, temperatureUnit, 0)} ${preset.hours}h`,
        onPress: () => startPandaDry(preset),
      })),
    ]);
  };

  const stopPandaBreath = () => {
    const lines: string[] = [];
    if (pandaDryActive && hasGcode(gcodeHelp, 'PANDA_BREATH_DRY_STOP')) {
      lines.push('PANDA_BREATH_DRY_STOP');
    }
    if (supportsPandaAuto) {
      lines.push('PANDA_BREATH_AUTO ENABLE=0');
    }
    lines.push('M141 S0');
    sendGcode(lines.join('\n'));
  };

  return (
    <View style={styles.card}>
      {/* bed heater */}
      <View style={styles.row}>
        <Text style={styles.rowLabel}>
          {t('Bed')}{' '}
          <Text style={styles.rowValue}>
            {formatTemperature(bed.temperature, temperatureUnit, 0)}
            {bed.target > 0 ? ` \u2192 ${formatTemperature(bed.target, temperatureUnit, 0)}` : ''}
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
              const tgt = clampInputToCelsius(bedTarget, temperatureUnit, 110);
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

      {showPandaBreath && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>
            {t('Panda Breath')}{' '}
            <Text style={styles.rowValue}>
              {pandaBreath
                ? `${formatTemperature(pandaTemp, temperatureUnit, 0)}${
                    pandaActiveTarget > 0
                      ? ` \u2192 ${formatTemperature(pandaActiveTarget, temperatureUnit, 0)}`
                      : ''
                  } \u00B7 ${pandaMode}`
                : t('not detected')}
            </Text>
          </Text>
          {pandaBreath && (
            <View style={styles.chips}>
              <TextInput
                style={styles.tempInput}
                value={pandaTarget}
                onChangeText={setPandaTarget}
                keyboardType="numeric"
                placeholderTextColor={colors.subtext}
              />
              <TouchableOpacity
                style={[
                  styles.chip,
                  { backgroundColor: colors.primary },
                  disabled && styles.disabled,
                ]}
                disabled={disabled}
                onPress={() => {
                  const tgt = clampInputToCelsius(
                    pandaTarget,
                    temperatureUnit,
                    PANDA_BREATH_MAX_TEMP
                  );
                  sendGcode(`M141 S${tgt}`);
                }}
              >
                <Text style={[styles.chipText, { color: '#fff' }]}>{t('Set')}</Text>
              </TouchableOpacity>
              {supportsPandaAuto && (
                <TouchableOpacity
                  style={[
                    styles.chip,
                    (pandaState.auto_enabled === true || Number(pandaState.work_mode) === 1) && {
                      backgroundColor: colors.primary,
                    },
                    disabled && styles.disabled,
                  ]}
                  disabled={disabled}
                  onPress={() => {
                    const tgt = clampInputToCelsius(
                      pandaTarget,
                      temperatureUnit,
                      PANDA_BREATH_MAX_TEMP
                    );
                    sendGcode(
                      `PANDA_BREATH_AUTO ENABLE=1 TARGET=${tgt} FILTERTEMP=${PANDA_AUTO_FILTER_TEMP} HOTBEDTEMP=${PANDA_AUTO_HOTBED_TEMP}`
                    );
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      (pandaState.auto_enabled === true || Number(pandaState.work_mode) === 1) && {
                        color: '#fff',
                      },
                    ]}
                  >
                    {t('Auto')}
                  </Text>
                </TouchableOpacity>
              )}
              {pandaDryCommand && (
                <TouchableOpacity
                  style={[
                    styles.chip,
                    pandaDryActive && { backgroundColor: colors.primary },
                    disabled && styles.disabled,
                  ]}
                  disabled={disabled}
                  onPress={choosePandaDryPreset}
                >
                  <Text style={[styles.chipText, pandaDryActive && { color: '#fff' }]}>
                    {t('Dry')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.chip, disabled && styles.disabled]}
                disabled={disabled}
                onPress={stopPandaBreath}
              >
                <Text style={styles.chipText}>{pandaDryActive ? t('Stop') : t('Off')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

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
    flexWrap: 'wrap',
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
