// Typed surface over the HelixBambuMqtt native module — Bambu Lab's LAN
// protocol, which is MQTT over TLS on 8883 rather than Moonraker.
//
// This layer owns the wire vocabulary (topics live in Kotlin, payloads live
// here) and nothing else. Mapping Bambu's report JSON onto the Klipper-shaped
// status the dashboard already consumes is a separate concern.
//
// Payload shapes verified against crysxd/OctoApp-Plugin (AGPL-3.0).
// crabcore

import { DeviceEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';
import {
  classifyBambuConnectionFailure,
  type BambuConnectFailureReason,
} from './bambuConnection';
import {
  buildBambuCalibrationOption,
  type BambuCalibrationOptions,
} from './bambuControls';

interface BambuMqttNativeModule {
  connect(config: { host: string; port?: number; serial: string; accessCode: string }): Promise<void>;
  disconnect(): Promise<void>;
  probeStatus(config: BambuConnectionConfig): Promise<string>;
  publish(payload: string): Promise<void>;
  uploadPrintArtifact(config: BambuPrintArtifactRequest): Promise<BambuPrintArtifactResult>;
  startProjectFile(config: BambuProjectFileRequest): Promise<void>;
  startCamera(config: { host: string; serial: string; accessCode: string }): Promise<string>;
  stopCamera(): Promise<void>;
}

const nativeModule = NativeModules.HelixBambuMqtt as BambuMqttNativeModule | undefined;

/** Bambu printers always listen here; there is no user-configurable port. */
export const BAMBU_MQTT_PORT = 8883;

export interface BambuConnectionConfig {
  /** LAN address. Bambu has no mDNS name Helix can rely on, so this is an IP. */
  host: string;
  /** Printed on the machine and in Bambu Studio; also the MQTT topic segment. */
  serial: string;
  /** LAN access code from the printer's network settings. Grants full control. */
  accessCode: string;
}

export interface BambuPrintArtifactRequest extends BambuConnectionConfig {
  gcodePath: string;
  remoteName: string;
  usedToolMask: number;
  predictionSeconds: number;
  weightGrams: number;
  filamentType: string;
  filamentColor: string;
}

export interface BambuPrintArtifactResult {
  remoteName: string;
  verifiedBytes: number;
  archiveMd5: string;
  gcodeMd5: string;
  objects: BambuPrintableObject[];
}

export interface BambuPrintableObject {
  identifyId: number;
  name: string;
}

export interface BambuPrintObjectJob {
  remoteName: string;
  objects: BambuPrintableObject[];
}

let lastUploadedObjectJob: BambuPrintObjectJob | null = null;

function normalizedBambuJobName(value: string): string {
  const leaf = value.trim().replace(/\\/g, '/').split('/').pop() ?? '';
  return leaf
    .replace(/\.gcode\.3mf$/i, '')
    .replace(/\.3mf$/i, '')
    .replace(/\.gcode$/i, '')
    .trim()
    .toLowerCase();
}

/** Object IDs are valid only for the exact artifact that supplied them. */
export function bambuObjectsForJob(activeJobName: string): BambuPrintableObject[] {
  const active = normalizedBambuJobName(activeJobName);
  const uploaded = lastUploadedObjectJob;
  if (!active || !uploaded || normalizedBambuJobName(uploaded.remoteName) !== active) return [];
  return uploaded.objects;
}

export interface BambuProjectFileRequest {
  remoteName: string;
  subtaskName: string;
  archiveMd5: string;
  /** Zero-based file tool -> zero-based global AMS lane. */
  toolToLane: Record<number, number>;
  bedType: string;
  useAms: boolean;
  bedLeveling: boolean;
  flowCalibration: boolean;
  timelapse: boolean;
  vibrationCalibration: boolean;
}

export type BambuConnectionState = 'connected' | 'disconnected';

export interface BambuStateEvent {
  state: BambuConnectionState;
  message: string | null;
}

/**
 * Why a connect attempt failed, in terms a settings screen can act on. The
 * native layer decides these — all three failure modes were confirmed against a
 * real P1S rather than inferred, so there is no message-sniffing here.
 */
export type BambuConnectError = BambuConnectFailureReason;

export class BambuError extends Error {
  readonly reason: BambuConnectError;

  constructor(reason: BambuConnectError, message: string) {
    super(message);
    this.name = 'BambuError';
    this.reason = reason;
  }
}

/** Android-only for now; the iOS build has no Bambu transport yet. */
export function isBambuTransportAvailable(): boolean {
  return Platform.OS === 'android' && !!nativeModule;
}

function toBambuError(error: unknown): BambuError {
  if (error instanceof BambuError) return error;
  const failure = classifyBambuConnectionFailure(error);
  return new BambuError(failure.reason, failure.message);
}

export async function connectBambu(config: BambuConnectionConfig): Promise<void> {
  if (!nativeModule) {
    throw new BambuError('unavailable', 'Bambu printers need the Android build of Helix.');
  }

  try {
    await nativeModule.connect({
      host: config.host.trim(),
      port: BAMBU_MQTT_PORT,
      serial: config.serial.trim(),
      accessCode: config.accessCode.trim(),
    });
  } catch (error: unknown) {
    throw toBambuError(error);
  }
}

export async function disconnectBambu(): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.disconnect().catch(() => {});
}

/** Performs one bounded, read-only status request without changing the active printer. */
export async function probeBambuStatus(
  config: BambuConnectionConfig
): Promise<Record<string, any>> {
  if (!nativeModule) {
    throw new BambuError('unavailable', 'Bambu printers need the Android build of Helix.');
  }

  let payload: string;
  try {
    payload = await nativeModule.probeStatus({
      host: config.host.trim(),
      serial: config.serial.trim(),
      accessCode: config.accessCode.trim(),
    });
  } catch (error: unknown) {
    throw toBambuError(error);
  }
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BambuError('unknown', 'The Bambu printer returned an invalid status report.');
  }
  return parsed as Record<string, any>;
}

/** Uploads a validated single-filament P1S archive; it does not start printing. */
export async function uploadBambuPrintArtifact(
  request: BambuPrintArtifactRequest
): Promise<BambuPrintArtifactResult> {
  if (!nativeModule) {
    throw new BambuError('unavailable', 'Bambu printers need the Android build of Helix.');
  }
  const result = await nativeModule.uploadPrintArtifact({
    ...request,
    host: request.host.trim(),
    serial: request.serial.trim(),
    accessCode: request.accessCode.trim(),
    gcodePath: request.gcodePath.trim(),
    remoteName: request.remoteName.trim(),
    filamentType: request.filamentType.trim(),
    filamentColor: request.filamentColor.trim(),
  });
  const objects = result.objects
    .filter(
      (item) =>
        Number.isSafeInteger(item?.identifyId) &&
        item.identifyId >= 0 &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0
    )
    .slice(0, 64)
    .map((item) => ({ identifyId: item.identifyId, name: item.name.trim() }));
  lastUploadedObjectJob = { remoteName: result.remoteName, objects };
  return { ...result, objects };
}

/** Starts an uploaded project and resolves only after the matching printer acknowledgement. */
export async function startBambuProjectFile(request: BambuProjectFileRequest): Promise<void> {
  if (!nativeModule) {
    throw new BambuError('unavailable', 'Bambu printers need the Android build of Helix.');
  }
  await nativeModule.startProjectFile({
    ...request,
    remoteName: request.remoteName.trim(),
    subtaskName: request.subtaskName.trim(),
    archiveMd5: request.archiveMd5.trim().toUpperCase(),
    bedType: request.bedType.trim(),
  });
}

// Bambu echoes sequence_id back on responses. Nothing in Helix correlates them
// yet, but reusing a constant makes the printer's own logs useless, so count.
let sequenceId = 0;

function nextSequenceId(): string {
  sequenceId += 1;
  return String(sequenceId);
}

async function publish(payload: Record<string, unknown>): Promise<void> {
  if (!nativeModule) {
    throw new BambuError('unavailable', 'Not connected to a Bambu printer.');
  }
  await nativeModule.publish(JSON.stringify(payload));
}

/**
 * Ask for a complete state dump. Bambu only pushes deltas after the first
 * report, so without this a freshly connected client sees almost nothing.
 */
export function requestBambuFullState(): Promise<void> {
  return publish({ pushing: { sequence_id: nextSequenceId(), command: 'pushall' } });
}

/** Firmware and module versions, which the report feed never includes. */
export function requestBambuVersion(): Promise<void> {
  return publish({ info: { sequence_id: nextSequenceId(), command: 'get_version' } });
}

/**
 * Runs a raw G-code line. Bambu accepts these over MQTT, which is what lets the
 * existing console and macro buttons work against a Bambu printer. The trailing
 * newline is required — the firmware ignores a line without it.
 */
export function sendBambuGcode(line: string): Promise<void> {
  return publish({
    print: { sequence_id: nextSequenceId(), command: 'gcode_line', param: `${line}\n` },
  });
}

export function pauseBambuPrint(): Promise<void> {
  return publish({ print: { sequence_id: nextSequenceId(), command: 'pause' } });
}

export function resumeBambuPrint(): Promise<void> {
  return publish({ print: { sequence_id: nextSequenceId(), command: 'resume' } });
}

export function stopBambuPrint(): Promise<void> {
  return publish({ print: { sequence_id: nextSequenceId(), command: 'stop' } });
}

/** Permanently excludes the selected objects from the running Bambu job. */
export function skipBambuObjects(objectIds: number[]): Promise<void> {
  const ids = [...new Set(objectIds)];
  if (ids.length === 0 || ids.length > 63 || ids.some((id) => !Number.isSafeInteger(id) || id < 0)) {
    throw new RangeError('Choose between 1 and 63 valid Bambu object IDs.');
  }
  return publish({
    print: { sequence_id: nextSequenceId(), command: 'skip_objects', obj_list: ids },
  });
}

/** Acknowledges the printer's active HMS/print-error dialog. */
export function clearBambuErrors(): Promise<void> {
  return publish({ print: { sequence_id: nextSequenceId(), command: 'clean_print_error' } });
}

export function startBambuCalibration(options: BambuCalibrationOptions): Promise<void> {
  return publish({
    print: {
      sequence_id: nextSequenceId(),
      command: 'calibration',
      option: buildBambuCalibrationOption(options),
    },
  });
}

/**
 * Loads a tray into the hotend, by the global index bambuTrays() produces
 * (unit 0 owns 0-3, unit 1 owns 4-7). Pass null to unload.
 *
 * The temperatures matter: the printer uses them to soften the outgoing
 * filament, and sending nothing makes it refuse the swap. Callers should take
 * them from the tray's own nozzle_temp_min/max.
 */
export function changeBambuFilament(
  trayIndex: number | null,
  nozzleTemperature: number
): Promise<void> {
  const target = trayIndex ?? BAMBU_UNLOAD_TARGET;
  return publish({
    print: {
      sequence_id: nextSequenceId(),
      command: 'ams_change_filament',
      target,
      curr_temp: nozzleTemperature,
      tar_temp: nozzleTemperature,
    },
  });
}

/** 255 tells the AMS to unload rather than load a slot. */
const BAMBU_UNLOAD_TARGET = 255;

/**
 * Answers the "filament change" prompt the printer raises mid-swap. Without
 * this the machine sits waiting for someone to press its own screen.
 */
export function controlBambuAms(action: 'resume' | 'pause' | 'reset'): Promise<void> {
  return publish({
    print: { sequence_id: nextSequenceId(), command: 'ams_control', param: action },
  });
}

export interface BambuFilamentSetting {
  /** Zero-based AMS unit, or 255 for the single external holder. */
  unit: number;
  /** Zero-based AMS tray, or the external holder's global id 254. */
  tray: number;
  /** BambuStudio includes slot_id=0 for external-spool edits. */
  slot?: number;
  /** Bambu's filament id, e.g. "GFA00" for Bambu PLA Basic. */
  filamentId: string;
  type: string;
  /** 8-digit RGBA hex, no leading '#'. */
  colorRgba: string;
  nozzleTempMin: number;
  nozzleTempMax: number;
}

/** Tells the printer what is in an editable AMS tray or external holder. */
export function setBambuFilament(setting: BambuFilamentSetting): Promise<void> {
  return publish({
    print: {
      sequence_id: nextSequenceId(),
      command: 'ams_filament_setting',
      ams_id: setting.unit,
      tray_id: setting.tray,
      ...(setting.slot == null ? {} : { slot_id: setting.slot }),
      tray_info_idx: setting.filamentId,
      tray_type: setting.type,
      tray_color: setting.colorRgba.replace(/^#/, '').toUpperCase(),
      nozzle_temp_min: setting.nozzleTempMin,
      nozzle_temp_max: setting.nozzleTempMax,
    },
  });
}

export function setBambuChamberLight(on: boolean): Promise<void> {
  return publish({
    system: {
      sequence_id: nextSequenceId(),
      command: 'ledctrl',
      led_node: 'chamber_light',
      led_mode: on ? 'on' : 'off',
      // Required by the firmware even for a plain on/off; they only take
      // effect for the flashing modes.
      led_on_time: 500,
      led_off_time: 500,
      loop_times: 0,
      interval_time: 0,
    },
  });
}

/** Bambu's four speed presets: silent, standard, sport, ludicrous. */
export type BambuSpeedPreset = 1 | 2 | 3 | 4;

export function setBambuSpeed(preset: BambuSpeedPreset): Promise<void> {
  return publish({
    print: { sequence_id: nextSequenceId(), command: 'print_speed', param: String(preset) },
  });
}

/**
 * Opens the chamber camera and resolves a local MJPEG URL.
 *
 * The P-series serves neither RTSP nor anything a WebView can open — port 6000
 * speaks a private protocol — so the native layer republishes the frames on
 * loopback. The URL drops straight into CameraFeed like a Moonraker webcam.
 *
 * Resolves only once a frame has genuinely arrived, so the caller never gets a
 * URL that shows nothing.
 */
export async function startBambuCamera(config: BambuConnectionConfig): Promise<string> {
  if (!nativeModule) {
    throw new BambuError('unavailable', 'Bambu printers need the Android build of Helix.');
  }

  try {
    return await nativeModule.startCamera({
      host: config.host.trim(),
      serial: config.serial.trim(),
      accessCode: config.accessCode.trim(),
    });
  } catch (error: unknown) {
    throw toBambuError(error);
  }
}

export async function stopBambuCamera(): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.stopCamera().catch(() => {});
}

/**
 * Raw report payloads, already JSON-parsed. Bambu sends both full dumps and
 * partial deltas over the same topic with no flag distinguishing them, so
 * consumers must merge rather than replace.
 */
export function onBambuMessage(
  callback: (report: Record<string, any>) => void
): EmitterSubscription {
  return DeviceEventEmitter.addListener('HelixBambuMessage', (event: { payload: string }) => {
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(event.payload);
    } catch {
      // A malformed report is not worth tearing the connection down over.
      return;
    }
    callback(parsed);
  });
}

/**
 * Fires when the printer's video stream ends. The URL from startBambuCamera is
 * dead at that point, so listeners should drop it and reopen rather than leave
 * a pane pointing at a port nothing is serving.
 */
export function onBambuCameraStopped(callback: () => void): EmitterSubscription {
  return DeviceEventEmitter.addListener('HelixBambuCameraStopped', callback);
}

export function onBambuState(
  callback: (event: BambuStateEvent) => void
): EmitterSubscription {
  return DeviceEventEmitter.addListener('HelixBambuState', callback);
}
