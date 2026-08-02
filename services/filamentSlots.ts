// Resolution of the four filament slots.
//
// Extracted from components/FilamentDashboardCard.tsx so the dashboard model
// can share it instead of growing a second, drifting copy.
//
// This is NOT RFID. The user picks brand / main type / sub type / colour in
// FilamentSlotsEditor; the app writes those to the printer (see the two-step
// write in services/moonraker.ts), and the printer reports them back under
// `print_task_config`. Printer-reported values win when present because they
// reflect what the machine actually believes is loaded; the saved settings are
// the fallback for slots the printer has nothing to say about.
import { normalizeFilamentSlotColors } from '../constants/filamentColors';

export type FilamentSlotStatus = 'loaded' | 'empty' | 'busy' | 'unknown';

export interface ResolvedFilamentSlot {
  index: number;
  color: string;
  brand?: string;
  /** Main type and sub type joined, e.g. "PLA MATTE". */
  material: string;
  /** Main type alone, e.g. "PLA" — the joined string is too wide for a
   *  quarter-width toolhead card once a real subtype is set. */
  mainType: string;
  /** Sub type alone, e.g. "MATTE". Empty when the slot has none. */
  subType: string;
  status: FilamentSlotStatus;
  source?: 'printer' | 'manual';
}

export interface ManualSlotSettings {
  slotColors: string[];
  slotBrands: string[];
  slotMaterials: string[];
  slotSubtypes: string[];
}

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

export function resolveFilamentSlots(
  status: Record<string, any>,
  manual: ManualSlotSettings
): ResolvedFilamentSlot[] {
  const task =
    status.print_task_config && typeof status.print_task_config === 'object'
      ? status.print_task_config
      : {};
  const exists = Array.isArray(task.filament_exist) ? task.filament_exist : [];
  const colorsFromPrinter = Array.isArray(task.filament_color_rgba) ? task.filament_color_rgba : [];
  const vendorsFromPrinter = Array.isArray(task.filament_vendor) ? task.filament_vendor : [];
  const materialsFromPrinter = Array.isArray(task.filament_type) ? task.filament_type : [];
  const subtypesFromPrinter = Array.isArray(task.filament_sub_type) ? task.filament_sub_type : [];
  const fallbackColors = normalizeFilamentSlotColors(manual.slotColors);

  return Array.from({ length: 4 }, (_, index) => {
    const loaded = typeof exists[index] === 'boolean' ? exists[index] : undefined;
    const color = printerColor(colorsFromPrinter[index]);
    const vendor = printerText(vendorsFromPrinter[index]);
    const materialType = printerText(materialsFromPrinter[index]);
    const subtype = printerText(subtypesFromPrinter[index]);
    const material = [materialType, subtype].filter(Boolean).join(' ') || undefined;
    const manualMaterial = [manual.slotMaterials[index], manual.slotSubtypes[index]]
      .filter(Boolean)
      .join(' ');

    const effectiveMain = materialType ?? (manual.slotMaterials[index] || 'PLA').toUpperCase();
    const effectiveSub = subtype ?? (manual.slotSubtypes[index] || '').toUpperCase();

    return {
      index,
      color: color ?? fallbackColors[index],
      brand: vendor && vendor !== 'GENERIC' ? vendor : manual.slotBrands[index] ?? 'Generic',
      material: material ?? (manualMaterial || 'PLA'),
      mainType: effectiveMain,
      subType: effectiveSub,
      status: loaded === true ? 'loaded' : loaded === false ? 'empty' : 'unknown',
      source: color || material ? 'printer' : 'manual',
    };
  });
}
