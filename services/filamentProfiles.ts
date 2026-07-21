import type { FilamentSlotDisplay } from '../components/FilamentSlotsEditor';

export type NativeMaterialProfile = {
  material: string;
  brand: string;
  nozzleTemp: number;
};

type PaxxProfile = {
  flow_temp?: number;
};

type PaxxCatalog = Record<string, Record<string, Record<string, PaxxProfile>>>;

const MATERIALS = [
  'PLA-CF', 'PETG-CF', 'PETG-HF', 'PA6-CF', 'PA6-GF', 'PA-CF', 'PA-GF',
  'PC-ABS', 'PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'PA', 'PC', 'PVA',
];

const FALLBACK_TEMPS: Record<string, number> = {
  PLA: 220,
  'PLA-CF': 220,
  PETG: 255,
  'PETG-CF': 255,
  'PETG-HF': 220,
  TPU: 240,
  ABS: 270,
  ASA: 260,
  PA: 260,
  'PA-CF': 290,
  'PA6-CF': 290,
  'PA-GF': 290,
  'PA6-GF': 290,
  PC: 280,
  'PC-ABS': 270,
  PVA: 220,
};

function normalizeMaterial(raw: string): string {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, '-');
  return MATERIALS.find((material) => upper.includes(material)) ?? 'PLA';
}

function normalizeBrand(raw: string): string {
  return raw.trim() || 'Generic';
}

function vendorKey(brand: string): string {
  return `vendor_${brand.replace(/[^a-z0-9]/gi, '') || 'generic'}`;
}

function resolveProfile(catalog: PaxxCatalog | null, brand: string, material: string): number {
  const materialProfiles = catalog?.[material];
  const vendor = materialProfiles?.[vendorKey(brand)] ?? materialProfiles?.vendor_generic;
  const subtype = vendor?.sub_generic ?? Object.values(vendor ?? {})[0];
  return typeof subtype?.flow_temp === 'number'
    ? subtype.flow_temp
    : FALLBACK_TEMPS[material] ?? FALLBACK_TEMPS.PLA;
}

export async function resolveNativeMaterialProfiles(
  printerUrl: string | null | undefined,
  slots: FilamentSlotDisplay[],
): Promise<NativeMaterialProfile[]> {
  let catalog: PaxxCatalog | null = null;
  if (printerUrl) {
    try {
      const response = await fetch(`${printerUrl.replace(/\/$/, '')}/server/files/config/snapmaker/filament_parameters.json`);
      if (response.ok) catalog = await response.json() as PaxxCatalog;
    } catch {
      // Local fallback below keeps slicing available when the printer is offline.
    }
  }

  return Array.from({ length: 4 }, (_, index) => {
    const slot = slots[index];
    const brand = normalizeBrand(slot?.brand ?? 'Generic');
    const material = normalizeMaterial(slot?.material ?? 'PLA');
    return { brand, material, nozzleTemp: resolveProfile(catalog, brand, material) };
  });
}
