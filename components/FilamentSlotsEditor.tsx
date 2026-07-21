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
  slots?: FilamentSlotDisplay[];
  onChange: (colors: string[]) => void;
  onBrandsChange: (brands: string[]) => void;
  onMaterialsChange: (materials: string[]) => void;
};

const MATERIAL_PRESETS = ['PLA', 'PETG', 'ABS', 'TPU', 'ASA', 'PA', 'PC', 'PVA', 'SUPPORT'];
const BRAND_PRESETS = ['Generic', 'Bambu Lab', 'Hatchbox', 'eSun', 'Overture', 'SUNLU', 'Polymaker', 'Prusament', 'Snapmaker', 'Jayo', 'Other'];

export default function FilamentSlotsEditor({
  slotColors,
  slotBrands,
  slotMaterials,
  slots,
  onChange,
  onBrandsChange,
  onMaterialsChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const window = Dimensions.get('window');
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [hexDraft, setHexDraft] = useState('');
  const [brandChoice, setBrandChoice] = useState('Generic');
  const [customBrandDraft, setCustomBrandDraft] = useState('');
  const [materialOpen, setMaterialOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
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
    setMaterialOpen(false);
    setBrandOpen(false);
  };

  const applyBrand = (brand: string) => {
    if (editingSlot == null) return;
    const clean = brand.trim();
    if (!clean) return;
    const next = [...slotBrands];
    next[editingSlot] = clean;
    onBrandsChange(next);
    setCustomBrandDraft(clean);
  };

  const applyColor = (hex: string) => {
    if (editingSlot == null) return;
    const normalized = normalizeFilamentHex(hex);
    if (!normalized) return;
    const next = [...slotColors];
    next[editingSlot] = normalized;
    onChange(next);
    setEditingSlot(null);
  };

  const applyMaterial = (material: string) => {
    if (editingSlot == null) return;
    const clean = material.trim().toUpperCase();
    if (!clean) return;
    const next = [...slotMaterials];
    next[editingSlot] = clean;
    onMaterialsChange(next);
  };

  const editorSlot = editingSlot == null ? null : slots?.[editingSlot];

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
              <TouchableOpacity style={styles.dropdown} onPress={() => { setMaterialOpen(!materialOpen); setBrandOpen(false); }}>
                <Text style={styles.dropdownText}>{slotMaterials[editingSlot ?? 0] || 'PLA'}</Text>
                <Text style={styles.dropdownArrow}>{materialOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {materialOpen && (
                <View style={styles.dropdownOptions}>
                  {MATERIAL_PRESETS.map((material) => (
                    <TouchableOpacity key={material} style={styles.dropdownOption} onPress={() => { applyMaterial(material); setMaterialOpen(false); }}>
                      <Text style={styles.dropdownOptionText}>{material}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.hexLabel}>Brand</Text>
              <TouchableOpacity style={styles.dropdown} onPress={() => { setBrandOpen(!brandOpen); setMaterialOpen(false); }}>
                <Text style={styles.dropdownText}>{brandChoice}</Text>
                <Text style={styles.dropdownArrow}>{brandOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {brandOpen && (
                <View style={styles.dropdownOptions}>
                  {BRAND_PRESETS.map((brand) => (
                    <TouchableOpacity key={brand} style={styles.dropdownOption} onPress={() => { setBrandChoice(brand); setBrandOpen(false); if (brand !== 'Other') applyBrand(brand); }}>
                      <Text style={styles.dropdownOptionText}>{brand}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
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
  materialGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  materialPill: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  materialPillSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.cardAlt,
  },
  materialPillText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '800',
  },
  materialPillTextSelected: {
    color: colors.text,
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
  dropdownOptions: {
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
  },
  dropdownOption: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownOptionText: {
    color: colors.text,
    fontSize: 14,
  },
  brandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
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
});
