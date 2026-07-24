import React, { useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import {
  FILAMENT_COLOR_PRESETS,
  normalizeFilamentHex,
} from '../constants/filamentColors';
import {
  DEFAULT_FILAMENT_SUBTYPE,
  FILAMENT_MAIN_TYPES,
  subtypesForMainType,
} from '../services/filamentMaterials';

export type FilamentSlotStatus = 'loaded' | 'empty' | 'busy' | 'unknown';

export type FilamentSlotDisplay = {
  index: number;
  color: string;
  brand?: string;
  material: string;
  status: FilamentSlotStatus;
  source?: 'printer' | 'manual';
};

type Props = {
  slotColors: string[];
  slotBrands: string[];
  slotMaterials: string[];
  slotSubtypes: string[];
  slots?: FilamentSlotDisplay[];
  onChange: (colors: string[], changedIndex?: number) => void;
  onBrandsChange: (brands: string[], changedIndex?: number) => void;
  onMaterialsChange: (materials: string[], changedIndex?: number) => void;
  onSubtypesChange: (subtypes: string[], changedIndex?: number) => void;
};

const BRAND_PRESETS = ['Generic', 'Bambu Lab', 'Hatchbox', 'eSun', 'Overture', 'SUNLU', 'Polymaker', 'Prusament', 'Snapmaker', 'Jayo', 'Other'];

type PickerKind = 'material' | 'subtype' | 'brand';

type OptionPickerProps = {
  visible: boolean;
  title: string;
  options: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  bottomInset: number;
  maxHeight: number;
};

function OptionPicker({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  bottomInset,
  maxHeight,
}: OptionPickerProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.pickerBackdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.pickerSheet, { maxHeight, paddingBottom: bottomInset + spacing.sm }]}
          onPress={() => {}}
        >
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>{title}</Text>
            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={onClose}>
              <Text style={styles.pickerDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.pickerGrabber} />
          <ScrollView
            style={styles.pickerScroll}
            keyboardShouldPersistTaps="handled"
          >
            {options.map((option) => {
              const active = option === selected;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.pickerOption, active && styles.pickerOptionActive]}
                  onPress={() => onSelect(option)}
                >
                  <Text style={[styles.pickerOptionText, active && styles.pickerOptionTextActive]}>
                    {option}
                  </Text>
                  {active ? (
                    <Text style={styles.pickerCheck}>✓</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function FilamentSlotsEditor({
  slotColors,
  slotBrands,
  slotMaterials,
  slotSubtypes,
  slots,
  onChange,
  onBrandsChange,
  onMaterialsChange,
  onSubtypesChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const window = Dimensions.get('window');
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [hexDraft, setHexDraft] = useState('');
  const [brandChoice, setBrandChoice] = useState('Generic');
  const [customBrandDraft, setCustomBrandDraft] = useState('');
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  React.useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const openEditor = (index: number) => {
    setEditingSlot(index);
    setHexDraft(slotColors[index]?.replace('#', '') ?? '');
    const brand = slotBrands[index] ?? 'Generic';
    setBrandChoice(BRAND_PRESETS.includes(brand) ? brand : 'Other');
    setCustomBrandDraft(BRAND_PRESETS.includes(brand) ? '' : brand);
    setPicker(null);
  };

  const openPicker = (kind: PickerKind) => {
    Keyboard.dismiss();
    setPicker(kind);
  };

  const applyBrand = (brand: string) => {
    if (editingSlot == null) return;
    const clean = brand.trim();
    if (!clean) return;
    const next = [...slotBrands];
    next[editingSlot] = clean;
    onBrandsChange(next, editingSlot);
    setCustomBrandDraft(clean);
  };

  const applyColor = (hex: string) => {
    if (editingSlot == null) return;
    const normalized = normalizeFilamentHex(hex);
    if (!normalized) return;
    const next = [...slotColors];
    next[editingSlot] = normalized;
    onChange(next, editingSlot);
    setEditingSlot(null);
  };

  const applyMaterial = (material: string) => {
    if (editingSlot == null) return;
    const clean = material.trim().toUpperCase();
    if (!clean) return;
    const nextMaterials = [...slotMaterials];
    nextMaterials[editingSlot] = clean;
    onMaterialsChange(nextMaterials, editingSlot);

    const currentSubtype = slotSubtypes[editingSlot] || DEFAULT_FILAMENT_SUBTYPE;
    if (!subtypesForMainType(clean).includes(currentSubtype)) {
      const nextSubtypes = [...slotSubtypes];
      nextSubtypes[editingSlot] = DEFAULT_FILAMENT_SUBTYPE;
      onSubtypesChange(nextSubtypes, editingSlot);
    }
  };

  const applySubtype = (subtype: string) => {
    if (editingSlot == null) return;
    const clean = subtype.trim();
    if (!clean) return;
    const next = [...slotSubtypes];
    next[editingSlot] = clean;
    onSubtypesChange(next, editingSlot);
  };

  const editorSlot = editingSlot == null ? null : slots?.[editingSlot];
  const pickerMaxHeight = Math.round(window.height * 0.55);

  return (
    <>
      <View style={styles.row}>
        {Array.from({ length: 4 }, (_, index) => {
          const slot = slots?.[index];
          const status = slot?.status ?? 'unknown';
          const dimmed = status === 'empty';
          const busy = status === 'busy';
          const hex = slot?.color ?? slotColors[index];
          const brand = slot?.brand || slotBrands[index] || 'Generic';
          const material = slot?.material || slotMaterials[index] || 'PLA';

          return (
            <TouchableOpacity
              key={index}
              style={[styles.slot, dimmed && styles.slotDimmed, busy && styles.slotBusy]}
              onPress={() => openEditor(index)}
              activeOpacity={0.85}
            >
              <View style={[styles.swatch, { backgroundColor: hex }, dimmed && styles.swatchDimmed]} />
              <Text style={styles.slotLabel}>T{index}</Text>
              <Text style={[styles.materialText, dimmed && styles.dimText]} numberOfLines={1}>
                {[brand, material].filter(Boolean).join(' ')}
              </Text>
              <Text style={[styles.statusText, dimmed && styles.dimText]}>{status}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Modal visible={editingSlot != null} transparent animationType="fade">
        <TouchableOpacity
          style={[styles.backdrop, keyboardHeight > 0 && styles.backdropKeyboard]}
          activeOpacity={1}
          onPress={() => setEditingSlot(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.sheet, {
              maxHeight: Math.max(180, window.height - keyboardHeight - insets.top - insets.bottom - spacing.lg * 2),
              marginTop: keyboardHeight > 0 ? insets.top + spacing.sm : 0,
              paddingBottom: insets.bottom + spacing.md,
            }]}
            onPress={() => {}}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={styles.sheetContent}
            >
              <Text style={styles.sheetTitle}>Filament T{editingSlot ?? 0}</Text>
              <Text style={styles.sheetHint}>
                {editorSlot?.source === 'printer'
                  ? 'Printer values are shown when loaded; manual values stay as fallback.'
                  : 'Choose the filament details for this slot.'}
              </Text>
              <View style={styles.presetGrid}>
                {FILAMENT_COLOR_PRESETS.map((preset) => (
                  <TouchableOpacity
                    key={preset}
                    style={[
                      styles.preset,
                      { backgroundColor: `#${preset}` },
                      hexDraft.toUpperCase() === preset && styles.presetSelected,
                    ]}
                    onPress={() => applyColor(preset)}
                  />
                ))}
              </View>
              <Text style={styles.hexLabel}>Material</Text>
              <TouchableOpacity style={styles.dropdown} onPress={() => openPicker('material')}>
                <Text style={styles.dropdownText}>{slotMaterials[editingSlot ?? 0] || 'PLA'}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
              <Text style={styles.hexLabel}>Subtype</Text>
              <TouchableOpacity style={styles.dropdown} onPress={() => openPicker('subtype')}>
                <Text style={styles.dropdownText}>{slotSubtypes[editingSlot ?? 0] || DEFAULT_FILAMENT_SUBTYPE}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
              <Text style={styles.hexLabel}>Brand</Text>
              <TouchableOpacity style={styles.dropdown} onPress={() => openPicker('brand')}>
                <Text style={styles.dropdownText}>{brandChoice}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
              {brandChoice === 'Other' && (
                <TextInput
                  style={styles.hexInput}
                  value={customBrandDraft}
                  onChangeText={(brand) => { setCustomBrandDraft(brand); applyBrand(brand); }}
                  placeholder="Custom brand"
                  placeholderTextColor={colors.subtext}
                />
              )}
              <Text style={styles.hexLabel}>Custom hex</Text>
              <View style={styles.hexRow}>
                <TextInput
                  style={styles.hexInput}
                  value={hexDraft}
                  onChangeText={setHexDraft}
                  autoCapitalize="characters"
                  maxLength={6}
                  placeholder="2196F3"
                  placeholderTextColor={colors.subtext}
                />
                <TouchableOpacity
                  style={styles.applyBtn}
                  onPress={() => applyColor(hexDraft)}
                >
                  <Text style={styles.applyText}>Set</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <OptionPicker
        visible={picker === 'material'}
        title="Material"
        options={FILAMENT_MAIN_TYPES}
        selected={slotMaterials[editingSlot ?? 0] || 'PLA'}
        onSelect={(value) => { applyMaterial(value); setPicker(null); }}
        onClose={() => setPicker(null)}
        bottomInset={insets.bottom}
        maxHeight={pickerMaxHeight}
      />
      <OptionPicker
        visible={picker === 'subtype'}
        title="Subtype"
        options={subtypesForMainType(slotMaterials[editingSlot ?? 0] || 'PLA')}
        selected={slotSubtypes[editingSlot ?? 0] || DEFAULT_FILAMENT_SUBTYPE}
        onSelect={(value) => { applySubtype(value); setPicker(null); }}
        onClose={() => setPicker(null)}
        bottomInset={insets.bottom}
        maxHeight={pickerMaxHeight}
      />
      <OptionPicker
        visible={picker === 'brand'}
        title="Brand"
        options={BRAND_PRESETS}
        selected={brandChoice}
        onSelect={(brand) => {
          setBrandChoice(brand);
          setPicker(null);
          if (brand !== 'Other') applyBrand(brand);
        }}
        onClose={() => setPicker(null)}
        bottomInset={insets.bottom}
        maxHeight={pickerMaxHeight}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  slot: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    minWidth: 0,
  },
  slotDimmed: {
    opacity: 0.48,
    backgroundColor: '#171a1f',
  },
  slotBusy: {
    borderColor: colors.warning,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },
  swatchDimmed: {
    backgroundColor: '#30343a',
  },
  slotLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  materialText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    maxWidth: '100%',
  },
  statusText: {
    color: colors.subtext,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  dimText: {
    color: colors.subtext,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdropKeyboard: {
    justifyContent: 'flex-start',
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  sheetContent: {
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sheetHint: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  preset: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetSelected: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  dropdown: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
  },
  dropdownText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownArrow: {
    color: colors.subtext,
    fontSize: 12,
  },
  hexLabel: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  hexRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  hexInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  applyText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    paddingTop: spacing.sm,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pickerTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  pickerDone: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  pickerGrabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  pickerScroll: {
    paddingHorizontal: spacing.sm,
  },
  pickerOption: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerOptionActive: {
    backgroundColor: colors.cardAlt,
  },
  pickerOptionText: {
    color: colors.subtext,
    fontSize: 14,
    fontWeight: '600',
  },
  pickerOptionTextActive: {
    color: colors.text,
    fontWeight: '800',
  },
  pickerCheck: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
});
