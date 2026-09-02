// Cockpit Home sections. Each maps 1:1 to a `settings.dashboard.*` toggle so
// the real screen can drop any of them without the layout collapsing:
//   ToolheadGrid → filaments   TempRow → temps   MacroRow → macros
//   PrinterScreen → gui        EstopBar → estop
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import CameraFeed from '../../CameraFeed';
import ScreenMirror from '../../ScreenMirror';
import {
  alpha,
  CameraMock,
  COCKPIT as P,
  SectionLabel,
  Sparkline,
} from '../shared';
import type { CockpitData, CockpitTemp, CockpitTool } from './data';
import { useSettings } from '../../../hooks/useSettings';
import { t } from '../../../services/i18n';
import type { BambuFan, BambuHeater } from '../../../services/bambuControls';

// ~16s of trace at the model's 2s sampling interval.
const MIN_TRACE_POINTS = 8;

// Drying presets offered by the Dry chip. Temp/hours map to the firmware's
// PANDA_BREATH_DRY_START (HOURS) / PANDA_BREATH_DRY_RUN (DURATION in minutes).
const PANDA_DRY_PRESETS = [
  { label: 'PLA 55°C 12h', temp: 55, hours: 12 },
  { label: 'PETG 60°C 12h', temp: 60, hours: 12 },
];

const BAMBU_TEMPERATURE_PRESETS: Record<BambuHeater, number[]> = {
  nozzle: [0, 180, 200, 220, 240, 260],
  bed: [0, 40, 55, 65, 80, 100],
};
const BAMBU_FAN_PRESETS = [0, 25, 50, 75, 100];
const BAMBU_FANS: { key: BambuFan; label: string }[] = [
  { key: 'part', label: 'Part' },
  { key: 'aux', label: 'Aux' },
  { key: 'chamber', label: 'Chamber' },
];

function reportBambuControlError(title: string, error: unknown) {
  Alert.alert(
    title,
    error instanceof Error ? error.message : t('The printer did not accept the command.')
  );
}

/**
 * Four across, colour in a thick left edge. Carried over from the Rail
 * direction: the edges line up into one striped band, so you find the spool you
 * mean by colour in a single pass without reading a word. A circular swatch
 * per card doesn't do that.
 */
export function ToolheadRail({
  data,
  onEditSlot,
  onConfigureMaterialStation,
}: {
  data: CockpitData;
  onEditSlot: (index: number) => void;
  onConfigureMaterialStation: () => void;
}) {
  const { settings } = useSettings();
  const activePrinter = settings.printers.find((printer) => printer.id === settings.activePrinterId);
  const bambu = activePrinter?.kind === 'bambu-lan';
  const ad5x = activePrinter?.kind === 'flashforge-ad5x';
  const externalSpool = bambu && data.tools.length === 1;
  const sectionTitle = externalSpool ? t('External Spool') : bambu ? 'AMS Slots' : ad5x ? 'IFS Slots' : t('Toolheads');
  const materialStationNeedsSetup =
    ad5x &&
    (data.materialStationError === 'missing-credentials' ||
      data.materialStationError === 'auth-failed');

  const openBambuSlot = (tool: CockpitTool) => {
    const busy = data.state === 'printing';
    const actions = [
      !busy && !tool.empty
        ? {
            text: tool.active ? t('Unload') : t('Load'),
            onPress: () => void data.actions.changeBambuFilament(
              tool.active ? null : tool.bambuTrayIndex,
              tool.bambuChangeTemp
            ).catch((error: unknown) => {
              Alert.alert(
                t('Filament change failed'),
                error instanceof Error
                  ? error.message
                  : t('The printer did not accept the filament change.')
              );
            }),
          }
        : null,
      { text: t('Edit filament'), onPress: () => onEditSlot(tool.id) },
      { text: t('Cancel'), style: 'cancel' as const },
    ].filter(Boolean) as { text: string; style?: 'cancel'; onPress?: () => void }[];

    Alert.alert(
      externalSpool ? t('External Spool') : `${t('AMS Slot')} ${tool.id + 1}`,
      busy
        ? t('Filament cannot be changed while the printer is busy.')
        : tool.active
          ? t('This slot is currently feeding the nozzle.')
          : tool.empty
            ? t('This slot is empty.')
            : `${tool.brand} ${tool.material}`.trim(),
      actions
    );
  };

  return (
    <View style={styles.section}>
      <SectionLabel palette={P} action={t('Manage')}>
        {sectionTitle}
      </SectionLabel>
      {materialStationNeedsSetup ? (
        <View style={styles.ifsSetupCard}>
          <MaterialCommunityIcons name="database-lock-outline" size={21} color={P.accent} />
          <View style={styles.ifsSetupCopy}>
            <Text style={styles.ifsSetupTitle}>
              {data.materialStationError === 'auth-failed'
                ? t('IFS access was rejected')
                : t('Connect the AD5X IFS')}
            </Text>
            <Text style={styles.ifsSetupText}>
              {t('Add the printer serial number and Printer ID to show which rolls are actually loaded.')}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.ifsSetupButton, pressed && { opacity: 0.72 }]}
            onPress={onConfigureMaterialStation}
            accessibilityRole="button"
            accessibilityLabel={t('Set up IFS access')}
          >
            <Text style={styles.ifsSetupButtonText}>{t('Set up')}</Text>
          </Pressable>
        </View>
      ) : null}
      {bambu && data.bambu?.amsHealth.length ? (
        <View style={styles.amsHealthRow}>
          {data.bambu.amsHealth.map((health) => (
            <View key={health.unit} style={styles.amsHealthChip}>
              <MaterialCommunityIcons name="water-percent" size={15} color={P.accent} />
              <Text style={styles.amsHealthText}>
                {data.bambu!.amsHealth.length > 1 ? `AMS ${health.unit + 1} · ` : ''}
                {health.humidity == null ? t('Humidity unavailable') : `${t('Humidity')} ${health.humidity}/5`}
                {health.temperature == null ? '' : ` · ${Math.round(health.temperature)}°C`}
              </Text>
            </View>
          ))}
          <Text style={styles.amsHealthHint}>{t('1 is driest')}</Text>
        </View>
      ) : null}
      <View style={styles.rail}>
        {data.tools.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            positionLabel={externalSpool
              ? t('External Spool')
              : bambu
                ? `${t('Slot')} ${tool.id + 1}`
                : ad5x
                  ? `${t('Slot')} ${tool.id + 1}`
                  : `T${tool.id + 1}`}
            onPress={ad5x ? undefined : bambu ? () => openBambuSlot(tool) : () => onEditSlot(tool.id)}
          />
        ))}
      </View>
    </View>
  );
}

function ToolCard({
  tool,
  positionLabel,
  onPress,
}: {
  tool: CockpitTool;
  positionLabel: string;
  onPress?: () => void;
}) {
  // Empty Bambu trays still need to open so their saved filament can be edited.
  const disabled = !onPress;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.toolCard,
        tool.active && {
          borderColor: alpha(P.accent, 0.5),
          backgroundColor: alpha(P.accent, 0.06),
        },
        pressed && !disabled && { opacity: 0.7 },
      ]}
    >
      {/* An empty slot still has a saved colour; painting the edge solid would
          claim filament is loaded when the printer says it isn't. */}
      <View
        style={[
          styles.toolEdge,
          tool.empty ? styles.toolEdgeEmpty : { backgroundColor: tool.color },
        ]}
      />
      <View style={styles.toolBody}>
        <Text style={[styles.toolId, tool.active && { color: P.accent }]}>{positionLabel}</Text>
        {tool.empty ? (
          <Text style={[styles.toolMaterial, { color: P.dim }]}>{t('Empty')}</Text>
        ) : (
          <>
            {/* Main type only. "PLA BASIC" clipped to "PLA B…" at a quarter of
                the screen width — the subtype lives in the editor instead. */}
            <Text style={styles.toolMaterial} numberOfLines={1}>
              {tool.mainType}
            </Text>
            {/* Brand truncates first at this width by design — colour and
                material already identify a spool; brand is the tiebreaker,
                and it matters because everything reports "Generic PLA". */}
            <Text style={styles.toolBrand} numberOfLines={1}>
              {tool.brand}
            </Text>
          </>
        )}
        <Text style={[styles.toolTemp, tool.active && { color: P.text }]}>{tool.temp}°</Text>
      </View>
      {tool.active ? (
        <View style={[styles.toolActiveBar, { backgroundColor: P.accent }]} />
      ) : null}
    </Pressable>
  );
}

export function TempRow({ cardWidth, data }: { cardWidth: number; data: CockpitData }) {
  const chooseTemperature = (temp: CockpitTemp) => {
    const heater: BambuHeater | null = temp.key === 'nozzle'
      ? 'nozzle'
      : temp.key === 'bed'
        ? 'bed'
        : null;
    if (!heater) return;
    Alert.alert(t(`Set ${temp.label} temperature`), t('Choose a target temperature.'), [
      { text: t('Cancel'), style: 'cancel' },
      ...BAMBU_TEMPERATURE_PRESETS[heater].map((target) => ({
        text: `${target === temp.target ? '✓ ' : ''}${target === 0 ? t('Off') : `${target}°C`}`,
        onPress: () => void data.actions.setBambuTemperature(heater, target)
          .catch((error: unknown) => reportBambuControlError(t('Temperature change failed'), error)),
      })),
    ]);
  };

  const chooseFanSpeed = (fan: BambuFan, label: string, current: number) => {
    Alert.alert(`${label} ${t('fan')}`, t('Choose a fan speed.'), [
      { text: t('Cancel'), style: 'cancel' },
      ...BAMBU_FAN_PRESETS.map((percent) => ({
        text: `${percent === current ? '✓ ' : ''}${percent === 0 ? t('Off') : `${percent}%`}`,
        onPress: () => void data.actions.setBambuFan(fan, percent)
          .catch((error: unknown) => reportBambuControlError(t('Fan change failed'), error)),
      })),
    ]);
  };

  const visibleFans = BAMBU_FANS.flatMap((fan) => {
    const speed = data.bambu?.fans[fan.key];
    return speed == null ? [] : [{ ...fan, speed }];
  });

  return (
    <View style={styles.section}>
      <SectionLabel palette={P} action={data.bambu ? t('Tap to set') : undefined}>
        {t('Temperatures')}
      </SectionLabel>
      <View style={styles.row}>
        {data.temps.map((temp) => (
          <TempCard
            key={temp.key}
            temp={temp}
            width={cardWidth}
            onPress={data.bambu && !data.offline && (temp.key === 'nozzle' || temp.key === 'bed')
              ? () => chooseTemperature(temp)
              : undefined}
          />
        ))}
      </View>
      {visibleFans.length > 0 ? (
        <View style={styles.bambuFanRow}>
          {visibleFans.map((fan) => (
            <Pressable
              key={fan.key}
              disabled={data.offline}
              accessibilityRole="button"
              accessibilityLabel={`${fan.label} fan ${fan.speed}%`}
              onPress={() => chooseFanSpeed(fan.key, fan.label, fan.speed)}
              style={({ pressed }) => [
                styles.bambuFanChip,
                data.offline && styles.pandaChipDisabled,
                pressed && { opacity: 0.68 },
              ]}
            >
              <MaterialCommunityIcons name="fan" size={16} color={P.accent} />
              <Text style={styles.bambuFanLabel}>{fan.label}</Text>
              <Text style={styles.bambuFanValue}>{fan.speed}%</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TempCard({ temp, width, onPress }: { temp: CockpitTemp; width: number; onPress?: () => void }) {
  const heating = temp.target > 0;
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${temp.label} ${temp.value}°, target ${temp.target}°` : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.tempCard, { width }, pressed && { opacity: 0.72 }]}
    >
      <MaterialCommunityIcons name={temp.icon} size={17} color={P.dim} />
      <Text style={styles.tempLabel}>{temp.label}</Text>
      <View style={styles.tempValueRow}>
        <Text style={styles.tempValue}>{temp.value}°</Text>
        {heating ? <Text style={styles.tempTarget}>/{temp.target}</Text> : null}
      </View>
      {/* The trace auto-scales to its own range, so 2-3 samples turn sensor
          noise into a dramatic spike. Wait for enough points to mean something
          — the history buffer fills at one sample every 2s. */}
      {temp.history.length >= MIN_TRACE_POINTS ? (
        <Sparkline
          data={temp.history}
          color={P.accent}
          width={width - 26}
          height={28}
          target={temp.target}
        />
      ) : (
        // Reserves the sparkline's exact height so the card doesn't resize when
        // the trace arrives; the rule sits mid-box rather than at the bottom,
        // where it read as a gap under the number.
        <View style={[styles.tempWarmup, { width: width - 26 }]}>
          <View style={styles.tempWarmupRule} />
        </View>
      )}
    </Pressable>
  );
}

/** Horizontal scroller — macro lists are user-defined and unbounded, so a wrap
 *  grid would silently push everything below it off screen. */
export function MacroRow({ data }: { data: CockpitData }) {
  if (data.macros.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionLabel palette={P} action={t('Edit')}>
        {t('Macros')}
      </SectionLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.macroScroll}
      >
        {data.macros.map((macro) => (
          <Pressable
            key={macro.name}
            onPress={() => data.actions.runMacro(macro.name)}
            style={({ pressed }) => [styles.macroPill, pressed && { opacity: 0.6 }]}
          >
            <MaterialCommunityIcons name={macro.icon} size={17} color={P.accent} />
            <Text style={styles.macroText}>{macro.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Panda Breath chamber heater / filament dryer. Mirrors the control set the old
 * ControlsPanel exposed: set a target temp, toggle Auto, run a drying cycle, or
 * turn everything off. Auto/Dry chips only render when the firmware speaks those
 * commands (feature-detected in the model). When no heater is detected the row
 * collapses to "not detected" rather than vanishing, so a disconnected unit
 * reads as a known state instead of a missing panel.
 */
export function PandaBreathRow({ data }: { data: CockpitData }) {
  const panda = data.pandaBreath;
  const [target, setTarget] = useState('45');
  const disabled = data.offline;

  const chooseDryPreset = () => {
    Alert.alert(t('Dry filament'), t('Choose a drying preset.'), [
      { text: t('Cancel'), style: 'cancel' },
      ...PANDA_DRY_PRESETS.map((preset) => ({
        text: preset.label,
        onPress: () => data.actions.panda.dry(preset.temp, preset.hours),
      })),
    ]);
  };

  return (
    <View style={styles.section}>
      <SectionLabel palette={P}>{t('Panda Breath')}</SectionLabel>
      <View style={styles.pandaCard}>
        <Text style={styles.pandaReadout}>
          {panda.detected
            ? `${panda.temp.toFixed(0)}°C${
                panda.target > 0 ? ` → ${panda.target.toFixed(0)}°C` : ''
              } · ${panda.mode}`
            : t('not detected')}
        </Text>
        {panda.detected ? (
          <View style={styles.pandaChips}>
            <TextInput
              style={styles.pandaInput}
              value={target}
              onChangeText={setTarget}
              keyboardType="numeric"
              placeholderTextColor={P.dim}
              accessibilityLabel={t('Panda Breath target temperature')}
            />
            <Chip
              label={t('Set')}
              active={false}
              disabled={disabled}
              onPress={() => data.actions.panda.setTarget(parseInt(target, 10) || 0)}
            />
            {panda.supportsAuto ? (
              <Chip
                label={t('Auto')}
                active={panda.autoOn}
                disabled={disabled}
                onPress={() =>
                  data.actions.panda.setAuto(parseInt(target, 10) || 0, !panda.autoOn)
                }
              />
            ) : null}
            {panda.dryCommand ? (
              <Chip
                label={t('Dry')}
                active={panda.dryActive}
                disabled={disabled}
                onPress={chooseDryPreset}
              />
            ) : null}
            <Chip
              label={panda.dryActive ? t('Stop') : t('Off')}
              active={false}
              disabled={disabled}
              onPress={() => data.actions.panda.stop()}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.pandaChip,
        active && { backgroundColor: P.accent, borderColor: P.accent },
        disabled && styles.pandaChipDisabled,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.pandaChipText, active && { color: P.onAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * The printer's own touchscreen, mirrored. On the AD5X this is helixd's live
 * /api/screen mirror with remote taps (ScreenMirror); other machines fall back
 * to the `gui` webcam in a WebView.
 */
export function PrinterScreen({
  data,
  width,
  onInteractStart,
  onInteractEnd,
}: {
  data: CockpitData;
  width: number;
  onInteractStart: () => void;
  onInteractEnd: () => void;
}) {
  const { settings } = useSettings();
  const activePrinter = settings.printers.find((p) => p.id === settings.activePrinterId);
  // helixd (screen + tap daemon) only exists on the AD5X — U1/generic keep the
  // legacy gui webcam mirror.
  const useLiveScreen = activePrinter?.kind === 'flashforge-ad5x';

  // The legacy U1 panel is 4:3; the live AD5X panel sizes itself (5:3) via the
  // mirror's aspectRatio, so no fixed height is needed there.
  const legacyHeight = Math.round(width * (3 / 4));

  return (
    <View style={styles.section}>
      <SectionLabel palette={P}>{t('Printer screen')}</SectionLabel>
      {/* The embedded panel forwards touches to the printer. The parent
          ScrollView would otherwise claim vertical movement as a scroll, so
          it's disabled for the duration of a touch here — without this the
          screen only ever sees taps, and its sliders/menus are dead. */}
      <View
        style={[styles.screenCard, !useLiveScreen && { height: legacyHeight }]}
        onTouchStart={onInteractStart}
        onTouchEnd={onInteractEnd}
        onTouchCancel={onInteractEnd}
      >
        {useLiveScreen ? (
          <ScreenMirror />
        ) : data.guiScreen ? (
          <CameraFeed
            url={data.guiScreen.url}
            snapshotUrl={data.guiScreen.snapshotUrl}
            height={legacyHeight}
            chromeless
            showControls={false}
          />
        ) : (
          <CameraMock
            palette={P}
            height={legacyHeight}
            radius={0}
            label={t('NO PRINTER SCREEN')}
            icon="monitor-dashboard"
          />
        )}
      </View>
    </View>
  );
}

/** Full-width and last on the page: destructive, so it should never sit under
 *  a thumb reaching for Pause. */
export function EstopBar({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.estop, pressed && { opacity: 0.75 }]}
    >
      <MaterialCommunityIcons name="alert-octagon" size={22} color="#FFFFFF" />
      <Text style={styles.estopText}>{t('EMERGENCY STOP')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  rail: { flexDirection: 'row', gap: 8 },
  ifsSetupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: P.radius - 5,
    borderWidth: 1,
    borderColor: alpha(P.accent, 0.35),
    backgroundColor: alpha(P.accent, 0.07),
  },
  ifsSetupCopy: { flex: 1, gap: 2 },
  ifsSetupTitle: { color: P.text, fontSize: 12, fontWeight: '800' },
  ifsSetupText: { color: P.dim, fontSize: 10, lineHeight: 14 },
  ifsSetupButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: P.accentFill,
  },
  ifsSetupButtonText: { color: P.onAccent, fontSize: 11, fontWeight: '800' },
  amsHealthRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  amsHealthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: alpha(P.accent, 0.28),
    backgroundColor: alpha(P.accent, 0.07),
  },
  amsHealthText: { color: P.text, fontSize: 11, fontWeight: '700' },
  amsHealthHint: { color: P.dim, fontSize: 10, fontWeight: '600' },
  toolCard: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: P.radius - 6,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    overflow: 'hidden',
    minHeight: 106,
  },
  // Thick enough that four of them read as one band across the row. The light
  // outline is load-bearing: black filament is common, and a bare #000000 bar
  // is indistinguishable from the card behind it.
  toolEdge: {
    width: 8,
    borderWidth: 1,
    borderColor: alpha('#FFFFFF', 0.3),
  },
  toolEdgeEmpty: {
    backgroundColor: 'transparent',
    borderRightWidth: 1,
    borderRightColor: alpha(P.dim, 0.45),
    borderStyle: 'dashed',
  },
  toolBody: { flex: 1, paddingVertical: 10, paddingHorizontal: 9, gap: 1 },
  toolId: { color: P.dim, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  toolMaterial: { color: P.text, fontSize: 13, fontWeight: '800' },
  toolBrand: { color: P.dim, fontSize: 10, fontWeight: '600' },
  toolTemp: { color: P.dim, fontSize: 17, fontWeight: '700', marginTop: 'auto' },
  toolActiveBar: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },

  tempCard: {
    borderRadius: P.radius - 4,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    padding: 13,
    gap: 3,
  },
  tempLabel: { color: P.dim, fontSize: 11, fontWeight: '700' },
  tempWarmup: { height: 28, justifyContent: 'center' },
  tempWarmupRule: { height: 1, backgroundColor: alpha(P.dim, 0.28) },
  tempValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginBottom: 5 },
  tempValue: { color: P.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.8 },
  tempTarget: { color: P.dim, fontSize: 11, fontWeight: '700' },
  bambuFanRow: { flexDirection: 'row', gap: 8 },
  bambuFanChip: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: P.radius - 6,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    paddingHorizontal: 7,
  },
  bambuFanLabel: { color: P.dim, fontSize: 10, fontWeight: '700' },
  bambuFanValue: { color: P.text, fontSize: 11, fontWeight: '800' },

  macroScroll: { gap: 8, paddingRight: 4 },
  macroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
  },
  macroText: { color: P.text, fontSize: 13, fontWeight: '800' },

  pandaCard: {
    borderRadius: P.radius - 4,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    padding: 14,
    gap: 12,
  },
  pandaReadout: { color: P.text, fontSize: 14, fontWeight: '800' },
  pandaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pandaInput: {
    width: 56,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.bg,
    color: P.text,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  pandaChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pandaChipDisabled: { opacity: 0.4 },
  pandaChipText: { color: P.text, fontSize: 13, fontWeight: '800' },

  screenCard: {
    borderRadius: P.radius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
  },
  estop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 60,
    borderRadius: P.radius - 4,
    backgroundColor: alpha(P.danger, 0.16),
    borderWidth: 1,
    borderColor: alpha(P.danger, 0.55),
  },
  estopText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.6 },
});
