import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

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

type HelixSlicerModule = {
  getStatus: () => Promise<NativeSlicerStatus>;
  getSharedLink: () => Promise<SharedMakerWorldLink>;
  getSharedModelFile: () => Promise<SharedModelFile | null>;
  pickModelFile: () => Promise<SharedModelFile>;
  getModelPlates: (path: string) => Promise<ModelPlate[]>;
  extractPlate: (path: string, plateId: number) => Promise<ExtractedPlate>;
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
    autoArrange: boolean
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
  setPrinters: (printers: { name: string; url: string }[]) => Promise<boolean>;
  getLastSliceResult: () => Promise<NativeSliceResult | null>;
  getGcodeThumbnail: (path: string) => Promise<string | null>;
  getGcodeFilamentGrams: (path: string) => Promise<number[]>;
  clearLastSlice: () => Promise<boolean>;
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

/** Repacks one plate of a multi-plate 3MF into its own temp file. */
export async function extractModelPlate(path: string, plateId: number): Promise<ExtractedPlate> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Plate extraction is Android-only.');
  }
  return nativeModule.extractPlate(path.replace(/^file:\/\//, ''), plateId);
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
  autoArrange = false
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
  );
}

/** Persists the user's four filament-slot colours for native paint/preview. */
export async function setFilamentSlotColors(colors: string[]): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule) return;
  await nativeModule.setFilamentSlotColors(colors);
}

/** Mirrors the saved printers into native prefs for the print dialog's picker. */
export async function setNativePrinters(printers: { name: string; url: string }[]): Promise<void> {
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
