// Pure validation and G-code construction for Bambu dashboard controls.
// Keeping this separate from the native MQTT bridge makes every safety bound
// testable without loading React Native in the regression runner.

export type BambuHeater = 'nozzle' | 'bed';
export type BambuFan = 'part' | 'aux' | 'chamber';
export interface BambuCalibrationOptions {
  bedLeveling?: boolean;
  vibration?: boolean;
  motorNoise?: boolean;
}

const HEATER_LIMITS: Record<BambuHeater, number> = { nozzle: 300, bed: 120 };
const FAN_IDS: Record<BambuFan, number> = { part: 1, aux: 2, chamber: 3 };

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number`);
  const rounded = Math.round(value);
  if (rounded < minimum || rounded > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return rounded;
}

export function buildBambuTemperatureCommand(heater: BambuHeater, target: number): string {
  const safeTarget = boundedInteger(target, 0, HEATER_LIMITS[heater], `${heater} temperature`);
  return heater === 'nozzle' ? `M104 T0 S${safeTarget}` : `M140 S${safeTarget}`;
}

export function buildBambuFanCommand(fan: BambuFan, percent: number): string {
  const safePercent = boundedInteger(percent, 0, 100, `${fan} fan speed`);
  const pwm = Math.round((safePercent / 100) * 255);
  return `M106 P${FAN_IDS[fan]} S${pwm}`;
}

/**
 * BambuStudio's public DeviceManager maps these three common calibrations to
 * bits 1-3. Model-specific camera/nozzle/heatbed options stay unavailable.
 */
export function buildBambuCalibrationOption(options: BambuCalibrationOptions): number {
  const option =
    (options.bedLeveling ? 1 << 1 : 0) |
    (options.vibration ? 1 << 2 : 0) |
    (options.motorNoise ? 1 << 3 : 0);
  if (option === 0) throw new RangeError('Select at least one Bambu calibration.');
  return option;
}

/** Converts Bambu's reported 0-15 fan scale into the percentage shown in UI. */
export function bambuFanPercent(value: unknown): number | undefined {
  const raw = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.round((Math.max(0, Math.min(15, raw)) / 15) * 100);
}
