import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FILAMENT_COLOR_PRESETS, normalizeFilamentHex } from '../constants/filamentColors';
import { colors, spacing } from '../constants/theme';
import ThemedDialog from './ThemedDialog';

export interface AceSlotDraft {
  ace: number;
  slot: number;
  color: string;
  material: string;
  brand: string;
  subtype: string;
}

interface Props {
  visible: boolean;
  draft: AceSlotDraft | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (draft: AceSlotDraft) => void;
}

const MATERIALS = ['PLA', 'PETG', 'ABS', 'TPU', 'ASA', 'PA', 'PC', 'PVA', 'SUPPORT'];

export default function AceSlotEditor({ visible, draft, saving, onClose, onSave }: Props) {
  const [value, setValue] = useState<AceSlotDraft | null>(draft);
  const subtypeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) setValue(draft);
  }, [draft, visible]);

  if (!value) return null;

  const selectedColor = normalizeFilamentHex(value.color) ?? '#161616';
  const save = () => onSave({ ...value, color: selectedColor });

  return (
    <ThemedDialog
      visible={visible}
      title={`ACE ${value.ace + 1} - Slot ${value.slot + 1}`}
      message="Filament details are saved to MultiACE and shown across Helix."
      icon="palette-outline"
      placement="center"
      onClose={onClose}
      actions={[
        { text: 'Cancel', onPress: onClose, disabled: saving },
        { text: saving ? 'Saving...' : 'Save', variant: 'primary', onPress: save, disabled: saving },
      ]}
    >
      <Text style={styles.label}>Color</Text>
      <View style={styles.colorRow}>
        <View style={[styles.colorPreview, { backgroundColor: selectedColor }]} />
        <TextInput
          style={styles.colorInput}
          value={value.color}
          onChangeText={(color) => setValue({ ...value, color })}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          placeholder="#RRGGBB"
          placeholderTextColor={colors.subtext}
        />
      </View>
      <View style={styles.swatches}>
        {FILAMENT_COLOR_PRESETS.map((hex) => {
          const color = `#${hex}`;
          const selected = selectedColor === color;
          return (
            <TouchableOpacity
              key={hex}
              accessibilityLabel={`Set color ${color}`}
              style={[styles.swatch, { backgroundColor: color }, selected && styles.selectedSwatch]}
              onPress={() => setValue({ ...value, color })}
            >
              {selected ? <MaterialCommunityIcons name="check" size={14} color="#fff" /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Material</Text>
      <View style={styles.materials}>
        {MATERIALS.map((material) => {
          const selected = value.material.toUpperCase() === material;
          return (
            <TouchableOpacity
              key={material}
              style={[styles.materialChip, selected && styles.materialChipSelected]}
              onPress={() => setValue({ ...value, material })}
            >
              <Text style={[styles.materialChipText, selected && styles.materialChipTextSelected]}>
                {material}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        value={value.material}
        onChangeText={(material) => setValue({ ...value, material })}
        autoCapitalize="characters"
        placeholder="Material"
        placeholderTextColor={colors.subtext}
      />

      <View style={styles.fieldRow}>
        <View style={styles.field}>
          <Text style={styles.label}>Brand</Text>
          <TextInput
            style={styles.input}
            value={value.brand}
            onChangeText={(brand) => setValue({ ...value, brand })}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => subtypeInputRef.current?.focus()}
            placeholder="Generic"
            placeholderTextColor={colors.subtext}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Subtype</Text>
          <TextInput
            ref={subtypeInputRef}
            style={styles.input}
            value={value.subtype}
            onChangeText={(subtype) => setValue({ ...value, subtype })}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={save}
            placeholder="Basic"
            placeholderTextColor={colors.subtext}
          />
        </View>
      </View>
    </ThemedDialog>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  colorPreview: {
    width: 36,
    height: 36,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorInput: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 7,
    color: colors.text,
    fontSize: 13,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: spacing.sm,
  },
  swatch: {
    width: 25,
    height: 25,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedSwatch: {
    borderColor: colors.text,
    borderWidth: 2,
  },
  materials: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  materialChip: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  materialChipSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}22`,
  },
  materialChipText: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '700',
  },
  materialChipTextSelected: {
    color: colors.text,
  },
  input: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 7,
    color: colors.text,
    fontSize: 13,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  field: {
    flex: 1,
  },
});
