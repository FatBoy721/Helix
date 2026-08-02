import React, { useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import {
  FILAMENT_COLOR_PRESETS,
  normalizeFilamentHex,
} from '../constants/filamentColors';
import {
  BRAND_PRESETS,
  DEFAULT_FILAMENT_SUBTYPE,
  FILAMENT_MAIN_TYPES,
  subtypesForMainType,
} from '../services/filamentMaterials';
import { t } from '../services/i18n';

export type FilamentSlotStatus = 'loaded' | 'empty' | 'busy' | 'unknown';

export type FilamentSlotDisplay = {
  index: number;
  color: string;
  brand?: string;
  material: string;
  mainType?: string;
  subType?: string;
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

type PickerKind = 'material' | 'subtype' | 'brand';
type PickerAnchor = { x: number; y: number; width: number; height: number };

type OptionPickerProps = {
  visible: boolean;
  title: string;
  options: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  maxHeight: number;
  anchor: PickerAnchor;
};

function OptionPicker({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  maxHeight,
  anchor,
}: OptionPickerProps) {
  const window = useWindowDimensions();
  const belowSpace = window.height - anchor.y - anchor.height - 12;
  const opensAbove = belowSpace < 220;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.pickerBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View
          pointerEvents="none"
          style={[
            styles.pickerAnchor,
            { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height },
          ]}
        >
          <Text style={styles.dropdownText} numberOfLines={1}>{selected}</Text>
          <Text style={[styles.dropdownArrow, { color: colors.primary }]}>▲</Text>
        </View>
        <View
          style={[
            styles.pickerSheet,
            {
              left: anchor.x,
              width: anchor.width,
              maxHeight,
              ...(opensAbove
                ? { bottom: window.height - anchor.y }
                : { top: anchor.y + anchor.height }),
            },
          ]}
        >
          <Text style={styles.pickerTitle}>{title}</Text>
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
        </View>
      </View>
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
  const window = useWindowDimensions();
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [hexDraft, setHexDraft] = useState('');
  const [brandChoice, setBrandChoice] = useState('Generic');
  const [customBrandDraft, setCustomBrandDraft] = useState('');
  const [materialDraft, setMaterialDraft] = useState('PLA');
  const [subtypeDraft, setSubtypeDraft] = useState(DEFAULT_FILAMENT_SUBTYPE);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>({
    x: spacing.lg,
    y: 120,
    width: 320,
    height: 48,
  });
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const materialRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const subtypeRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const brandRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);

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
    setMaterialDraft(slotMaterials[index] || 'PLA');
    setSubtypeDraft(slotSubtypes[index] || DEFAULT_FILAMENT_SUBTYPE);
    setPicker(null);
  };

  const openPicker = (kind: PickerKind) => {
    Keyboard.dismiss();
    const ref = kind === 'material' ? materialRef : kind === 'subtype' ? subtypeRef : brandRef;
    ref.current?.measureInWindow((x, y, width, height) => {
      setPickerAnchor({ x, y, width, height });
      setPicker(kind);
    });
  };

  const applyColor = (hex: string) => {
    const normalized = normalizeFilamentHex(hex);
    if (!normalized) return;
    setHexDraft(normalized.replace('#', ''));
  };

  const applyMaterial = (material: string) => {
    const clean = material.trim().toUpperCase();
    if (!clean) return;
    setMaterialDraft(clean);
    if (!subtypesForMainType(clean).includes(subtypeDraft)) {
      setSubtypeDraft(DEFAULT_FILAMENT_SUBTYPE);
    }
  };

  const applySubtype = (subtype: string) => {
    const clean = subtype.trim();
    if (!clean) return;
    setSubtypeDraft(clean);
  };

  const saveEditor = () => {
    if (editingSlot == null) return;
    const normalized = normalizeFilamentHex(hexDraft);
    if (!normalized) return;
    const brand = brandChoice === 'Other' ? customBrandDraft.trim() : brandChoice;
    if (!brand) return;

    const nextColors = [...slotColors];
    const nextBrands = [...slotBrands];
    const nextMaterials = [...slotMaterials];
    const nextSubtypes = [...slotSubtypes];
    nextColors[editingSlot] = normalized;
    nextBrands[editingSlot] = brand;
    nextMaterials[editingSlot] = materialDraft;
    nextSubtypes[editingSlot] = subtypeDraft;
    onChange(nextColors, editingSlot);
    onBrandsChange(nextBrands, editingSlot);
    onMaterialsChange(nextMaterials, editingSlot);
    onSubtypesChange(nextSubtypes, editingSlot);
    setEditingSlot(null);
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
              <Text style={[styles.statusText, dimmed && styles.dimText]}>{t(status)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Modal
        visible={editingSlot != null}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setEditingSlot(null)}
      >
        <View
          style={[styles.backdrop, keyboardHeight > 0 && styles.backdropKeyboard]}
        >
          <View
            style={[styles.sheet, {
              flex: 1,
              maxHeight: Math.max(180, window.height - keyboardHeight),
              paddingTop: insets.top,
            }]}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t('Filament')} T{editingSlot ?? 0}</Text>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={styles.sheetContent}
            >
              <Text style={styles.sheetHint}>
                {editorSlot?.source === 'printer'
                  ? t('Printer values are shown when loaded; manual values stay as fallback.')
                  : t('Choose the filament details for this slot.')}
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
              <Text style={styles.hexLabel}>{t('Material')}</Text>
              <TouchableOpacity ref={materialRef} style={styles.dropdown} onPress={() => openPicker('material')}>
                <Text style={styles.dropdownText}>{materialDraft}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
              <Text style={styles.hexLabel}>{t('Subtype')}</Text>
              <TouchableOpacity ref={subtypeRef} style={styles.dropdown} onPress={() => openPicker('subtype')}>
                <Text style={styles.dropdownText}>{subtypeDraft}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
              <Text style={styles.hexLabel}>{t('Brand')}</Text>
              <TouchableOpacity ref={brandRef} style={styles.dropdown} onPress={() => openPicker('brand')}>
                <Text style={styles.dropdownText}>{brandChoice}</Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
              {brandChoice === 'Other' && (
                <TextInput
                  style={styles.hexInput}
                  value={customBrandDraft}
                  onChangeText={setCustomBrandDraft}
                  placeholder={t('Custom brand')}
                  placeholderTextColor={colors.subtext}
                />
              )}
              <Text style={styles.hexLabel}>{t('Custom hex')}</Text>
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
                  <Text style={styles.applyText}>{t('Set')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
            <View style={[styles.focusActions, { paddingBottom: 16 + insets.bottom }]}>
              <TouchableOpacity style={[styles.focusAction, styles.focusPrimary]} onPress={saveEditor}>
                <Text style={styles.focusPrimaryText}>{t('Save filament')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.focusAction, styles.focusCancel]}
                onPress={() => setEditingSlot(null)}
              >
                <Text style={styles.focusCancelText}>{t('Cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <OptionPicker
        visible={picker === 'material'}
        title={t('Material')}
        options={FILAMENT_MAIN_TYPES}
        selected={materialDraft}
        onSelect={(value) => { applyMaterial(value); setPicker(null); }}
        onClose={() => setPicker(null)}
        maxHeight={pickerMaxHeight}
        anchor={pickerAnchor}
      />
      <OptionPicker
        visible={picker === 'subtype'}
        title={t('Subtype')}
        options={subtypesForMainType(materialDraft)}
        selected={subtypeDraft}
        onSelect={(value) => { applySubtype(value); setPicker(null); }}
        onClose={() => setPicker(null)}
        maxHeight={pickerMaxHeight}
        anchor={pickerAnchor}
      />
      <OptionPicker
        visible={picker === 'brand'}
        title={t('Brand')}
        options={BRAND_PRESETS}
        selected={brandChoice}
        onSelect={(brand) => {
          setBrandChoice(brand);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
        maxHeight={pickerMaxHeight}
        anchor={pickerAnchor}
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
    backgroundColor: colors.bg,
    justifyContent: 'flex-start',
  },
  backdropKeyboard: {
    justifyContent: 'flex-start',
  },
  sheet: {
    backgroundColor: colors.bg,
  },
  sheetHeader: {
    alignItems: 'center',
    paddingHorizontal: 26,
    paddingTop: 22,
    paddingBottom: 12,
  },
  sheetContent: {
    paddingHorizontal: 26,
    paddingBottom: 24,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -1,
    textAlign: 'center',
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
  focusActions: {
    paddingHorizontal: 22,
    paddingTop: 8,
    gap: 9,
  },
  focusAction: {
    height: 62,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusPrimary: { backgroundColor: colors.primary },
  focusCancel: { backgroundColor: colors.cardAlt },
  focusPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  focusCancelText: { color: colors.text, fontSize: 16, fontWeight: '800' },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pickerAnchor: {
    position: 'absolute',
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
  },
  pickerSheet: {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    overflow: 'hidden',
  },
  pickerTitle: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pickerScroll: { flexGrow: 0 },
  pickerOption: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
