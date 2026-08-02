// Settings presentation — the Nova direction, wired to real settings state.
//
// Index of categories, one detail screen at a time, and an attention panel for
// the thing an index can otherwise hide: settings you changed that never took
// effect. Kept out of app/(tabs)/settings.tsx because that file is already
// ~1400 lines of draft/save machinery.
//
// The wording is deliberate. Three save semantics live on this screen —
// setLive() applies instantly, set() drafts until Save & Apply, update() writes
// immediately — and the old UI distinguished none of them. A drafted row says
// "Changed but not applied", and the button says "now", because the verb has to
// carry that the change isn't live yet.
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { alpha, COCKPIT as P, Dot, type IconName } from '../dashboard/shared';
import PrinterIcon from '../PrinterIcon';

/** How a setting commits — shown on the detail screen it belongs to. */
export type Commit = 'live' | 'draft' | 'instant' | 'printer';

export const COMMIT_LABEL: Record<Commit, string> = {
  live: 'Applies instantly',
  draft: 'Needs Save & Apply',
  instant: 'Saved immediately',
  printer: 'Writes to the printer',
};

export function commitColor(commit: Commit): string {
  if (commit === 'draft') return P.warn;
  if (commit === 'printer') return P.accent;
  if (commit === 'live') return P.success;
  return P.dim;
}

export function ScreenTitle({ title, online }: { title: string; online: boolean }) {
  return (
    <View style={styles.head}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.headState}>
        <Dot color={online ? P.success : P.danger} size={7} />
        <Text style={styles.headStateText}>{online ? 'Connected' : 'Offline'}</Text>
      </View>
    </View>
  );
}

export function IndexRow({
  icon,
  title,
  summary,
  dirty,
  warn,
  first,
  onPress,
}: {
  icon: IconName;
  title: string;
  summary: string;
  dirty?: boolean;
  warn?: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowDivided,
        pressed && { backgroundColor: alpha(P.accent, 0.07) },
      ]}
    >
      {icon === 'printer-3d' ? (
        <PrinterIcon size={23} />
      ) : (
        <MaterialCommunityIcons name={icon} size={23} color={P.accent} />
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text
          style={[styles.rowSummary, (dirty || warn) && { color: P.warn }]}
          numberOfLines={1}
        >
          {/* A drafted category says so rather than reporting a state that
              isn't in effect yet. */}
          {dirty ? 'Changed but not applied' : summary}
        </Text>
      </View>
      {dirty ? <View style={styles.dirtyDot} /> : null}
      <MaterialCommunityIcons name="chevron-right" size={21} color={P.dim} />
    </Pressable>
  );
}

export function AttentionPanel({
  items,
  onOpen,
  onSave,
  onDiscard,
}: {
  items: { key: string; title: string; icon: IconName }[];
  onOpen: (key: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <View style={styles.attention}>
      <Text style={styles.attentionLabel}>NEEDS ATTENTION</Text>

      <View style={styles.attentionCard}>
        {items.map((item, i) => (
          <Pressable
            key={item.key}
            onPress={() => onOpen(item.key)}
            style={({ pressed }) => [
              styles.attentionRow,
              i > 0 && styles.attentionDivided,
              pressed && { opacity: 0.7 },
            ]}
          >
            <MaterialCommunityIcons name={item.icon} size={19} color={P.warn} />
            <View style={styles.attentionText}>
              <Text style={styles.attentionTitle}>{item.title}</Text>
              <Text style={styles.attentionSub}>Changed but not applied</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={P.dim} />
          </Pressable>
        ))}

        <View style={styles.attentionFoot}>
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.applyNow, pressed && { opacity: 0.8 }]}
          >
            <MaterialCommunityIcons name="check" size={18} color={P.onAccent} />
            <Text style={styles.applyNowText}>Save &amp; Apply now</Text>
          </Pressable>
          <Pressable
            onPress={onDiscard}
            style={({ pressed }) => [styles.discard, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.discardText}>Discard</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function SectionHeader({
  title,
  commit,
  onBack,
}: {
  title: string;
  commit: Commit;
  onBack: () => void;
}) {
  return (
    <View style={styles.sectionHead}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
        <MaterialCommunityIcons name="chevron-left" size={24} color={P.accent} />
        <Text style={styles.backText}>Settings</Text>
      </Pressable>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={[styles.sectionCommit, { color: commitColor(commit) }]}>
        {COMMIT_LABEL[commit]}
      </Text>
    </View>
  );
}

export function Card({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <View style={styles.cardWrap}>
      {label ? <Text style={styles.cardLabel}>{label.toUpperCase()}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.control}>
      <Text style={styles.controlLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: P.surfaceAlt, true: alpha(P.accent, 0.5) }}
        thumbColor={value ? P.accent : P.dim}
      />
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoCapitalize = 'none',
  trailing,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.controlBlock}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          style={styles.field}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={P.dim}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          keyboardType={keyboardType}
        />
        {trailing}
      </View>
    </View>
  );
}

export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.controlBlock}>
      {label ? <Text style={styles.controlLabel}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: on ? alpha(P.accent, 0.16) : P.surfaceAlt,
                  borderColor: on ? P.accent : P.border,
                },
                pressed && { opacity: 0.75 },
              ]}
            >
              {option.icon ? (
                <MaterialCommunityIcons
                  name={option.icon}
                  size={15}
                  color={on ? P.accent : P.dim}
                />
              ) : null}
              <Text style={[styles.chipText, { color: on ? P.accent : P.dim }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.control}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - 1))}
          style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable
          onPress={() => onChange(Math.min(max, value + 1))}
          style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Action({
  label,
  icon,
  onPress,
  tone = 'ghost',
  disabled,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  tone?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  const fg = tone === 'primary' ? P.onAccent : tone === 'danger' ? P.danger : P.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        tone === 'primary'
          ? { backgroundColor: P.accentFill, borderColor: P.accentFill }
          : { borderColor: tone === 'danger' ? alpha(P.danger, 0.45) : alpha(P.accent, 0.45) },
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={17} color={fg} /> : null}
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

export function ValueRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.control}>
      <Text style={styles.controlLabel}>{label}</Text>
      <Text style={[styles.valueText, tone ? { color: tone } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, color: P.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8 },
  headState: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headStateText: { color: P.dim, fontSize: 12, fontWeight: '700' },

  cardWrap: { gap: 8 },
  cardLabel: { color: P.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  card: {
    borderRadius: P.radius,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    paddingHorizontal: 15,
    paddingVertical: 4,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 16, height: 76 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { color: P.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  rowSummary: { color: P.dim, fontSize: 12, fontWeight: '600' },
  dirtyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: P.warn },

  attention: { gap: 8 },
  attentionLabel: { color: P.warn, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  attentionCard: {
    borderRadius: P.radius,
    borderWidth: 1,
    borderColor: alpha(P.warn, 0.42),
    backgroundColor: alpha(P.warn, 0.08),
    overflow: 'hidden',
  },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 14,
    height: 62,
  },
  attentionDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: alpha(P.warn, 0.3) },
  attentionText: { flex: 1, gap: 2 },
  attentionTitle: { color: P.text, fontSize: 14, fontWeight: '800' },
  attentionSub: { color: P.warn, fontSize: 12, fontWeight: '700' },
  attentionFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: alpha(P.warn, 0.3),
  },
  applyNow: {
    flex: 1,
    height: 46,
    borderRadius: 999,
    backgroundColor: P.accentFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  applyNowText: { color: P.onAccent, fontSize: 14, fontWeight: '800' },
  discard: {
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: alpha(P.warn, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardText: { color: P.dim, fontSize: 13, fontWeight: '800' },

  sectionHead: { gap: 5 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -8 },
  backText: { color: P.accent, fontSize: 15, fontWeight: '800' },
  sectionTitle: { color: P.text, fontSize: 27, fontWeight: '800', letterSpacing: -0.7 },
  sectionCommit: { fontSize: 12, fontWeight: '800' },

  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
  },
  controlBlock: { gap: 8, paddingVertical: 11 },
  controlLabel: { flex: 1, color: P.text, fontSize: 14, fontWeight: '700' },
  valueText: { color: P.dim, fontSize: 13, fontWeight: '700', maxWidth: '58%', textAlign: 'right' },

  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  field: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surfaceAlt,
    paddingHorizontal: 13,
    color: P.text,
    fontSize: 14,
    fontWeight: '600',
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '800' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: P.text, fontSize: 20, fontWeight: '800' },
  stepValue: { color: P.text, fontSize: 17, fontWeight: '800', minWidth: 22, textAlign: 'center' },

  action: {
    height: 48,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 9,
  },
  actionText: { fontSize: 13, fontWeight: '800' },

  note: { color: P.dim, fontSize: 11, fontWeight: '600', lineHeight: 16, paddingBottom: 11 },
});
