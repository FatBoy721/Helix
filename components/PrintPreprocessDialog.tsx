import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatDuration } from './PrintProgress';
import type { FilamentSlotDisplay } from './FilamentSlotsEditor';
import { colors, radius, spacing, withAlpha } from '../constants/theme';

export type PrintPref = 'flowCal' | 'timelapse' | 'autoLevel';

type PrinterOption = { id: string; name: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  fileName: string;
  estTimeSeconds: number;
  estGramsTotal: number;
  thumbnail: string | null;
  printers: PrinterOption[];
  activePrinterId: string;
  onSelectPrinter: (id: string) => void;
  slots: FilamentSlotDisplay[];
  perToolGrams: number[];
  prefs: Record<PrintPref, boolean>;
  onTogglePref: (pref: PrintPref) => void;
  sending: boolean;
  progress: number;
  errorMessage?: string | null;
  onSend: (prefs: Readonly<Record<PrintPref, boolean>>) => void;
};

const PREF_LABELS: { key: PrintPref; label: string }[] = [
  { key: 'flowCal', label: 'Extrusion Flow Calibration' },
  { key: 'timelapse', label: 'Time-lapse Camera' },
  { key: 'autoLevel', label: 'Auto Leveling' },
];

export default function PrintPreprocessDialog({
  visible,
  onClose,
  fileName,
  estTimeSeconds,
  estGramsTotal,
  thumbnail,
  printers,
  activePrinterId,
  onSelectPrinter,
  slots,
  perToolGrams,
  prefs,
  onTogglePref,
  sending,
  progress,
  errorMessage,
  onSend,
}: Props) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.layer}>
        <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Print Preprocessing</Text>
            <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={colors.subtext} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* Model Information */}
            <Section title="Model Information">
              <View style={styles.modelRow}>
                <View style={styles.modelThumb}>
                  {thumbnail ? (
                    <Image source={{ uri: thumbnail }} style={styles.modelThumbImg} resizeMode="contain" />
                  ) : (
                    <MaterialCommunityIcons name="cube-outline" size={30} color={colors.subtext} />
                  )}
                </View>
                <View style={styles.modelInfo}>
                  <InfoLine label="Filename" value={fileName} />
                  <InfoLine label="Estimated Time" value={formatDuration(estTimeSeconds)} />
                  <InfoLine label="Estimated Materials" value={`${estGramsTotal.toFixed(2)} g`} />
                </View>
              </View>
            </Section>

            {/* Select Printer */}
            <Section title="Select Printer">
              {printers.map((p) => {
                const active = p.id === activePrinterId;
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.printerRow, active && styles.printerRowActive]}
                    onPress={() => onSelectPrinter(p.id)}
                  >
                    <MaterialCommunityIcons name="printer-3d" size={20} color={active ? colors.primary : colors.subtext} />
                    <Text style={[styles.printerName, active && { color: colors.primary }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {active ? <MaterialCommunityIcons name="check" size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </Section>

            {/* Edit Filament — from the live loaded-filament wiring + per-tool grams */}
            <Section title="Edit Filament">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filRow}>
                {slots.map((slot) => {
                  const grams = perToolGrams[slot.index];
                  const empty = slot.status === 'empty';
                  return (
                    <View key={slot.index} style={[styles.filCard, empty && styles.filCardEmpty]}>
                      <View style={[styles.filTop, { backgroundColor: slot.color }]}>
                        <Text style={[styles.filMat, { color: readableOn(slot.color) }]} numberOfLines={1}>
                          {slot.material || 'PLA'}
                        </Text>
                        <Text style={[styles.filGrams, { color: readableOn(slot.color) }]}>
                          {typeof grams === 'number' && grams > 0 ? `${grams.toFixed(2)}g` : '—'}
                        </Text>
                      </View>
                      <View style={styles.filBadgeWrap}>
                        <View style={[styles.filBadge, { borderColor: slot.color }]}>
                          <Text style={styles.filBadgeText}>{slot.index + 1}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </Section>

            {/* Print Preferences */}
            <Section title="Print Preferences">
              {PREF_LABELS.map(({ key, label }) => {
                const on = prefs[key];
                return (
                  <Pressable key={key} style={styles.prefRow} onPress={() => onTogglePref(key)}>
                    <Text style={styles.prefLabel}>{label}</Text>
                    <View style={[styles.radio, on && { borderColor: colors.primary }]}>
                      {on ? <View style={styles.radioDot} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </Section>
          </ScrollView>

          <View style={styles.footer}>
            {errorMessage ? <Text style={styles.errText}>{errorMessage}</Text> : null}
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.progressPct}>{pct}%</Text>
            </View>
            <Pressable
              style={[styles.send, sending && styles.sendOff]}
              disabled={sending}
              onPress={() => onSend(prefs)}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <MaterialCommunityIcons name="printer-3d" size={18} color="#fff" />
              )}
              <Text style={styles.sendText}>{sending ? 'Sending…' : 'Print'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.infoLine} numberOfLines={1}>
      <Text style={styles.infoLabel}>{label}: </Text>
      {value}
    </Text>
  );
}

/** Pick black/white text for legibility over a filament colour. */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

const styles = StyleSheet.create({
  layer: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  close: { padding: 2 },
  body: { padding: spacing.md, gap: spacing.md },
  section: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  modelRow: { flexDirection: 'row', gap: spacing.md },
  modelThumb: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    backgroundColor: '#0d0f12',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  modelThumbImg: { width: '100%', height: '100%' },
  modelInfo: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 4 },
  infoLine: { color: colors.text, fontSize: 12 },
  infoLabel: { color: colors.subtext, fontWeight: '700' },
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  printerRowActive: {
    backgroundColor: withAlpha(colors.primary, 0.12),
    borderColor: withAlpha(colors.primary, 0.4),
  },
  printerName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: '700' },
  filRow: { gap: spacing.sm, paddingVertical: 2 },
  filCard: {
    width: 92,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.cardAlt,
  },
  filCardEmpty: { opacity: 0.4 },
  filTop: { paddingVertical: spacing.sm, paddingHorizontal: 8, alignItems: 'center', gap: 2 },
  filMat: { fontSize: 12, fontWeight: '800' },
  filGrams: { fontSize: 12, fontWeight: '700' },
  filBadgeWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  filBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filBadgeText: { color: colors.text, fontSize: 13, fontWeight: '900' },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  prefLabel: { color: colors.text, fontSize: 14 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  errText: { color: '#ff7676', fontSize: 12, fontWeight: '600' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.cardAlt,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  progressPct: { color: colors.subtext, fontSize: 12, fontWeight: '700', minWidth: 34, textAlign: 'right' },
  send: {
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sendOff: { opacity: 0.5 },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
