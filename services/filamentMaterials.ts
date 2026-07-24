// Firmware filament catalog presets for the manual filament editor.
//
// The U1 firmware splits a filament into two fields:
//   - MAIN_TYPE (FILAMENT_TYPE)  : the base polymer, e.g. PLA / PETG / PA.
//   - SUB_TYPE  (FILAMENT_SUBTYPE): the filler or finish, e.g. CF / Silk / Matte.
// Compound labels like "PLA-CF" are NOT a single MAIN_TYPE in the firmware's
// id_material.json catalog (material_type is the base polymer); they are
// expressed as MAIN_TYPE=PLA + SUB_TYPE=CF. MAIN_TYPE is validated against
// MAIN_TYPE_PATTERN by buildManualFilamentSlotCommand, so every entry in
// FILAMENT_MAIN_TYPES must match it. SUPPORT is intentionally absent — it is
// not a real firmware material (use HIPS / PVA / BVOH for support).

export const MAIN_TYPE_PATTERN = /^[A-Za-z0-9._+-]+$/;

export const DEFAULT_FILAMENT_SUBTYPE = 'Basic';

// Base polymers, ordered from common desktop materials to engineering /
// high-temp / support filaments. Derived from the distinct material_type
// values in U1 id_material.json (96-material catalog).
export const FILAMENT_MAIN_TYPES: readonly string[] = [
  // common
  'PLA', 'PETG', 'ABS', 'ASA', 'TPU',
  // nylons
  'PA', 'PA6', 'PA12', 'PPA', 'PAHT',
  // engineering
  'PC', 'PCPTFE', 'PCTG', 'PET', 'PP', 'PE', 'POM', 'PMMA', 'PBT',
  'PVB', 'PS', 'PVC', 'HIPS', 'EVA', 'PHA',
  // flexibles
  'TPE', 'TPC', 'TPS', 'SEBS', 'SBS', 'SBC', 'TPI',
  // high-performance
  'PPS', 'PPSU', 'PSU', 'PEI-1010', 'PEEK', 'PEKK', 'PVDF', 'PEBA',
  // soluble support
  'PVA', 'BVOH',
];

// Fillers / finishes that change behaviour or temp (CF/GF, Silk +10C flow,
// Matte -5C, HF/HS high flow, Wood, ESD, etc.). SUB_TYPE is sent quoted, so
// spaces are allowed, but we keep canonical short forms.
export const FILAMENT_SUB_TYPES: readonly string[] = [
  'Basic', 'Plus', 'Silk', 'Matte', 'HF', 'HS', 'SnapSpeed',
  'CF', 'GF', 'AF', 'PTFE', 'Wood', 'ESD', 'AERO', 'rCF', 'Marble',
];

// Per-MAIN_TYPE valid subtypes for the editor's Subtype picker. Union of three
// sources: (1) the firmware id_material.json catalog (filled_type + label
// finishes), (2) filament_parameters.py tuning keys that actually move temps
// (Silk/Matte/HF/SnapSpeed/Wood/95A — several of these are NOT in the
// chemistry catalog), (3) common real-world variants (e.g. PLA-GF). Every
// list starts with Basic. Catalog-conformance is guarded by regression tests.
export const FILAMENT_SUBTYPES_BY_MAIN_TYPE: Readonly<Record<string, readonly string[]>> = {
  // desktop
  PLA: ['Basic', 'Plus', 'Silk', 'Matte', 'HF', 'HS', 'SnapSpeed', 'CF', 'GF', 'Wood', 'Marble', 'ESD', 'AERO', 'rCF'],
  PETG: ['Basic', 'CF', 'GF', 'HF', 'HS', 'ESD', 'PTFE', 'rCF'],
  ABS: ['Basic', 'CF', 'GF', 'AF'],
  ASA: ['Basic', 'CF', 'GF', 'AF', 'AERO'],
  // flexibles (Shore hardness 95A applies)
  TPU: ['Basic', '95A', 'HF', 'HS', 'CF', 'GF', 'High Speed'],
  TPE: ['Basic', '95A', 'CF', 'GF'],
  TPC: ['Basic', '95A', 'CF', 'GF'],
  EVA: ['Basic', '95A'],
  TPS: ['Basic'],
  SEBS: ['Basic'],
  SBS: ['Basic'],
  SBC: ['Basic'],
  PHA: ['Basic'],
  TPI: ['Basic'],
  // nylons
  PA: ['Basic', 'CF', 'GF', 'AF'],
  PA6: ['Basic', 'CF', 'GF', 'AF'],
  PA12: ['Basic', 'CF', 'GF', 'AF'],
  PPA: ['Basic', 'CF', 'GF', 'AF'],
  PAHT: ['Basic', 'CF', 'GF'],
  // engineering
  PC: ['Basic', 'CF', 'GF', 'PTFE'],
  PCPTFE: ['Basic'],
  PCTG: ['Basic', 'CF', 'GF'],
  PET: ['Basic', 'CF', 'GF'],
  PP: ['Basic', 'CF', 'GF'],
  PE: ['Basic', 'CF'],
  POM: ['Basic'],
  PMMA: ['Basic'],
  PBT: ['Basic'],
  PVB: ['Basic'],
  PS: ['Basic'],
  PVC: ['Basic'],
  PSU: ['Basic'],
  PVDF: ['Basic'],
  PEBA: ['Basic'],
  // high-performance
  PPS: ['Basic', 'CF', 'GF'],
  PPSU: ['Basic', 'CF', 'GF'],
  'PEI-1010': ['Basic', 'CF'],
  PEEK: ['Basic', 'CF', 'GF'],
  PEKK: ['Basic', 'CF', 'GF'],
  // soluble / support
  HIPS: ['Basic'],
  PVA: ['Basic'],
  BVOH: ['Basic'],
};

// Subtypes the picker may offer for a given MAIN_TYPE. Falls back to Basic for
// any MAIN_TYPE not explicitly curated (defensive — should not happen since
// every FILAMENT_MAIN_TYPES entry is mapped, but keeps callers safe).
export function subtypesForMainType(mainType: string): readonly string[] {
  return FILAMENT_SUBTYPES_BY_MAIN_TYPE[mainType] ?? [DEFAULT_FILAMENT_SUBTYPE];
}

export function isKnownFilamentMainType(value: string): boolean {
  return FILAMENT_MAIN_TYPES.includes(value);
}
