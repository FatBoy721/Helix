// Bambu state, rendered in the shape the rest of Helix already reads.
//
// Every consumer in the app — useDashboardModel, the temperature cards, the
// filament slots, the notification transitions in useMoonraker — speaks
// Klipper's status vocabulary. Rather than teach each of them a second dialect,
// this maps Bambu's report onto those same keys. That is the seam
// services/printerProfiles.ts was written for.
//
// The translation is deliberately shallow: it renames and rescales, and does
// not invent. Anything Bambu has no answer for is left absent rather than
// defaulted, so the UI's existing "unknown" handling still applies.
//
// Field names verified against a real P1S.
// crabcore

import {
  activeBambuTray,
  BAMBU_EXTERNAL_TRAY,
  bambuNumber,
  bambuTrays,
  isBambuTrayLoaded,
  type BambuState,
  type BambuTray,
} from './bambuReport';
import { bambuFanPercent } from './bambuControls';

/**
 * gcode_state -> Klipper's print_stats.state.
 *
 * PREPARE covers heating and bed levelling, which Klipper reports as part of
 * printing; treating it as idle would make the dashboard look asleep while the
 * machine is visibly busy.
 */
const PRINT_STATE: Record<string, string> = {
  IDLE: 'standby',
  PREPARE: 'printing',
  SLICING: 'printing',
  RUNNING: 'printing',
  PAUSE: 'paused',
  FINISH: 'complete',
  FAILED: 'error',
};

/** Part-cooling fan speeds arrive on a 0-15 scale; Klipper's fan.speed is 0-1. */
const FAN_SCALE = 15;

/** Helix's slot UI is built around four slots, matching one AMS unit. */
const MIN_SLOTS = 4;

function temperature(current: unknown, target: unknown): { temperature?: number; target?: number } {
  return { temperature: bambuNumber(current), target: bambuNumber(target) };
}

function fanSpeed(value: unknown): number | undefined {
  const raw = bambuNumber(value);
  if (raw == null) return undefined;
  return Math.max(0, Math.min(1, raw / FAN_SCALE));
}

/**
 * "PLA Basic" against type "PLA" yields "Basic". Bambu repeats the base type
 * inside the sub-brand, and the slot cards are too narrow to show it twice.
 */
function subType(tray: BambuTray): string {
  const brand = (tray.tray_sub_brands ?? '').trim();
  const type = (tray.tray_type ?? '').trim();
  if (!brand) return '';
  if (type && brand.toUpperCase().startsWith(type.toUpperCase())) {
    return brand.slice(type.length).trim();
  }
  return brand;
}

/**
 * Whether the slot holds a real Bambu spool the AMS read by RFID.
 *
 * The obvious candidate, `tray_is_bbl_bits`, does not mean this: a slot set by
 * hand to Generic PETG still reports it. A non-zero RFID tag does — verified on
 * a P1S whose hand-configured slot had that bit set and a zeroed tag.
 */
function isGenuineBambuSpool(tray: BambuTray): boolean {
  const uid = (tray.tag_uid ?? '').trim();
  return uid !== '' && /[^0]/.test(uid);
}

/**
 * AMS trays as `print_task_config`, which is where resolveFilamentSlots already
 * looks. Its colour parser accepts the 8-digit RGBA Bambu emits, so the slot
 * cards need no Bambu-specific code at all.
 */
function filamentSlots(state: BambuState): Record<string, unknown> {
  const trays = bambuTrays(state);
  const slotCount = Math.max(MIN_SLOTS, ...trays.map((entry) => entry.index + 1));

  const exist: boolean[] = new Array(slotCount).fill(false);
  const colors: string[] = new Array(slotCount).fill('');
  const vendors: string[] = new Array(slotCount).fill('');
  const types: string[] = new Array(slotCount).fill('');
  const subTypes: string[] = new Array(slotCount).fill('');
  // Write-back fields: ams_filament_setting needs the tray's filament id and
  // nozzle temps, and the slot cards' vocabulary has no place for them.
  const infoIdx: string[] = new Array(slotCount).fill('');
  const tempMin: number[] = new Array(slotCount).fill(0);
  const tempMax: number[] = new Array(slotCount).fill(0);
  const trayIndexes: number[] = new Array(slotCount).fill(0).map((_, index) => index);

  for (const { index, tray } of trays) {
    if (index >= slotCount) continue;
    const loaded = isBambuTrayLoaded(state, index);
    exist[index] = loaded;
    // A tray keeps its last filament's details after being emptied, so only a
    // loaded tray is allowed to describe itself.
    if (!loaded) continue;

    colors[index] = tray.tray_color ?? '';
    types[index] = tray.tray_type ?? '';
    subTypes[index] = subType(tray);
    vendors[index] = isGenuineBambuSpool(tray) ? 'Bambu' : 'Generic';
    infoIdx[index] = tray.tray_info_idx ?? '';
    tempMin[index] = bambuNumber(tray.nozzle_temp_min) ?? 0;
    tempMax[index] = bambuNumber(tray.nozzle_temp_max) ?? 0;
  }

  return {
    bambu_filament_source: 'ams',
    filament_exist: exist,
    filament_color_rgba: colors,
    filament_vendor: vendors,
    filament_type: types,
    filament_sub_type: subTypes,
    filament_info_idx: infoIdx,
    nozzle_temp_min: tempMin,
    nozzle_temp_max: tempMax,
    bambu_tray_index: trayIndexes,
  };
}

/**
 * The single virtual tray used when no AMS is attached.
 *
 * A P1S/A1 has no sensor that proves a side spool is physically present while
 * idle, so `null` deliberately means "usable, occupancy unknown". `true` is
 * reserved for the printer explicitly reporting tray 254 as the active feed.
 * The printer-authored material metadata is still safe to show and edit.
 */
function externalFilamentSlot(state: BambuState): Record<string, unknown> | null {
  const raw = state.vt_tray;
  const tray = (Array.isArray(raw) ? raw[0] : raw) as BambuTray | undefined;
  if (!tray || typeof tray !== 'object') return null;
  const hasMetadata = Boolean(
    tray.tray_type?.trim() || tray.tray_info_idx?.trim() || tray.tray_color?.replace(/0/g, '')
  );

  return {
    bambu_filament_source: 'external',
    filament_exist: [activeBambuTray(state) === BAMBU_EXTERNAL_TRAY ? true : null],
    filament_color_rgba: [hasMetadata ? tray.tray_color ?? '' : ''],
    filament_vendor: [hasMetadata ? (isGenuineBambuSpool(tray) ? 'Bambu' : 'Generic') : ''],
    filament_type: [hasMetadata ? tray.tray_type ?? '' : ''],
    filament_sub_type: [hasMetadata ? subType(tray) : ''],
    filament_info_idx: [hasMetadata ? tray.tray_info_idx ?? '' : ''],
    nozzle_temp_min: [hasMetadata ? bambuNumber(tray.nozzle_temp_min) ?? 0 : 0],
    nozzle_temp_max: [hasMetadata ? bambuNumber(tray.nozzle_temp_max) ?? 0 : 0],
    bambu_tray_index: [BAMBU_EXTERNAL_TRAY],
  };
}

export type BambuHmsSeverity = 'fatal' | 'error' | 'warning' | 'info';

export interface BambuHmsFault {
  /** Four-group printer notation, or the two-group print_error notation. */
  code: string;
  summary: string;
  severity: BambuHmsSeverity;
  helpUrl: string;
  source: 'hms' | 'print_error';
}

const HMS_HOME_URL = 'https://wiki.bambulab.com/en/hms/home';

// These are exact four-group identities documented by Bambu. Never match only
// the first and last group: those discard component/alert-level information
// and can assign a neighbouring fault's remedy to the wrong problem.
const HMS_DESCRIPTIONS: Record<string, string> = {
  '0300-0200-0001-0001': 'The nozzle heater may be short-circuited.',
  '0300-0200-0001-0002': 'The nozzle heater may have an open circuit.',
  '0300-0300-0001-0001': 'The hotend cooling fan speed is abnormal.',
  '0300-0D00-0001-0003': 'The build plate may not be positioned correctly.',
  '0300-8003-0001-0001': 'Spaghetti was detected by AI print monitoring.',
  '0300-800A-0001-0001': 'A filament pile-up was detected by AI print monitoring.',
  '0500-0300-0001-0002': 'The toolhead is malfunctioning.',
  '0500-0300-0001-0003': 'The AMS module is malfunctioning.',
  '0700-6000-0002-0001': 'The AMS slot is overloaded; check for a tangle or excess drag.',
  '07FF-2000-0002-0001': 'Filament has run out.',
};

function hmsInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value >>> 0 : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const parsed = /^0x/i.test(raw) ? Number.parseInt(raw.slice(2), 16) : Number(raw);
  return Number.isFinite(parsed) ? parsed >>> 0 : undefined;
}

function uint32Hex(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function severityFromAttr(attr: number): BambuHmsSeverity {
  const level = (attr >>> 8) & 0xf;
  if (level === 1) return 'fatal';
  if (level === 2) return 'error';
  if (level === 4) return 'info';
  return 'warning';
}

function unknownHmsSummary(firstGroup: string): string {
  if (firstGroup === '0300') return 'Printer hardware or motion system fault.';
  if (firstGroup === '0500') return 'Printer system or communication fault.';
  if (/^07(?:[0-9A-F]{2})$/.test(firstGroup)) return 'AMS or filament system fault.';
  return 'The printer reported an HMS fault.';
}

/** Every active Bambu fault, retaining the full identity needed by its wiki. */
export function bambuHmsFaults(state: BambuState): BambuHmsFault[] {
  const faults: BambuHmsFault[] = [];
  const hms = Array.isArray(state.hms) ? state.hms : [];

  for (const entry of hms) {
    const attr = hmsInteger(entry?.attr);
    const code = hmsInteger(entry?.code);
    if (attr == null || code == null) continue;
    const groups = `${uint32Hex(attr)}${uint32Hex(code)}`.match(/.{4}/g);
    if (!groups) continue;
    const displayCode = groups.join('-');
    // Firmware emits these during a normal user-cancel sequence; they are
    // acknowledgements, not actionable faults.
    const shortCode = `${groups[0]}_${groups[3]}`;
    if (shortCode === '0300_400C' || shortCode === '0500_400E') continue;
    faults.push({
      code: displayCode,
      summary: HMS_DESCRIPTIONS[displayCode] ?? unknownHmsSummary(groups[0]),
      severity: severityFromAttr(attr),
      // Bambu's per-code routes are incomplete and model-specific; even valid
      // codes can return 404. Their HMS home is the stable official lookup.
      helpUrl: HMS_HOME_URL,
      source: 'hms',
    });
  }

  const printError = hmsInteger(state.print_error);
  if (printError) {
    const raw = uint32Hex(printError);
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    faults.unshift({
      code,
      summary: 'The printer reported a print-system error.',
      severity: 'error',
      helpUrl: HMS_HOME_URL,
      source: 'print_error',
    });
  }

  return faults;
}

/** Whatever the printer is complaining about, in one line, or empty. */
function errorMessage(faults: BambuHmsFault[]): string {
  const first = faults[0];
  if (!first) return '';
  return faults.length === 1
    ? `${first.summary} (${first.code})`
    : `${first.summary} (+${faults.length - 1} more)`;
}

/**
 * Builds the Klipper-shaped status object from held Bambu state.
 *
 * Keys are chosen to match what the existing UI probes for, including
 * `temperature_sensor chamber`, which is how chamberTemperature.ts discovers a
 * chamber reading.
 */
export function bambuStatus(state: BambuState): Record<string, any> {
  const gcodeState = String(state.gcode_state ?? '').toUpperCase();
  const printState = PRINT_STATE[gcodeState] ?? 'standby';
  const percent = bambuNumber(state.mc_percent);
  const progress = percent == null ? undefined : Math.max(0, Math.min(1, percent / 100));
  const remainingMinutes = bambuNumber(state.mc_remaining_time);
  const hmsFaults = bambuHmsFaults(state);
  const rawSkippedObjects = (state as any).s_obj;
  const skippedObjectIds = Array.isArray(rawSkippedObjects)
    ? [...new Set(rawSkippedObjects
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isSafeInteger(value) && value >= 0))].slice(0, 64)
    : [];

  const status: Record<string, any> = {
    print_stats: {
      state: printState,
      // subtask_name is the print job's name; Bambu's gcode_file is usually
      // blank on the P-series, so this is the only human-readable label.
      filename: String(state.subtask_name ?? state.gcode_file ?? ''),
      message: printState === 'error' ? errorMessage(hmsFaults) : '',
      info: {
        current_layer: bambuNumber(state.layer_num),
        total_layer: bambuNumber(state.total_layer_num),
        // Bambu counts down in whole minutes; the rest of Helix works in
        // seconds, and this is a far better ETA source than extrapolating
        // from progress.
        remaining_time: remainingMinutes == null ? undefined : remainingMinutes * 60,
      },
    },
    virtual_sdcard: {
      progress,
      is_active: printState === 'printing',
    },
    display_status: { progress },
    extruder: temperature(state.nozzle_temper, state.nozzle_target_temper),
    heater_bed: temperature(state.bed_temper, state.bed_target_temper),
    // Single hotend, and the name the rest of the app expects to find here.
    toolhead: { extruder: 'extruder' },
    fan: { speed: fanSpeed(state.cooling_fan_speed) },
    bambu: {
      speed_preset: bambuNumber(state.spd_lvl),
      active_tray: activeBambuTray(state),
      ams_health: bambuAmsHealth(state),
      hms_faults: hmsFaults,
      skipped_object_ids: skippedObjectIds,
      fans: {
        part: bambuFanPercent(state.cooling_fan_speed),
        aux: bambuFanPercent(state.big_fan1_speed),
        chamber: bambuFanPercent(state.big_fan2_speed),
      },
    },
  };

  // Presented as a Klipper LED so the dashboard's existing light control finds
  // it. BambuProvider translates the SET_LED that control emits back into
  // Bambu's own ledctrl command.
  const lights = Array.isArray(state.lights_report) ? state.lights_report : [];
  const chamberLight = lights.find((entry: any) => entry?.node === 'chamber_light');
  if (chamberLight) {
    const on = String(chamberLight.mode ?? '').toLowerCase() === 'on' ? 1 : 0;
    status['neopixel chamber_light'] = { color_data: [[on, on, on]] };
  }

  // The P-series reports a chamber figure whether or not it has a real sensor,
  // so only surface it when it looks like a plausible reading.
  const chamber = bambuNumber(state.chamber_temper);
  if (chamber != null && chamber > 0) {
    status['temperature_sensor chamber'] = { temperature: chamber };
  }

  if (Array.isArray(state?.ams?.ams) && state.ams.ams.length > 0) {
    status.print_task_config = filamentSlots(state);
  } else {
    const external = externalFilamentSlot(state);
    if (external) status.print_task_config = external;
  }

  return status;
}

/** Zero-based slot the printer is currently printing from, or null. */
export function bambuActiveSlot(state: BambuState): number | null {
  return activeBambuTray(state);
}

/** AMS drying info, which has no Klipper equivalent and is surfaced directly. */
export interface BambuAmsHealth {
  unit: number;
  /** Bambu's 1-5 scale, 1 being driest. Not a percentage. */
  humidity?: number;
  temperature?: number;
}

export function bambuAmsHealth(state: BambuState): BambuAmsHealth[] {
  const units = Array.isArray(state?.ams?.ams) ? state.ams.ams : [];
  return units.map((unit: any, position: number) => ({
    unit: bambuNumber(unit?.id) ?? position,
    humidity: bambuNumber(unit?.humidity),
    temperature: bambuNumber(unit?.temp),
  }));
}
