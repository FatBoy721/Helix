// Cockpit filament editor — opens directly on the toolhead you tapped.
//
// Replaces the reuse of the app's FilamentSlotsEditor, which meant a pointless
// "now pick which slot" step after you'd already told us which slot.
//
import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettings } from '../../../hooks/useSettings';
import { useMoonraker } from '../../../hooks/useMoonraker';
import { useFilamentSlotWrites } from '../../../hooks/useFilamentSlotWrites';
import { resolveFilamentSlots } from '../../../services/filamentSlots';
import {
  FILAMENT_COLOR_PRESETS,
  normalizeFilamentHex,
} from '../../../constants/filamentColors';
import {
  BRAND_PRESETS,
  DEFAULT_FILAMENT_SUBTYPE,
  FILAMENT_MAIN_TYPES,
  subtypesForMainType,
} from '../../../services/filamentMaterials';
import { alpha, COCKPIT as P } from '../shared';
import { t } from '../../../services/i18n';

type PickerKind = 'material' | 'subtype' | 'brand';
type PickerAnchor = { x: number; y: number; width: number; height: number };

export default function FilamentEditor({ slot, onClose }: { slot: number; onClose: () => void }) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { status } = useMoonraker();
  const activePrinter = settings.printers.find((printer) => printer.id === settings.activePrinterId);
  const externalSpool = activePrinter?.kind === 'bambu-lan'
    && status.print_task_config?.bambu_filament_source === 'external';
  const filamentPositionLabel = externalSpool
    ? t('External Spool')
    : activePrinter?.kind === 'snapmaker-u1'
      ? t('Toolhead')
      : t('Slot');
  const [error, setError] = useState<string | null>(null);
  const { updateSlot } = useFilamentSlotWrites(
    (message) => setError(message),
  );

  const colors = settings.filamentSlotColors ?? [];
  const brands = settings.filamentSlotBrands ?? [];
  const materials = settings.filamentSlotMaterials ?? [];
  const subtypes = settings.filamentSlotSubtypes ?? [];
  // The card is printer-first, so the editor must open with the same live
  // colour/material instead of jumping back to a stale manual setting.
  const resolved = resolveFilamentSlots(status, {
    slotColors: colors,
    slotBrands: brands,
    slotMaterials: materials,
    slotSubtypes: subtypes,
  })[slot];
  const initialBrand = resolved?.brand || brands[slot] || 'Generic';

  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>({
    x: 26,
    y: 160,
    width: 320,
    height: 56,
  });
  const [colorDraft, setColorDraft] = useState(resolved?.color || colors[slot] || '#FFFFFF');
  const [hexDraft, setHexDraft] = useState('');
  const [materialDraft, setMaterialDraft] = useState(
    resolved?.mainType || materials[slot] || 'PLA'
  );
  const [subtypeDraft, setSubtypeDraft] = useState(
    resolved?.subType || subtypes[slot] || DEFAULT_FILAMENT_SUBTYPE
  );
  const [brandDraft, setBrandDraft] = useState(
    BRAND_PRESETS.includes(initialBrand) ? initialBrand : 'Other'
  );
  const [customBrandDraft, setCustomBrandDraft] = useState(
    BRAND_PRESETS.includes(initialBrand) ? '' : initialBrand
  );
  const [saving, setSaving] = useState(false);
  const [rootHeight, setRootHeight] = useState(height);
  const rootRef = useRef<View>(null);
  const materialRef = useRef<View>(null);
  const subtypeRef = useRef<View>(null);
  const brandRef = useRef<View>(null);

  // KeyboardAvoidingView is a no-op on Android with behavior undefined, and
  // `softwareKeyboardLayoutMode: resize` doesn't move an absolutely-positioned
  // overlay. Measuring the keyboard and shrinking the sheet is what the rest of
  // the app does (see FilamentSlotsEditor) and is what actually works here.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboardHeight(event.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const typing = keyboardHeight > 0;
  // Leave room for the keyboard, and drop the safe-area padding while it's up —
  // the gesture bar sits behind the keyboard, so padding for it wastes height.
  const sheetMaxHeight = Math.max(240, height - keyboardHeight - insets.top - 12);
  const swatchSize = Math.min(64, Math.floor((width - 52 - 30) / 4));

  const applyColor = (hex: string) => {
    const normalized = normalizeFilamentHex(hex);
    if (!normalized) return;
    setColorDraft(normalized);
  };

  const applyMaterial = (value: string) => {
    const next = value.toUpperCase();
    setMaterialDraft(next);
    if (!subtypesForMainType(next).includes(subtypeDraft)) {
      setSubtypeDraft(DEFAULT_FILAMENT_SUBTYPE);
    }
    setPicker(null);
  };

  const openPicker = (kind: PickerKind) => {
    Keyboard.dismiss();
    const trigger = kind === 'material' ? materialRef : kind === 'subtype' ? subtypeRef : brandRef;
    rootRef.current?.measureInWindow((rootX, rootY) => {
      trigger.current?.measureInWindow((x, y, width, triggerHeight) => {
        setPickerAnchor({ x: x - rootX, y: y - rootY, width, height: triggerHeight });
        setPicker(kind);
      });
    });
  };

  const save = async () => {
    const color = normalizeFilamentHex(colorDraft);
    const brand = brandDraft === 'Other' ? customBrandDraft.trim() : brandDraft;
    if (!color || !brand || saving) return;
    setSaving(true);
    try {
      const pushed = await updateSlot(slot, {
        color,
        brand,
        material: materialDraft,
        subtype: subtypeDraft,
      });
      if (pushed) onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('Could not save this filament.'));
    } finally {
      setSaving(false);
    }
  };

  const pickerOptions =
    picker === 'material'
      ? FILAMENT_MAIN_TYPES
      : picker === 'subtype'
        ? subtypesForMainType(materialDraft)
        : BRAND_PRESETS;
  const pickerValue =
    picker === 'material' ? materialDraft : picker === 'subtype' ? subtypeDraft : brandDraft;
  const pickerTitle = picker === 'material' ? t('Material') : picker === 'subtype' ? t('Subtype') : t('Brand');
  const belowSpace = rootHeight - pickerAnchor.y - pickerAnchor.height - 12;
  const pickerAbove = belowSpace < 220;
  const pickerMaxHeight = Math.min(
    rootHeight * 0.52,
    pickerAbove ? pickerAnchor.y - 12 : belowSpace,
  );

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View
        ref={rootRef}
        style={styles.layer}
        onLayout={(event) => setRootHeight(event.nativeEvent.layout.height)}
      >
      <View style={[styles.keyboardWrap, typing && { paddingBottom: keyboardHeight }]}>
        <View
          style={[
            styles.sheet,
            {
              maxHeight: typing ? sheetMaxHeight : height,
              paddingTop: insets.top,
            },
          ]}
        >
          <View style={styles.head}>
            <Text style={styles.title}>
              {externalSpool ? filamentPositionLabel : `${filamentPositionLabel} ${slot + 1}`}
            </Text>
            <Text style={styles.subtitle}>
              {[brandDraft === 'Other' ? customBrandDraft || t('Custom brand') : brandDraft, materialDraft]
                .filter(Boolean)
                .join(' · ')}
              {resolved.status === 'empty' ? ` · ${t('Empty')}` : ''}
            </Text>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <Text style={styles.label}>{t('Color')}</Text>
          <View style={[styles.swatchGrid, { width: swatchSize * 4 + 30 }]}>
            {FILAMENT_COLOR_PRESETS.map((preset) => {
              const hex = `#${preset}`;
              const selected = colorDraft.toUpperCase() === hex;
              return (
                <Pressable
                  key={preset}
                  onPress={() => applyColor(preset)}
                  style={[
                    styles.swatch,
                    { width: swatchSize, height: swatchSize, backgroundColor: hex },
                    selected && { borderColor: P.accent, borderWidth: 3 },
                  ]}
                >
                  {selected ? (
                    <MaterialCommunityIcons name="check-bold" size={16} color="#FFFFFF" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.hexRow}>
            <TextInput
              style={styles.hexInput}
              value={hexDraft}
              onChangeText={setHexDraft}
              autoCapitalize="characters"
              maxLength={6}
              placeholder={t('Custom hex')}
              placeholderTextColor={P.dim}
            />
            <Pressable
              style={[styles.hexApply, { backgroundColor: P.accentFill }]}
              onPress={() => {
                applyColor(hexDraft);
                setHexDraft('');
              }}
            >
              <Text style={[styles.hexApplyText, { color: P.onAccent }]}>{t('Set')}</Text>
            </Pressable>
          </View>

          <OptionRow
            triggerRef={materialRef}
            label={t('Material')}
            value={materialDraft}
            onPress={() => openPicker('material')}
          />
          <OptionRow
            triggerRef={subtypeRef}
            label={t('Subtype')}
            value={subtypeDraft}
            onPress={() => openPicker('subtype')}
          />
          <OptionRow
            triggerRef={brandRef}
            label={t('Brand')}
            value={brandDraft}
            onPress={() => openPicker('brand')}
          />

          {brandDraft === 'Other' ? (
            <TextInput
              style={styles.textInput}
              value={customBrandDraft}
              onChangeText={setCustomBrandDraft}
              placeholder={t('Custom brand')}
              placeholderTextColor={P.dim}
            />
          ) : null}

            <Text style={styles.footnote}>
              {t('Changes are written to the printer when you save.')}
            </Text>
          </ScrollView>
          <View style={[styles.focusActions, { paddingBottom: 16 + insets.bottom }]}>
            <Pressable
              style={[styles.focusAction, { backgroundColor: P.accentFill }, saving && { opacity: 0.5 }]}
              disabled={saving}
              onPress={() => void save()}
            >
              <MaterialCommunityIcons name="check" size={22} color={P.onAccent} />
              <Text style={[styles.focusPrimaryText, { color: P.onAccent }]}>{saving ? t('Saving…') : t('Save filament')}</Text>
            </Pressable>
            <Pressable style={[styles.focusAction, styles.focusCancel]} onPress={onClose}>
              <Text style={styles.focusCancelText}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {picker ? (
        <View style={styles.pickerLayer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
          <View
            pointerEvents="none"
            style={[
              styles.pickerAnchor,
              {
                left: pickerAnchor.x,
                top: pickerAnchor.y,
                width: pickerAnchor.width,
                height: pickerAnchor.height,
                borderColor: P.accent,
              },
            ]}
          >
            <Text style={styles.rowLabel}>{pickerTitle}</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{pickerValue}</Text>
            <MaterialCommunityIcons name="chevron-up" size={20} color={P.accent} />
          </View>
          <View
            style={[
              styles.pickerPopover,
              {
                left: pickerAnchor.x,
                width: pickerAnchor.width,
                maxHeight: pickerMaxHeight,
                ...(pickerAbove
                  ? { bottom: rootHeight - pickerAnchor.y }
                  : { top: pickerAnchor.y + pickerAnchor.height }),
              },
            ]}
          >
            <Text style={styles.pickerTitle}>{pickerTitle}</Text>
            <ScrollView nestedScrollEnabled>
              {pickerOptions.map((option) => {
                const selected = option === pickerValue;
                return (
                  <Pressable
                    key={option}
                    style={[styles.pickerRow, selected && { backgroundColor: alpha(P.accent, 0.12) }]}
                    onPress={() => {
                      if (picker === 'material') applyMaterial(option);
                      else if (picker === 'subtype') {
                        setSubtypeDraft(option);
                        setPicker(null);
                      } else {
                        setBrandDraft(option);
                        setPicker(null);
                      }
                    }}
                  >
                    <Text style={[styles.pickerRowText, selected && { color: P.accent }]}>
                      {option}
                    </Text>
                    {selected ? (
                      <MaterialCommunityIcons name="check" size={19} color={P.accent} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      ) : null}
        {error ? (
          <View style={styles.errorLayer}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setError(null)} />
            <View style={styles.errorCard}>
              <View style={[styles.errorIcon, { backgroundColor: alpha(P.accent, 0.14) }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={26} color={P.accent} />
              </View>
              <Text style={styles.errorTitle}>{t('Printer update unavailable')}</Text>
              <Text style={styles.errorMessage}>{error}</Text>
              <Pressable style={[styles.errorAction, { backgroundColor: P.accentFill }]} onPress={() => setError(null)}>
                <Text style={[styles.errorActionText, { color: P.onAccent }]}>{t('OK')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function OptionRow({
  triggerRef,
  label,
  value,
  onPress,
}: {
  triggerRef: React.RefObject<View | null>;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable ref={triggerRef} style={styles.row} onPress={onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
      <MaterialCommunityIcons name="chevron-down" size={20} color={P.dim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: P.bg,
  },
  keyboardWrap: { flex: 1 },
  sheet: {
    flex: 1,
    backgroundColor: P.bg,
  },

  head: {
    alignItems: 'center',
    paddingHorizontal: 26,
    paddingTop: 22,
    paddingBottom: 12,
    gap: 4,
  },
  title: { color: P.text, fontSize: 30, fontWeight: '800', letterSpacing: -1, textAlign: 'center' },
  subtitle: { color: P.dim, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  body: { paddingHorizontal: 26, paddingBottom: 24, gap: 10 },
  label: {
    color: P.dim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },

  swatchGrid: { alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    // Same reason as the toolhead edge: black filament needs an outline or it
    // disappears into the sheet.
    borderWidth: 1.5,
    borderColor: alpha('#FFFFFF', 0.28),
  },

  hexRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  hexInput: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    color: P.text,
    fontSize: 15,
    fontWeight: '700',
  },
  hexApply: {
    width: 74,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexApplyText: { fontSize: 15, fontWeight: '800' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 56,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  rowLabel: { color: P.dim, fontSize: 13, fontWeight: '700', flex: 1 },
  rowValue: { color: P.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },

  textInput: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    color: P.text,
    fontSize: 15,
    fontWeight: '700',
  },
  footnote: { color: P.dim, fontSize: 11, fontWeight: '600', marginTop: 4 },
  focusActions: { paddingHorizontal: 22, paddingTop: 8, gap: 9 },
  focusAction: {
    height: 62,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  focusCancel: { backgroundColor: P.surfaceAlt },
  focusPrimaryText: { fontSize: 16, fontWeight: '800' },
  focusCancelText: { color: P.text, fontSize: 16, fontWeight: '800' },
  pickerLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha('#000000', 0.35),
  },
  pickerAnchor: {
    position: 'absolute',
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: P.surface,
    borderWidth: 1,
  },
  pickerPopover: {
    position: 'absolute',
    zIndex: 1,
    borderRadius: 16,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    padding: 12,
    overflow: 'hidden',
  },
  pickerTitle: {
    color: P.dim,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pickerRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: P.border,
  },
  pickerRowText: { color: P.text, fontSize: 14, fontWeight: '700' },
  errorLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha('#000000', 0.74),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
  },
  errorCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    padding: 22,
    gap: 13,
    alignItems: 'center',
  },
  errorIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: { color: P.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  errorMessage: {
    color: P.dim,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    textAlign: 'center',
  },
  errorAction: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorActionText: { fontSize: 14, fontWeight: '800' },
});
