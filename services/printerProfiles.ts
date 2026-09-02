// Printer identity. Helix speaks Moonraker to every printer it supports, so a
// "profile" is not a transport — it is the set of per-machine assumptions the
// UI used to hardcode for the Snapmaker U1 (toolhead count, camera location,
// material-station shape, branding).
//
// Adding a machine that already runs Klipper + Moonraker means adding a row to
// PRINTER_PROFILES and a clause to detectPrinterKind. Machines that do NOT run
// Moonraker (stock FlashForge, which speaks its own protocol on :8899) would
// need a transport behind hooks/useMoonraker.tsx — deliberately not modelled
// here yet, but `kind` is the seam that layer will hang off.
// crabcore

/**
 * Print-preparation toggles a machine can honour. Defined here, with the rest
 * of the per-machine facts, so the RN dialog and the native preprocess sheet
 * cannot drift — they had separate hardcoded lists, and the native one kept
 * offering an AD5X a time-lapse it has no macros for.
 */
export type PrintPrefKey = 'flowCal' | 'timelapse' | 'autoLevel' | 'ifs';

export type PrinterKind =
  | 'snapmaker-u1'
  | 'flashforge-ad5x'
  | 'generic-klipper'
  | 'bambu-lan';

/**
 * Build volume plus the plate mesh drawn under the model in the 3D view.
 *
 * Sizes are Orca's `printable_area` / `printable_height` for the machine — the
 * same numbers the engine slices against, so the preview and the slice agree.
 */
export interface BedProfile {
  /** Printable area in mm. */
  sizeX: number;
  sizeY: number;
  /** Max Z in mm. */
  height: number;
  /**
   * Binary STL under the `bed/` asset dir, or null to draw a plain rectangle.
   *
   * These follow Orca's convention: the mesh is authored about the centre of
   * the printable area, so the renderer shifts it by (sizeX/2, sizeY/2). The
   * meshes are deliberately NOT symmetric — the extra material hanging off the
   * front is the plate's grab handle, and it is meant to overhang.
   */
  modelAsset: string | null;
  /**
   * Vendor wordmark watermarked on the plate in the 3D view. Null leaves it
   * bare, which is the right answer for any machine whose mark we do not have
   * — stamping "snapmaker" on a FlashForge plate is worse than stamping nothing.
   */
  logoText: string | null;
}

export interface PrinterProfile {
  kind: PrinterKind;
  /** Human label used when the printer does not name itself. */
  label: string;
  /**
   * Build volume + plate mesh. This is the bed for the whole kind; Bambu beds
   * vary per model, so `bambu-lan` carries the common P1/X1 bed as its fallback
   * and the per-model lookup keys off the serial.
   */
  bed: BedProfile;
  /**
   * Orca printer profile bundled under `assets/orca_profiles/printer/`, read for
   * this machine's start/end G-code. Null when we have no verified profile — the
   * engine then emits its own bare defaults, which is safer than handing a
   * machine another printer's homing and priming moves.
   */
  sliceProfileAsset: string | null;
  /** Preparation toggles this machine can actually act on. */
  printPrefs: PrintPrefKey[];
  /**
   * The machine exposes PAXX's `print_task_config` object and its
   * SET_PRINT_PREFERENCES / SET_PRINT_USED_EXTRUDERS macros (auto bed level,
   * timelapse, flow calibration across four extruders).
   *
   * Snapmaker U1 firmware only. Stock Klipper and the FlashForge mod have
   * neither the macros nor the object, so sending the preferences errors and
   * the read-back verification can never pass — which is why printing to a
   * non-U1 machine failed with "Printer rejected the selected print
   * preferences" before this was gated.
   */
  supportsPrintPreferences: boolean;
  /** Independently heated toolheads. The U1 has 4; most machines have 1. */
  toolheads: number;
  /** Lanes in the attached material station, 0 when there is none. */
  materialSlots: number;
  /**
   * Stream to fall back on when Moonraker reports no webcam. Host-relative, so
   * the camera follows the printer between LAN and Tailscale — see
   * resolveCameraUrl. Empty when the machine has no known default.
   */
  defaultCameraPath: string;
}

export const PRINTER_PROFILES: Record<PrinterKind, PrinterProfile> = {
  'snapmaker-u1': {
    kind: 'snapmaker-u1',
    label: 'Snapmaker U1',
    // Orca's printable_area for the U1 is nominally 271x272 with a half-mm
    // origin offset; the renderer and CopyArrangeCalculator have always used a
    // flat 270x270 and the arrangement maths is tuned to it. Kept as-is so
    // making the bed configurable does not quietly move every U1 print.
    bed: { sizeX: 270, sizeY: 270, height: 270, modelAsset: 'u1_bed.stl', logoText: 'snapmaker' },
    sliceProfileAsset: 'snapmaker_u1.json',
    printPrefs: ['autoLevel', 'flowCal', 'timelapse'],
    supportsPrintPreferences: true,
    toolheads: 4,
    materialSlots: 4,
    defaultCameraPath: '/webcam/webrtc',
  },
  'flashforge-ad5x': {
    kind: 'flashforge-ad5x',
    label: 'FlashForge AD5X',
    // Adventurer 5M-series plate, shared by the 5M/5M Pro/AD5X.
    bed: { sizeX: 220, sizeY: 220, height: 220, modelAsset: 'ad5x_bed.stl', logoText: 'flashforge' },
    sliceProfileAsset: 'flashforge_ad5x.json',
    printPrefs: ['autoLevel', 'ifs'],
    supportsPrintPreferences: false,
    toolheads: 1,
    materialSlots: 4,
    // ustreamer listens on 8080, but zmod's httpd reverse-proxies it on port 80
    // and that is the URL Moonraker advertises — verified against the printer's
    // [webcam video] section.
    defaultCameraPath: '/webcam/?action=stream',
  },
  'bambu-lan': {
    kind: 'bambu-lan',
    label: 'Bambu Lab',
    // One kind covers every Bambu because they all speak the same MQTT. The A1
    // mini is the only one with a different plate, so this 256 bed is both the
    // P1/X1/A1 bed and a safe fallback — see resolveBedProfile. Height is the
    // P1/X1's 250 rather than the A1's 256, so an unknown machine is assumed
    // shorter rather than taller.
    bed: {
      sizeX: 256,
      sizeY: 256,
      height: 250,
      modelAsset: 'bambu_x1_bed.stl',
      logoText: 'bambu lab',
    },
    // Exact P1S 0.4 profile from the BambuStudio project accepted by the real
    // test printer. The send path additionally rejects every non-P1S marker
    // and all multi-tool output before FTPS can be reached.
    sliceProfileAsset: 'bambu_p1s.json',
    // BambuStudio marks the P1S as supporting bed levelling and time-lapse,
    // but not per-print flow calibration. The project_file wire field remains
    // present and is forced false after applicablePrefs filters it out.
    printPrefs: ['autoLevel', 'timelapse'],
    supportsPrintPreferences: false,
    toolheads: 1,
    // One AMS unit. Machines without an AMS simply report no trays, and the
    // slot cards already handle that.
    materialSlots: 4,
    // The P-series serves no HTTP camera at all: frames come over a private
    // protocol on 6000, which the native layer republishes on loopback. The URL
    // is per-session, so it cannot be a static path — see hooks/useBambu.tsx.
    defaultCameraPath: '',
  },
  'generic-klipper': {
    kind: 'generic-klipper',
    label: 'Klipper printer',
    // Unknown machine, so no plate mesh — a plain rectangle at the Ender-class
    // size most bed-slinger Klipper builds use.
    bed: { sizeX: 220, sizeY: 220, height: 250, modelAsset: null, logoText: null },
    sliceProfileAsset: null,
    // Unknown firmware — every toggle here is vendor-specific.
    printPrefs: [],
    supportsPrintPreferences: false,
    toolheads: 1,
    materialSlots: 0,
    defaultCameraPath: '',
  },
};

export const DEFAULT_PRINTER_KIND: PrinterKind = 'generic-klipper';

/**
 * Kind assumed when a printer is typed in by hand instead of discovered.
 * Discovery detects the real kind; manual entry has nothing to go on, so it
 * keeps Helix's original machine rather than degrading everyone to generic.
 */
export const MANUAL_PRINTER_KIND: PrinterKind = 'snapmaker-u1';

export function isPrinterKind(value: unknown): value is PrinterKind {
  return typeof value === 'string' && value in PRINTER_PROFILES;
}

export function normalizePrinterKind(value: unknown): PrinterKind {
  return isPrinterKind(value) ? value : DEFAULT_PRINTER_KIND;
}

export function printerProfile(kind: unknown): PrinterProfile {
  return PRINTER_PROFILES[normalizePrinterKind(kind)];
}

/**
 * The A1 mini's plate — the only Bambu bed that is not the 256mm one.
 * 180x180x180, from Orca's `Bambu Lab A1 mini` machine model.
 */
const BAMBU_A1_MINI_BED: BedProfile = {
  sizeX: 180,
  sizeY: 180,
  height: 180,
  modelAsset: 'bambu_a1_mini_bed.stl',
  logoText: 'bambu lab',
};

/** Full-size A1: same 256mm plate footprint as P/X, but 6mm more Z travel. */
const BAMBU_A1_BED: BedProfile = {
  sizeX: 256,
  sizeY: 256,
  height: 256,
  modelAsset: 'bambu_x1_bed.stl',
  logoText: 'bambu lab',
};

/**
 * Bambu encodes the machine in the first three characters of the serial. The
 * code matches what SSDP reports as DevModel and what Orca stores as model_id:
 * N1 = A1 mini, N2S = A1, C11 = P1P, C12 = P1S, C13 = X1E,
 * BL-P001 = X1 Carbon, BL-P002 = X1.
 *
 * The full-size A1 shares the 256mm plate footprint, but has 256mm of Z travel
 * rather than the P1/X1 fallback's conservative 250mm. It also needs its own
 * machine startup profile, so both A-series prefixes are explicit here.
 *
 * The P1S prefix is confirmed against a real machine (its certificate CN is
 * `01P00C611300996` — see BambuMqttConnection.kt); the A1 mini prefix comes
 * from Bambu's published serial scheme and is not verified here.
 */
const BAMBU_A1_MINI_SERIAL_PREFIX = '030';
const BAMBU_A1_SERIAL_PREFIX = '039';
const VERIFIED_BAMBU_P1S_SERIAL_PREFIX = '01P';

/** Bed for a Bambu, chosen by serial. Falls back to the 256mm plate. */
export function bambuBedForSerial(serial: unknown): BedProfile {
  const prefix = typeof serial === 'string' ? serial.trim().toUpperCase().slice(0, 3) : '';
  if (prefix === BAMBU_A1_MINI_SERIAL_PREFIX) return BAMBU_A1_MINI_BED;
  if (prefix === BAMBU_A1_SERIAL_PREFIX) return BAMBU_A1_BED;
  return PRINTER_PROFILES['bambu-lan'].bed;
}

/** Identity a saved printer carries that can narrow down its bed. */
export interface BedIdentity {
  kind?: unknown;
  serialNumber?: string | null;
}

/**
 * The bed to slice and preview against for a saved printer.
 *
 * Most kinds map straight to their profile's bed. Bambu is the exception: one
 * kind covers machines with different plates, so it is resolved from the serial.
 */
export function resolveBedProfile(printer: BedIdentity | null | undefined): BedProfile {
  const kind = normalizePrinterKind(printer?.kind);
  if (kind === 'bambu-lan') return bambuBedForSerial(printer?.serialNumber);
  return PRINTER_PROFILES[kind].bed;
}

/** What the native slice needs to know about the target machine. */
export interface MachineProfile {
  bed: BedProfile;
  sliceProfileAsset: string | null;
  supportsPrintPreferences: boolean;
  /** Toggles the native preprocess sheet should offer. */
  printPrefs: PrintPrefKey[];
  /**
   * How the machine names its material feeds: 'lane' shows Lane 1–4 (AD5X,
   * Bambu), 'tool' shows T0–T3 feeding lanes (U1, everything else). Mirrors
   * LaneNaming in services/printPreprocess.ts so the native sheet words itself
   * the way the RN dialog does.
   */
  laneNaming: 'tool' | 'lane';
}

/**
 * Bed plus slice profile for a saved printer — the payload the native preview
 * and slice both read. Sending this is what stops a job going out with another
 * machine's bed size or start G-code.
 */
export function resolveMachineProfile(printer: BedIdentity | null | undefined): MachineProfile {
  const kind = normalizePrinterKind(printer?.kind);
  const serial = typeof printer?.serialNumber === 'string'
    ? printer.serialNumber.trim().toUpperCase()
    : '';
  const bambuSliceProfile = kind !== 'bambu-lan'
    ? PRINTER_PROFILES[kind].sliceProfileAsset
    : serial.startsWith(VERIFIED_BAMBU_P1S_SERIAL_PREFIX)
      ? 'bambu_p1s.json'
      : serial.startsWith(BAMBU_A1_SERIAL_PREFIX)
        ? 'bambu_a1.json'
        : null;
  return {
    bed: resolveBedProfile(printer),
    sliceProfileAsset: bambuSliceProfile,
    supportsPrintPreferences: PRINTER_PROFILES[kind].supportsPrintPreferences,
    printPrefs: kind === 'bambu-lan' && !bambuSliceProfile ? [] : PRINTER_PROFILES[kind].printPrefs,
    laneNaming: kind === 'flashforge-ad5x' || kind === 'bambu-lan' ? 'lane' : 'tool',
  };
}


/** Identity fields Moonraker exposes, from two different endpoints. */
export interface PrinterIdentity {
  /** `machine/system_info` → system_info.product_info (PAXX/Snapmaker only). */
  machineType?: string;
  serial?: string;
  deviceName?: string;
  /** `printer/info` → hostname. The FlashForge Klipper mod reports "flashforge". */
  hostname?: string;
}

function lower(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function detectPrinterKind(identity: PrinterIdentity): PrinterKind {
  const machineType = lower(identity.machineType);
  const serial = lower(identity.serial);
  const hostname = lower(identity.hostname);
  const deviceName = lower(identity.deviceName);

  // PAXX publishes product_info; stock Klipper builds do not.
  if (machineType.includes('u1') || serial.startsWith('811')) return 'snapmaker-u1';

  // The Adventurer 5M/5X Klipper mod keeps the vendor hostname, which is the
  // only identity it reliably exposes — product_info is absent there.
  if (
    hostname.startsWith('flashforge') ||
    /\bad5[xm]\b|adventurer\s*5/.test(machineType) ||
    /\bad5[xm]\b|adventurer\s*5/.test(deviceName)
  ) {
    return 'flashforge-ad5x';
  }

  return 'generic-klipper';
}
