import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import type { NativeMaterialProfile } from './filamentProfiles';

export type NativeSlicerStatus = {
  platform: string;
  available: boolean;
  loaded: boolean;
  coreVersion: string | null;
  loadError: string | null;
  coreError: string | null;
};

export type SharedMakerWorldLink = {
  action: string | null;
  rawText: string | null;
  makerWorldUrl: string | null;
  hasMakerWorldUrl: boolean;
};

export type SharedModelFile = {
  fileName: string;
  filePath: string;
  sizeBytes: number;
};

export type ModelPlate = {
  id: number;
  name: string;
  objectCount: number;
  thumbnail: string | null;
};

/** Embedded slice stats from a plate's baked-in G-code (Bambu/Orca 3MFs). */
export type ModelPlateStats = {
  id: number;
  layers: number;
  timeSeconds: number;
  grams: number;
};

export type ExtractedPlate = {
  filePath: string;
  fileName: string;
  objectCount: number;
};

export type SliceOptions = {
  layerHeight?: number;
  fillDensity?: number; // 0..1
  nozzleTemp?: number;
  bedTemp?: number;
  supportEnabled?: boolean;
  supportType?: string;
  supportAngle?: number;
  supportFilament?: number;
  supportInterfaceFilament?: number;
  supportBuildPlateOnly?: boolean;
  supportPattern?: string;
  brimWidth?: number;
  skirtLoops?: number;
  initialTool?: number;
  // Re-slice support: full prepare-screen settings + loaded-slot material
  // profiles (both JSON strings produced by the native side). When present
  // the native sliceFile replays them so a background re-slice is faithful.
  sliceSettings?: string;
  materialProfiles?: string;
  // Per-colour remap: forces configureMultiTool to size the extruder array to
  // cover every mapped slot, even when the file declares fewer filaments.
  forceExtruderCount?: number;
};

export type NativeSliceResult = {
  success: boolean;
  cancelled?: boolean;
  errorMessage: string;
  gcodePath: string;
  modelPath?: string;
  thumbnailsInjected?: boolean;
  totalLayers: number;
  estimatedTimeSeconds: number;
  estimatedFilamentGrams: number;
  initialTool?: number;
  usedToolMask?: number;
  sliceSettings?: string;
  materialProfiles?: string;
};

export type MakerWorldCookies = {
  cookies: string;
  hasAuth: boolean;
  length: number;
};

export type NativeMakerWorldDownload = {
  designId: string | null;
  instanceId: string | null;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  sourceUrl?: string | null;
};

export type NativeGcodeUpload = {
  filename: string;
  path: string;
  sizeBytes: number;
  status: number;
  body: string;
};

export type NativeFilamentSlot = {
  color: string;
  material: string;
  mainType: string;
  subType: string;
  brand: string;
  status: string;
};

type HelixSlicerModule = {
  getStatus: () => Promise<NativeSlicerStatus>;
  getSharedLink: () => Promise<SharedMakerWorldLink>;
  getSharedModelFile: () => Promise<SharedModelFile | null>;
  takePrintSentNotice: () => Promise<string | null>;
  pickModelFile: () => Promise<SharedModelFile>;
  getModelPlates: (path: string) => Promise<ModelPlate[]>;
  getModelPlateStats: (path: string) => Promise<ModelPlateStats[]>;
  extractPlate: (path: string, plateId: number) => Promise<ExtractedPlate>;
  collapseModel: (path: string, targetTool: number) => Promise<string>;
  remapModel: (path: string, extruderMapJson: string) => Promise<string>;
  sliceFile: (path: string, options: SliceOptions | null) => Promise<NativeSliceResult>;
  cancelSlice: () => Promise<boolean>;
  captureMakerWorldCookies: () => Promise<MakerWorldCookies>;
  getMakerWorldCookies: () => Promise<MakerWorldCookies>;
  getMakerWorldCookieDebug: () => Promise<MakerWorldCookieDebug>;
  saveMakerWorldBearer: (jwt: string) => Promise<boolean>;
  clearMakerWorldCookies: () => Promise<boolean>;
  downloadMakerWorld: (shareUrl: string) => Promise<NativeMakerWorldDownload>;
  openMakerWorldDownloader: (
    designId: string,
    instanceId: string | null,
    startUrl: string | null
  ) => Promise<NativeMakerWorldDownload>;
  openModelPreview: (
    path: string,
    title: string | null,
    slotColors: string[] | null,
    accentColor: string | null,
    moonrakerUrl: string | null,
    initialTool: number,
    loadedToolMask: number,
    autoArrange: boolean,
    materialProfilesJson: string | null,
  ) => Promise<boolean>;
  openGcodePreview: (
    path: string,
    title: string | null,
    accentColor: string | null,
    moonrakerUrl: string | null,
    initialTool: number,
    loadedToolMask: number,
    usedToolMask: number
  ) => Promise<boolean>;
  setFilamentSlotColors: (colors: string[]) => Promise<boolean>;
  setFilamentSlots?: (slots: NativeFilamentSlot[]) => Promise<boolean>;
  setPrinters: (printers: { name: string; url: string; tailscaleUrl?: string }[]) => Promise<boolean>;
  getLastSliceResult: () => Promise<NativeSliceResult | null>;
  getGcodeThumbnail: (path: string) => Promise<string | null>;
  getGcodeFilamentGrams: (path: string) => Promise<number[]>;
  clearLastSlice: () => Promise<boolean>;
  prepareTimelapseGcode: (path: string) => Promise<string>;
  uploadGcode: (baseUrl: string, filename: string, path: string) => Promise<NativeGcodeUpload>;
};

export type MakerWorldCookieDebug = {
  storedLength: number;
  liveLength: number;
  storedHasToken: boolean;
  liveHasToken: boolean;
  storedNames: string;
  liveNames: string;
  bearerLength: number;
  hasBearer: boolean;
};

const nativeModule = NativeModules.HelixSlicer as HelixSlicerModule | undefined;

export async function getNativeSlicerStatus(): Promise<NativeSlicerStatus> {
  if (Platform.OS !== 'android') {
    return {
      platform: Platform.OS,
      available: false,
      loaded: false,
      coreVersion: null,
      loadError: 'Android only in this lab build.',
      coreError: null,
    };
  }

  if (!nativeModule) {
    return {
      platform: 'android',
      available: false,
      loaded: false,
      coreVersion: null,
      loadError: 'HelixSlicer native module is not registered.',
      coreError: null,
    };
  }

  return nativeModule.getStatus();
}

export async function getSharedMakerWorldLink(): Promise<SharedMakerWorldLink> {
  if (Platform.OS !== 'android' || !nativeModule) {
    return {
      action: null,
      rawText: null,
      makerWorldUrl: null,
      hasMakerWorldUrl: false,
    };
  }

  return nativeModule.getSharedLink();
}

/**
 * If the app was opened by tapping a .3mf/.stl (or receiving one via share),
 * copies it into app storage and returns its path. Null when there's nothing to
 * open. Imports only once per launch intent (native marks it consumed).
 */
export async function getSharedModelFile(): Promise<SharedModelFile | null> {
  if (Platform.OS !== 'android' || !nativeModule) return null;
  try {
    return await nativeModule.getSharedModelFile();
  } catch {
    return null;
  }
}

export async function takeNativePrintSentNotice(): Promise<string | null> {
  if (Platform.OS !== 'android' || !nativeModule) return null;
  return nativeModule.takePrintSentNotice();
}

/** Opens the system file picker for .3mf / .stl and imports into app storage. */
export async function pickModelFile(): Promise<SharedModelFile> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Model upload is Android-only in this build.');
  }
  return nativeModule.pickModelFile();
}

/**
 * Lists the plates in a multi-plate Bambu/Orca 3MF. Empty for single-plate
 * files and STLs (JS shows the picker only when length > 1).
 */
export async function getModelPlates(path: string): Promise<ModelPlate[]> {
  if (Platform.OS !== 'android' || !nativeModule) return [];
  try {
    return await nativeModule.getModelPlates(path.replace(/^file:\/\//, ''));
  } catch {
    return [];
  }
}

/**
 * Per-plate layer/time/filament stats parsed from the G-code embedded in a
 * Bambu/Orca 3MF — real numbers for a picked file before any in-app slicing.
 * Empty for geometry-only 3MFs and STLs.
 */
export async function getModelPlateStats(path: string): Promise<ModelPlateStats[]> {
  if (Platform.OS !== 'android' || !nativeModule) return [];
  try {
    return await nativeModule.getModelPlateStats(path.replace(/^file:\/\//, ''));
  } catch {
    return [];
  }
}

/** Repacks one plate of a multi-plate 3MF into its own temp file. */
export async function extractModelPlate(path: string, plateId: number): Promise<ExtractedPlate> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Plate extraction is Android-only.');
  }
  return nativeModule.extractPlate(path.replace(/^file:\/\//, ''), plateId);
}

/**
 * Repacks a model 3MF into a temp file where every object is reassigned to
 * [targetTool] (0-based) and the multi-filament project config is dropped, so a
 * re-slice produces single-tool gcode in that one loaded material. Used to
 * "print everything in [chosen material]" for multi-color files. Accepts file://.
 */
export async function collapseModelToTool(uriOrPath: string, targetTool: number): Promise<string> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Model collapse is Android-only.');
  }
  return nativeModule.collapseModel(uriOrPath.replace(/^file:\/\//, ''), targetTool);
}

/**
 * Repacks a 3MF so each object's extruder is routed to a user-chosen loaded slot,
 * KEEPING the file multi-filament so the re-slice stays multi-colour (per-colour
 * remap). extruderMap keys are 1-based source extruder values, values are 0-based
 * target ACE slots. Accepts file://.
 */
export async function remapModelExtruders(
  uriOrPath: string,
  extruderMap: Record<number, number>,
): Promise<string> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Model remap is Android-only.');
  }
  return nativeModule.remapModel(uriOrPath.replace(/^file:\/\//, ''), JSON.stringify(extruderMap));
}

export type ExtractProgress = { percent: number; phase: string };

/**
 * Subscribes to native "extractProgress" events emitted while a plate is being
 * repacked (byte-counted over the two streaming passes). Returns an EmitterSubscription
 * (call .remove() when done).
 */
export function addExtractProgressListener(cb: (p: ExtractProgress) => void) {
  return DeviceEventEmitter.addListener('extractProgress', cb);
}

/**
 * Slices an STL/3MF with the native engine. Accepts a file:// uri or plain path.
 * onProgress receives native "HelixSliceProgress" events while the slice runs.
 */
export async function sliceModelFile(
  uriOrPath: string,
  options: SliceOptions | null,
  onProgress?: (percentage: number, stage: string) => void
): Promise<NativeSliceResult> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Native slicer is Android-only in this lab build.');
  }
  const path = uriOrPath.replace(/^file:\/\//, '');
  const sub = onProgress
    ? DeviceEventEmitter.addListener('HelixSliceProgress', (e: { percentage: number; stage: string }) =>
        onProgress(e.percentage, e.stage)
      )
    : null;
  try {
    return await nativeModule.sliceFile(path, options);
  } finally {
    sub?.remove();
  }
}

export async function cancelNativeSlice(): Promise<void> {
  if (Platform.OS === 'android' && nativeModule) await nativeModule.cancelSlice();
}

const NO_COOKIES: MakerWorldCookies = { cookies: '', hasAuth: false, length: 0 };

/** Reads live WebView cookies (post-login), persists them encrypted, returns them. */
export async function captureMakerWorldCookies(): Promise<MakerWorldCookies> {
  if (Platform.OS !== 'android' || !nativeModule) return NO_COOKIES;
  return nativeModule.captureMakerWorldCookies();
}

/** Returns the stored (decrypted) MakerWorld cookies for attaching to downloads. */
export async function getMakerWorldCookies(): Promise<MakerWorldCookies> {
  if (Platform.OS !== 'android' || !nativeModule) return NO_COOKIES;
  return nativeModule.getMakerWorldCookies();
}

export async function clearMakerWorldCookies(): Promise<void> {
  if (Platform.OS === 'android' && nativeModule) await nativeModule.clearMakerWorldCookies();
}

const NO_DEBUG: MakerWorldCookieDebug = {
  storedLength: 0,
  liveLength: 0,
  storedHasToken: false,
  liveHasToken: false,
  storedNames: '',
  liveNames: '',
  bearerLength: 0,
  hasBearer: false,
};

export async function getMakerWorldCookieDebug(): Promise<MakerWorldCookieDebug> {
  if (Platform.OS !== 'android' || !nativeModule) return NO_DEBUG;
  return nativeModule.getMakerWorldCookieDebug();
}

/** Stores the MakerWorld API JWT captured from the web app's localStorage. */
export async function saveMakerWorldBearer(jwt: string): Promise<void> {
  if (Platform.OS === 'android' && nativeModule) await nativeModule.saveMakerWorldBearer(jwt);
}

/**
 * Downloads a MakerWorld model natively (OkHttp + stored cookie). More reliable
 * than JS fetch, which mangles a manual Cookie header on Android.
 */
export async function downloadMakerWorldNative(shareUrl: string): Promise<NativeMakerWorldDownload> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Native MakerWorld download is Android-only in this lab build.');
  }
  return nativeModule.downloadMakerWorld(shareUrl);
}

/**
 * Opens Android's real WebView downloader. The user taps MakerWorld's own
 * Download button, GeeTest runs in the browser, then Android's download
 * listener saves the STL/3MF into app storage and returns the absolute path.
 */
export async function openMakerWorldDownloader(
  designId: string,
  instanceId: string | null,
  startUrl: string | null
): Promise<NativeMakerWorldDownload> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Native MakerWorld downloader is Android-only in this lab build.');
  }
  return nativeModule.openMakerWorldDownloader(designId, instanceId, startUrl);
}

export async function openNativeModelPreview(
  path: string,
  title?: string | null,
  slotColors?: string[],
  accentColor?: string | null,
  moonrakerUrl?: string | null,
  initialTool = 0,
  loadedToolMask = -1,
  autoArrange = false,
  materialProfiles?: NativeMaterialProfile[],
): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Native 3D preview is Android-only in this lab build.');
  }
  const colors = slotColors?.length ? slotColors : null;
  await nativeModule.openModelPreview(
    path.replace(/^file:\/\//, ''),
    title ?? null,
    colors,
    accentColor ?? null,
    moonrakerUrl ?? null,
    initialTool,
    loadedToolMask,
    autoArrange,
    materialProfiles ? JSON.stringify(materialProfiles) : null,
  );
}

/** Persists the user's four filament-slot colours for native paint/preview. */
export async function setFilamentSlotColors(colors: string[]): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) return;
  await nativeModule.setFilamentSlotColors(colors);
}

/**
 * Pushes the full per-slot filament picture (colour + material/mainType/subType/
 * brand/status) into native SharedPreferences so the print preprocess sheet can
 * label each lane exactly as the RN slicer does. Falls back to colours-only on
 * older native builds that predate setFilamentSlots.
 */
export async function setFilamentSlots(slots: NativeFilamentSlot[]): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) return;
  try {
    await nativeModule.setFilamentSlots?.(slots);
  } catch {
    try {
      await nativeModule.setFilamentSlotColors?.(slots.map((s) => s.color));
    } catch {
      // Colour-only mirror also unavailable — native defaults stand.
    }
  }
}

/** Mirrors the saved printers into native prefs for the print dialog's picker. */
export async function setNativePrinters(printers: { name: string; url: string; tailscaleUrl?: string }[]): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) return;
  try {
    await nativeModule.setPrinters(printers);
  } catch {
    // Older native build without setPrinters — dialog just hides the picker.
  }
}

export async function getLastSliceResult(): Promise<NativeSliceResult | null> {
  if (Platform.OS !== 'android' || !nativeModule) return null;
  const raw = await nativeModule.getLastSliceResult();
  if (!raw?.success || !raw.gcodePath) return null;
  return {
    success: true,
    cancelled: false,
    errorMessage: '',
    gcodePath: raw.gcodePath,
    modelPath: raw.modelPath,
    totalLayers: raw.totalLayers,
    estimatedTimeSeconds: raw.estimatedTimeSeconds,
    estimatedFilamentGrams: raw.estimatedFilamentGrams,
    initialTool: raw.initialTool,
    usedToolMask: raw.usedToolMask,
    sliceSettings: raw.sliceSettings,
    materialProfiles: raw.materialProfiles,
  };
}

export async function clearLastSlice(): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) return;
  await nativeModule.clearLastSlice();
}

/** Pulls the embedded render thumbnail out of a local sliced .gcode as a data: URI. */
export async function getGcodeThumbnail(path: string): Promise<string | null> {
  if (Platform.OS !== 'android' || !nativeModule) return null;
  try {
    return await nativeModule.getGcodeThumbnail(path.replace(/^file:\/\//, ''));
  } catch {
    return null;
  }
}

/** Per-filament weights (g) parsed from a sliced .gcode; [] when unavailable. */
export async function getGcodeFilamentGrams(path: string): Promise<number[]> {
  if (Platform.OS !== 'android' || !nativeModule) return [];
  try {
    return await nativeModule.getGcodeFilamentGrams(path.replace(/^file:\/\//, ''));
  } catch {
    return [];
  }
}

/** Opens the native 3D G-code toolpath preview for a sliced .gcode file. */
export async function openNativeGcodePreview(
  path: string,
  title?: string | null,
  accentColor?: string | null,
  moonrakerUrl?: string | null,
  initialTool = 0,
  loadedToolMask = -1,
  usedToolMask = -1
): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Native G-code preview is Android-only in this lab build.');
  }
  await nativeModule.openGcodePreview(
    path.replace(/^file:\/\//, ''),
    title ?? null,
    accentColor ?? null,
    moonrakerUrl ?? null,
    initialTool,
    loadedToolMask,
    usedToolMask,
  );
}

/** Uploads a sliced gcode file into Moonraker's gcodes root. */
/**
 * Injects moonraker-timelapse frame-capture macros into a sliced gcode so the
 * printer actually records a timelapse. The native slicer only emits
 * `;LAYER_CHANGE` markers — PAXX firmware captures nothing on its own (its
 * timelapse component is a stub), so the gcode itself must call the macros:
 * `TIMELAPSE_START` before the first layer, `TIMELAPSE_TAKE_FRAME` after every
 * `;LAYER_CHANGE`, and `TIMELAPSE_STOP` at the end. Writes the modified gcode to
 * the cache dir and returns its path. Existing executable timelapse commands
 * are normalized so profile metadata cannot produce duplicate start/stop calls.
 * Returns the original path unchanged when it is already normalized or there
 * are no layer-change anchors.
 */
export async function injectTimelapseMacros(gcodePath: string): Promise<string> {
  if (Platform.OS === 'android' && nativeModule) {
    return nativeModule.prepareTimelapseGcode(gcodePath.replace(/^file:\/\//, ''));
  }

  const FileSystem = await import('expo-file-system/legacy');
  const uri = gcodePath.startsWith('file://') ? gcodePath : `file://${gcodePath}`;
  const content = await FileSystem.readAsStringAsync(uri);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const startCommand = /^\s*TIMELAPSE_START(?:\s+.*)?$/i;
  const stopCommand = /^\s*TIMELAPSE_STOP(?:\s+.*)?$/i;
  const takeFrameCommand = /^\s*TIMELAPSE_TAKE_FRAME(?:\s+.*)?$/i;
  const isLayerChange = (line: string) => /^;LAYER_CHANGE(?:\s.*)?$/i.test(line);
  const layerCount = lines.filter(isLayerChange).length;
  if (layerCount === 0) return gcodePath;

  const hasStart = lines.some((line) => startCommand.test(line));
  const hasStop = lines.some((line) => stopCommand.test(line));
  const framesAlreadyNormalized = lines.every((line, index) =>
    !isLayerChange(line) || takeFrameCommand.test(lines[index + 1] ?? '')
  );
  if (hasStart && hasStop && framesAlreadyNormalized) return gcodePath;

  const withoutFrames = lines.filter((line) => !takeFrameCommand.test(line));
  const out: string[] = [];
  let startWritten = hasStart;
  for (const line of withoutFrames) {
    if (isLayerChange(line) && !startWritten) {
      out.push('TIMELAPSE_START');
      startWritten = true;
    }
    out.push(line);
    if (isLayerChange(line)) out.push('TIMELAPSE_TAKE_FRAME');
  }
  if (!hasStop) out.push('TIMELAPSE_STOP');

  const base = uri.split('/').pop() || 'print.gcode';
  const outPath = `${FileSystem.cacheDirectory}tl_${base}`;
  await FileSystem.writeAsStringAsync(outPath, out.join(eol));
  return outPath;
}

export async function uploadGcodeToPrinter(
  base: string,
  filename: string,
  gcodePath: string
): Promise<NativeGcodeUpload | void> {
  if (Platform.OS === 'android' && nativeModule) {
    return nativeModule.uploadGcode(base, filename, gcodePath.replace(/^file:\/\//, ''));
  }

  const form = new FormData();
  form.append('root', 'gcodes');
  form.append('file', {
    uri: gcodePath.startsWith('file://') ? gcodePath : `file://${gcodePath}`,
    name: filename,
    type: 'text/plain',
  } as any);
  const res = await fetch(`${base}/server/files/upload`, { method: 'POST', body: form });
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
}
