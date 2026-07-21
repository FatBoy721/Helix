import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { normalizeFilamentSlotColors } from '../constants/filamentColors';
import FilamentSlotsEditor, {
  type FilamentSlotDisplay,
} from './FilamentSlotsEditor';

type Props = {
  status: Record<string, any>;
  slotColors: string[];
  slotBrands: string[];
  slotMaterials: string[];
  onChange: (colors: string[]) => void;
  onBrandsChange: (brands: string[]) => void;
  onMaterialsChange: (materials: string[]) => void;
};

function printerText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean && clean !== 'NONE' ? clean.toUpperCase() : undefined;
}

function printerColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6,8}$/i.test(clean)) return undefined;
  return `#${clean.slice(0, 6)}`;
}

function resolveSlots(
  status: Record<string, any>,
  slotColors: string[],
  slotBrands: string[],
  slotMaterials: string[],
): FilamentSlotDisplay[] {
  const task = status.print_task_config && typeof status.print_task_config === 'object'
    ? status.print_task_config
    : {};
  const exists = Array.isArray(task.filament_exist) ? task.filament_exist : [];
  const colorsFromPrinter = Array.isArray(task.filament_color_rgba) ? task.filament_color_rgba : [];
  const vendorsFromPrinter = Array.isArray(task.filament_vendor) ? task.filament_vendor : [];
  const materialsFromPrinter = Array.isArray(task.filament_type) ? task.filament_type : [];
  const subtypesFromPrinter = Array.isArray(task.filament_sub_type) ? task.filament_sub_type : [];
  const fallbackColors = normalizeFilamentSlotColors(slotColors);

  return Array.from({ length: 4 }, (_, index) => {
    const loaded = typeof exists[index] === 'boolean' ? exists[index] : undefined;
    const color = printerColor(colorsFromPrinter[index]);
    const vendor = printerText(vendorsFromPrinter[index]);
    const materialType = printerText(materialsFromPrinter[index]);
    const subtype = printerText(subtypesFromPrinter[index]);
    const material = [materialType, subtype].filter(Boolean).join(' ') || undefined;
    return {
      index,
      color: color ?? fallbackColors[index],
      brand: vendor ?? slotBrands[index] ?? 'Generic',
      material: material ?? slotMaterials[index] ?? 'PLA',
      status: loaded === true ? 'loaded' : loaded === false ? 'empty' : 'unknown',
      source: color || material ? 'printer' : 'manual',
    };
  });
}

export default function FilamentDashboardCard({
  status,
  slotColors,
  slotBrands,
  slotMaterials,
  onChange,
  onBrandsChange,
  onMaterialsChange,
}: Props) {
  const slots = useMemo(
    () => resolveSlots(status, slotColors, slotBrands, slotMaterials),
    [status, slotColors, slotBrands, slotMaterials],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Filaments</Text>
      <FilamentSlotsEditor
        slotColors={slotColors}
        slotBrands={slotBrands}
        slotMaterials={slotMaterials}
        slots={slots}
        onChange={onChange}
        onBrandsChange={onBrandsChange}
        onMaterialsChange={onMaterialsChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
});
