// Slice tab presentation — the Cockpit direction from the lab, wired to real
// slicer state.
//
// Kept out of app/(tabs)/slicer.tsx because that file is already ~1800 lines of
// state machine; the layout has no business growing inside it.
//
// The filament strip is the Home toolhead rail rather than the old
// FilamentSlotsEditor: tapping a slot opens the same FilamentEditor sheet Home
// uses, which lands directly on the toolhead you tapped instead of asking which
// slot you meant after you've already said.
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { alpha, CameraMock, COCKPIT as P, Dot, type IconName } from '../dashboard/shared';
import { t } from '../../services/i18n';
import type { FilamentSlotDisplay } from '../FilamentSlotsEditor';
import PrinterIcon from '../PrinterIcon';
import { useSettings } from '../../hooks/useSettings';

export type Tone = 'good' | 'bad' | 'muted' | 'warn';

export function toneColor(tone: Tone): string {
  if (tone === 'good') return P.success;
  if (tone === 'bad') return P.danger;
  if (tone === 'warn') return P.warn;
  return P.dim;
}

/** Hero: the sliced render when there is one, the gradient placeholder until then. */
export function HeroCard({
  thumbUri,
  height,
  stateLabel,
  stateColor,
  fileName,
  percent,
  onClear,
  expand = false,
}: {
  thumbUri: string | null;
  height: number;
  stateLabel: string;
  stateColor: string;
  fileName: string | null;
  percent: number | null;
  onClear?: () => void;
  /** Stretch to fill the screen's leftover space instead of a fixed 16:9 box —
   *  keeps tall screens from turning into a void under the filament rail. */
  expand?: boolean;
}) {
  return (
    <View style={[styles.hero, expand && { flex: 1, minHeight: height }]}>
      {thumbUri ? (
        <Image
          source={{ uri: thumbUri }}
          style={expand ? { width: '100%', flex: 1 } : { width: '100%', height }}
          resizeMode="contain"
        />
      ) : (
        <CameraMock
          palette={P}
          height={height}
          radius={0}
          icon={fileName ? 'cube-outline' : 'tray-arrow-up'}
          label={fileName ? t('NOT SLICED YET') : t('NO MODEL')}
          style={expand ? { flex: 1, height: undefined } : undefined}
        />
      )}

      <View style={styles.pill}>
        <Dot color={stateColor} size={6} />
        <Text style={styles.pillText}>{stateLabel}</Text>
      </View>

      {fileName ? (
        <View style={styles.heroFoot}>
          <MaterialCommunityIcons name="file-outline" size={15} color={P.dim} />
          <Text style={styles.heroName} numberOfLines={1} ellipsizeMode="middle">
            {fileName}
          </Text>
          {percent !== null ? (
            <Text style={styles.heroPct}>{percent}%</Text>
          ) : onClear ? (
            <Pressable onPress={onClear} hitSlop={10} accessibilityLabel={t('Remove model')}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color={P.dim} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function Banner({
  tone,
  icon,
  text,
  action,
  onAction,
}: {
  tone: Tone;
  icon: IconName;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  const bad = tone === 'bad';
  const color = toneColor(tone);
  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: bad ? alpha(P.danger, 0.1) : P.surface,
          borderColor: bad ? alpha(P.danger, 0.4) : P.border,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={17} color={color} />
      <Text style={[styles.bannerText, { color: bad ? P.text : P.dim }]}>{text}</Text>
      {action ? (
        <Text onPress={onAction} style={styles.bannerAction}>
          {action}
        </Text>
      ) : null}
    </View>
  );
}

export function Secondary({
  icon,
  label,
  onPress,
  accent,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accent?: boolean;
  disabled?: boolean;
}) {
  const color = disabled ? P.dim : accent ? P.accent : P.dim;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondary,
        { borderColor: accent && !disabled ? alpha(P.accent, 0.45) : P.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={17} color={color} />
      <Text style={[styles.secondaryText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function StatRow({
  on,
  layers,
  time,
  grams,
}: {
  on: boolean;
  layers: string | null;
  time: string | null;
  grams: string | null;
}) {
  // Unknown values are omitted entirely rather than shown as '--': a card that
  // can't know its number (no embedded G-code, no MakerWorld stats) is dead UI.
  const cells = [
    { label: 'LAYERS', value: layers },
    { label: 'TIME', value: time },
    { label: 'FILAMENT', value: grams },
  ].filter((c): c is { label: string; value: string } => c.value !== null);
  if (cells.length === 0) return null;
  return (
    <View style={styles.stats}>
      {cells.map((c) => (
        <View key={c.label} style={styles.stat}>
          <Text style={[styles.statValue, { color: on ? P.text : P.dim }]}>{c.value}</Text>
          <Text style={styles.statLabel}>{t(c.label)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Home's toolhead rail, fed by the slicer's own resolved slots. */
export function ToolRail({
  slots,
  onEdit,
  externalSpool = false,
}: {
  slots: FilamentSlotDisplay[];
  onEdit: (index: number) => void;
  externalSpool?: boolean;
}) {
  const { settings } = useSettings();
  const activePrinter = settings.printers.find((printer) => printer.id === settings.activePrinterId);
  const bambu = activePrinter?.kind === 'bambu-lan';

  return (
    <View style={styles.railSection}>
      <Text style={styles.sectionLabel}>{t('FILAMENT')}</Text>
      <View style={styles.rail}>
        {slots.map((slot) => {
          const empty = slot.status === 'empty';
          return (
            <Pressable
              key={slot.index}
              onPress={() => onEdit(slot.index)}
              style={({ pressed }) => [styles.toolCard, pressed && { opacity: 0.7 }]}
            >
              {/* An empty slot still has a saved colour; painting the edge
                  solid would claim filament is loaded when it isn't. */}
              <View
                style={[
                  styles.toolEdge,
                  empty ? styles.toolEdgeEmpty : { backgroundColor: slot.color },
                ]}
              />
              <View style={styles.toolBody}>
                <Text style={styles.toolId}>
                  {externalSpool
                    ? t('External Spool')
                    : bambu
                      ? `${t('Lane')} ${slot.index + 1}`
                      : `T${slot.index + 1}`}
                </Text>
                {empty ? (
                  <Text style={[styles.toolMaterial, { color: P.dim }]}>{t('Empty')}</Text>
                ) : (
                  <>
                    <Text style={styles.toolMaterial} numberOfLines={1}>
                      {mainType(slot.material)}
                    </Text>
                    <Text style={styles.toolBrand} numberOfLines={1}>
                      {slot.brand || t('Generic')}
                    </Text>
                  </>
                )}
                {/* Home spends this line on temperature. Here it's load state:
                    an unloaded slot is the single most common reason slicing
                    is blocked, so it belongs on the card, not only in a banner. */}
                <Text style={[styles.toolState, { color: loadColor(slot.status) }]}>
                  {loadLabel(slot.status)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// "PLA BASIC" clips to "PLA B…" at a quarter of the screen; the subtype lives
// in the editor instead. Same call Home's rail makes.
function mainType(material: string | undefined): string {
  return (material ?? 'PLA').trim().split(/\s+/)[0] || 'PLA';
}

function loadLabel(status: FilamentSlotDisplay['status']): string {
  if (status === 'loaded') return t('Loaded');
  if (status === 'empty') return t('Empty');
  return t('Unknown');
}

function loadColor(status: FilamentSlotDisplay['status']): string {
  if (status === 'loaded') return P.success;
  if (status === 'empty') return P.dim;
  // Unknown means Helix can't read the printer — not the same as "no filament".
  return P.warn;
}

export interface PlateLike {
  id: number;
  name: string;
  objectCount: number;
  thumbnail?: string | null;
}

// Generic so the caller keeps its own ModelPlate type through onPick — the
// screen's choosePlate needs the whole plate, not a narrowed copy.
export function PlateStrip<T extends PlateLike>({
  plates,
  selectedId,
  onPick,
  disabled,
}: {
  plates: T[];
  selectedId: number | null;
  onPick: (plate: T) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.railSection}>
      <Text style={styles.sectionLabel}>{plates.length} {t('PLATES — PICK ONE')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.plateRow}>
        {plates.map((plate) => {
          const on = plate.id === selectedId;
          return (
            <Pressable
              key={plate.id}
              onPress={() => onPick(plate)}
              disabled={disabled}
              style={({ pressed }) => [
                styles.plate,
                on && { borderColor: P.accent, backgroundColor: alpha(P.accent, 0.12) },
                pressed && { opacity: 0.75 },
              ]}
            >
              {plate.thumbnail ? (
                <Image source={{ uri: plate.thumbnail }} style={styles.plateThumb} resizeMode="cover" />
              ) : (
                <View style={[styles.plateThumb, styles.plateThumbEmpty]}>
                  <MaterialCommunityIcons name="grid" size={22} color={P.dim} />
                </View>
              )}
              <Text style={[styles.plateName, on && { color: P.accent }]} numberOfLines={1}>
                {plate.name}
              </Text>
              <Text style={styles.plateMeta}>
                {plate.objectCount} {t(plate.objectCount === 1 ? 'obj' : 'objs')}
              </Text>
              {on ? (
                <View style={styles.plateCheck}>
                  <MaterialCommunityIcons name="check-circle" size={18} color={P.accent} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Pinned primary action. It states WHY it's dead rather than just greying out
 * — the old layout disabled the button and put the reason in another card,
 * which is how you tap a dead button twice before finding out.
 */
export function ActionBar({
  icon,
  label,
  enabled,
  onPress,
  bottomInset,
}: {
  icon: IconName;
  label: string;
  enabled: boolean;
  onPress: () => void;
  bottomInset: number;
}) {
  return (
    <View style={[styles.bar, { paddingBottom: 14 + bottomInset }]}>
      <Pressable
        onPress={onPress}
        disabled={!enabled}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: enabled ? P.accentFill : P.surfaceAlt },
          pressed && { opacity: 0.8 },
        ]}
      >
        {icon === 'printer-3d' ? (
          <PrinterIcon size={20} />
        ) : (
          <MaterialCommunityIcons name={icon} size={20} color={enabled ? P.onAccent : P.dim} />
        )}
        <Text style={[styles.actionText, { color: enabled ? P.onAccent : P.dim }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: P.radius,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    overflow: 'hidden',
  },
  pill: {
    position: 'absolute',
    top: 11,
    left: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: alpha('#000000', 0.58),
  },
  pillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 13,
    height: 44,
    borderTopWidth: 1,
    borderTopColor: P.border,
  },
  heroName: { flex: 1, color: P.text, fontSize: 13, fontWeight: '800' },
  heroPct: { color: P.accent, fontSize: 13, fontWeight: '800' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: P.radius - 6,
    padding: 12,
  },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  bannerAction: { color: P.accent, fontSize: 12, fontWeight: '800' },

  secondary: {
    height: 46,
    borderWidth: 1,
    borderRadius: P.radius - 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryText: { fontSize: 13, fontWeight: '800' },

  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: P.surface,
    borderColor: P.border,
    borderWidth: 1,
    borderRadius: P.radius - 6,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 14,
  },
  statValue: { fontSize: 21, fontWeight: '800', letterSpacing: -0.6 },
  statLabel: { color: P.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },

  railSection: { gap: 9 },
  sectionLabel: {
    color: P.dim,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  // Dimensions match Home's toolhead rail exactly — this is the same component
  // in the user's eyes, and two rails at different sizes read as two widgets.
  rail: { flexDirection: 'row', gap: 8 },
  toolCard: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: P.radius - 6,
    overflow: 'hidden',
    minHeight: 106,
  },
  // The light outline is load-bearing: black filament is common, and a bare
  // #000000 bar is indistinguishable from the card behind it.
  toolEdge: { width: 8, borderWidth: 1, borderColor: alpha('#FFFFFF', 0.3) },
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
  toolState: { fontSize: 11, fontWeight: '800', marginTop: 'auto' },

  plateRow: { gap: 8, paddingRight: 4 },
  plate: {
    width: 104,
    padding: 8,
    gap: 4,
    borderRadius: P.radius - 6,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
  },
  plateThumb: { width: '100%', height: 76, borderRadius: 8, backgroundColor: P.surfaceAlt },
  plateThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  plateName: { color: P.text, fontSize: 12, fontWeight: '800' },
  plateMeta: { color: P.dim, fontSize: 10, fontWeight: '600' },
  plateCheck: { position: 'absolute', top: 12, right: 12 },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: P.border,
    backgroundColor: P.bg,
  },
  action: {
    height: 56,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  actionText: { fontSize: 15, fontWeight: '800' },
});
