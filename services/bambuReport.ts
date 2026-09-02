// Bambu's report feed: what arrives, and how to keep a coherent picture of it.
//
// The printer publishes to `device/{serial}/report` in two flavours, told apart
// by `print.msg`:
//
//   msg: 0  full state dump, ~63 fields, only sent in reply to `pushall`
//   msg: 1  delta, often 3-4 fields, sent continuously
//
// pybambu and OctoApp guess at this with a "more than 40 keys means full sync"
// heuristic. The field is authoritative, so Helix uses it.
//
// Deltas must be merged onto held state, never swapped in — a delta carrying
// only `bed_temper` would otherwise wipe out the print, the AMS and the
// temperatures. Shapes verified against a real P1S.
// crabcore

/** Held state: the accumulation of one full dump plus every delta since. */
export type BambuState = Record<string, any>;

/** One AMS tray. Empty slots report little more than an `id`. */
export interface BambuTray {
  id?: string;
  tray_type?: string;
  tray_sub_brands?: string;
  tray_id_name?: string;
  tray_info_idx?: string;
  /** 8-digit RGBA hex, e.g. "FF6A13FF". Zeroed when the slot is empty. */
  tray_color?: string;
  tray_weight?: string;
  tray_diameter?: string;
  nozzle_temp_min?: string;
  nozzle_temp_max?: string;
  /** Percent left, by the printer's own reckoning. -1 when it cannot tell. */
  remain?: number;
  tray_uuid?: string;
  /**
   * RFID tag of a genuine Bambu spool, all zeroes when the slot was configured
   * by hand. This — not tray_is_bbl_bits — is what distinguishes a real Bambu
   * spool: a hand-set Generic PETG slot still reports that bit as set.
   */
  tag_uid?: string;
  /** Every colour in the filament; more than one for gradient spools. */
  cols?: string[];
}

export interface BambuAmsUnit {
  id?: string;
  /** Bambu's own 0-5 scale, where 1 is driest. Not a percentage. */
  humidity?: string;
  temp?: string;
  tray?: BambuTray[];
}

/** Nothing is loaded. Bambu uses this in tray_now/tray_tar/tray_pre. */
export const BAMBU_NO_TRAY = 255;

/** Trays per AMS unit, fixed by the hardware. */
export const TRAYS_PER_AMS = 4;

/** The external spool holder, which reports as a tray with this id. */
export const BAMBU_EXTERNAL_TRAY = 254;

/** The virtual AMS id Bambu uses when editing the single external holder. */
export const BAMBU_EXTERNAL_AMS = 255;

export type BambuFilamentSource = 'ams' | 'external';

export interface BambuFilamentWriteLocation {
  unit: number;
  tray: number;
  /** Required for the virtual external holder; omitted for physical AMS trays. */
  slot?: number;
}

/**
 * On-wire address for a filament edit.
 *
 * The external values are not inferred from tray numbering: BambuStudio's
 * captured P1/X1 request and Bambu's Fleet Hub reference both use
 * ams_id=255, tray_id=254, slot_id=0. Physical AMS edits retain the existing
 * unit/local-tray encoding.
 */
export function bambuFilamentWriteLocation(
  source: BambuFilamentSource,
  channel: number
): BambuFilamentWriteLocation {
  if (!Number.isInteger(channel) || channel < 0) {
    throw new RangeError('Bambu filament channel must be a non-negative integer');
  }
  if (source === 'external') {
    if (channel !== 0) throw new RangeError('A single external spool only has channel 0');
    return { unit: BAMBU_EXTERNAL_AMS, tray: BAMBU_EXTERNAL_TRAY, slot: 0 };
  }
  return { unit: Math.floor(channel / TRAYS_PER_AMS), tray: channel % TRAYS_PER_AMS };
}

// Bambu Studio's official Generic ... @base profiles. These IDs describe a
// material preset; they are not evidence that an AMS tray is occupied.
const GENERIC_FILAMENT_IDS: Record<string, string> = {
  ABS: 'GFB99',
  ASA: 'GFB98',
  BVOH: 'GFS97',
  EVA: 'GFR99',
  HIPS: 'GFS98',
  PA: 'GFN99',
  'PA-CF': 'GFN98',
  PC: 'GFC99',
  PCTG: 'GFG97',
  PE: 'GFP99',
  'PE-CF': 'GFP98',
  PETG: 'GFG99',
  'PETG-CF': 'GFG98',
  PHA: 'GFR98',
  PLA: 'GFL99',
  'PLA-CF': 'GFL98',
  PP: 'GFP97',
  'PP-CF': 'GFP96',
  'PP-GF': 'GFP95',
  'PPA-CF': 'GFN97',
  'PPA-GF': 'GFN96',
  PPS: 'GFT97',
  'PPS-CF': 'GFT98',
  PVA: 'GFS99',
  TPU: 'GFU99',
};

/** Official generic ID for an editable AMS material, or undefined to fail closed. */
export function genericBambuFilamentId(material: string): string | undefined {
  return GENERIC_FILAMENT_IDS[material.trim().toUpperCase()];
}

export type BambuFilamentEditIdentity =
  | { ok: true; filamentId: string }
  | { ok: false; reason: 'empty' | 'unsupported-material' };

/** Separates the AMS occupancy bit from its optional material preset ID. */
export function resolveBambuFilamentEditIdentity(
  occupied: boolean,
  reportedFilamentId: unknown,
  material: string
): BambuFilamentEditIdentity {
  if (!occupied) return { ok: false, reason: 'empty' };
  const filamentId = String(reportedFilamentId ?? '').trim() || genericBambuFilamentId(material);
  return filamentId
    ? { ok: true, filamentId }
    : { ok: false, reason: 'unsupported-material' };
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-merges a delta into held state. Objects merge key by key; arrays are
 * replaced wholesale, because Bambu resends a full array whenever any element
 * of it changes and merging them positionally would strand removed entries.
 */
export function mergeBambuState(previous: BambuState, incoming: BambuState): BambuState {
  const merged: BambuState = { ...previous };

  for (const [key, value] of Object.entries(incoming)) {
    const existing = merged[key];
    merged[key] = isPlainObject(value) && isPlainObject(existing)
      ? mergeBambuState(existing, value)
      : value;
  }

  return merged;
}

/**
 * Folds one raw report into held state, returning the new state and whether
 * this was a full dump. Reports that carry no `print` section (`info` replies
 * to get_version, for instance) leave the state untouched.
 */
export function applyBambuReport(
  state: BambuState,
  report: Record<string, any>
): { state: BambuState; isFullState: boolean } {
  const print = report?.print;
  if (!isPlainObject(print)) return { state, isFullState: false };

  return {
    state: mergeBambuState(state, print),
    isFullState: print.msg === 0,
  };
}

/** Bambu sends numbers as strings about as often as it sends them as numbers. */
export function bambuNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Flattens the AMS units into one list indexed the way Bambu addresses trays
 * globally: unit 0 owns 0-3, unit 1 owns 4-7, and so on. `tray_now` and the
 * ams_change_filament command both speak in these indices.
 */
export function bambuTrays(state: BambuState): { index: number; tray: BambuTray }[] {
  const units: BambuAmsUnit[] = Array.isArray(state?.ams?.ams) ? state.ams.ams : [];
  const trays: { index: number; tray: BambuTray }[] = [];

  units.forEach((unit, unitPosition) => {
    // Trust the unit's own id over its position — a second AMS can report out
    // of order, and getting this wrong would load filament from the wrong bay.
    const unitId = bambuNumber(unit?.id) ?? unitPosition;
    const unitTrays = Array.isArray(unit?.tray) ? unit.tray : [];

    unitTrays.forEach((tray, trayPosition) => {
      const trayId = bambuNumber(tray?.id) ?? trayPosition;
      trays.push({ index: unitId * TRAYS_PER_AMS + trayId, tray });
    });
  });

  return trays;
}

/**
 * True when a tray actually holds filament. Bambu leaves stale values in a
 * tray after it is unloaded, so the presence of `tray_type` alone proves
 * nothing; `tray_exist_bits` is the printer's own answer.
 */
export function isBambuTrayLoaded(state: BambuState, index: number): boolean {
  const bits = parseInt(String(state?.ams?.tray_exist_bits ?? '0'), 16);
  if (!Number.isFinite(bits)) return false;
  return (bits & (1 << index)) !== 0;
}

/** Globally-indexed tray currently loaded into the hotend, if any. */
export function activeBambuTray(state: BambuState): number | null {
  const now = bambuNumber(state?.ams?.tray_now);
  if (now == null || now === BAMBU_NO_TRAY) return null;
  return now;
}
