import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, spacing } from '../../constants/theme';
import {
  clearLastSlice,
  extractModelPlate,
  getGcodeFilamentGrams,
  getGcodeThumbnail,
  getLastSliceResult,
  getMakerWorldCookies,
  getModelPlates,
  getNativeSlicerStatus,
  getSharedMakerWorldLink,
  ModelPlate,
  NativeMakerWorldDownload,
  NativeSliceResult,
  NativeSlicerStatus,
  openMakerWorldDownloader,
  openNativeGcodePreview,
  openNativeModelPreview,
  injectTimelapseMacros,
  pickModelFile,
  setFilamentSlotColors,
  setNativePrinters,
  SharedMakerWorldLink,
  uploadGcodeToPrinter,
  type SharedModelFile,
} from '../../services/nativeSlicer';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useACE } from '../../hooks/useACE';
import type { AceUnit } from '../../hooks/useACE';
import { useSettings } from '../../hooks/useSettings';
import FilamentSlotsEditor, { type FilamentSlotDisplay } from '../../components/FilamentSlotsEditor';
import { normalizeFilamentSlotColors } from '../../constants/filamentColors';
import { takeMwDownload } from '../../services/mwBus';
import { subscribePendingModel, takePendingModel } from '../../services/pendingModel';
import { setPrintSentNotice } from '../../services/printSentBus';
import PrintPreprocessDialog, { type PrintPref } from '../../components/PrintPreprocessDialog';
import { api, printerConnectionUrl, thumbnailUrl } from '../../services/moonraker';
import { resolveNativeMaterialProfiles } from '../../services/filamentProfiles';

const MW_DESIGN_RE = /(?:https?:\/\/)?(?:www\.)?makerworld\.com\/(?:\w+\/)?models\/(\d+)/i;
// The specific print profile/instance the user is viewing, e.g.
// ...#profileId-109644 or ...?profileId=109644 — this is the actual instance id
// to download (NOT the design's defaultInstanceId, which may be gated).
const MW_INSTANCE_RE = /profileId[-=](\d+)/i;

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; status: NativeSlicerStatus }
  | { state: 'error'; message: string };

type DownloadState =
  | { state: 'idle'; message: string }
  | { state: 'downloading'; message: string }
  | { state: 'success'; message: string; result: NativeMakerWorldDownload }
  | { state: 'error'; message: string };

type SliceState =
  | { state: 'idle' }
  | { state: 'slicing'; percentage: number; stage: string }
  | { state: 'success'; result: NativeSliceResult }
  | { state: 'error'; message: string };

type UploadState =
  | { state: 'idle' }
  | { state: 'uploading'; message: string }
  | { state: 'done'; message: string; filename: string; moonrakerPath: string; preview: UploadPreview; printerId: string }
  | { state: 'error'; message: string };

type UploadResult = Awaited<ReturnType<typeof uploadGcodeToPrinter>>;

type UploadPreview = {
  displayName: string;
  thumbnail: string | null;
};

type PrintStartState =
  | { state: 'idle' }
  | { state: 'starting'; message: string }
  | { state: 'done'; message: string }
  | { state: 'error'; message: string };

type ToolLoadStatus = 'loaded' | 'empty' | 'busy' | 'unknown';

type ToolLoadSlot = {
  index: number;
  status: ToolLoadStatus;
};

type ToolLoadInfo = {
  source: 'printer' | 'ace' | 'sensor' | 'unknown';
  slots: ToolLoadSlot[];
  firstLoaded: number | null;
  selectedTool: number;
  loadedToolMask: number;
  nativeLoadedToolMask: number;
  known: boolean;
  blockReason: string | null;
};

export default function SliceLabScreen() {
  const router = useRouter();
  const [result, setResult] = useState<LoadState>({ state: 'loading' });
  const [sharedLink, setSharedLink] = useState<SharedMakerWorldLink | null>(null);
  const [download, setDownload] = useState<DownloadState>({
    state: 'idle',
    message: 'Share a MakerWorld model link to start import.',
  });
  const [refreshing, setRefreshing] = useState(false);
  const [slice, setSlice] = useState<SliceState>({ state: 'idle' });
  const [upload, setUpload] = useState<UploadState>({ state: 'idle' });
  const [printStart, setPrintStart] = useState<PrintStartState>({ state: 'idle' });
  const [mwAuthed, setMwAuthed] = useState(false);
  const [plates, setPlates] = useState<ModelPlate[]>([]);
  const [selectedPlate, setSelectedPlate] = useState<{ id: number; path: string; name: string } | null>(null);
  const [platesFor, setPlatesFor] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [preprocessOpen, setPreprocessOpen] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [perToolGrams, setPerToolGrams] = useState<number[]>([]);
  const [printPrefs, setPrintPrefs] = useState<Record<PrintPref, boolean>>({
    flowCal: false,
    timelapse: false,
    autoLevel: false,
  });
  const handledUrlRef = useRef<string | null>(null);
  const awaitingInteractive = useRef(false);
  const { activeUrl, connection, status, objectList } = useMoonraker();
  const ace = useACE();
  const { settings, update: updateSettings, loaded: settingsLoaded } = useSettings();
  const toolLoad = useMemo(
    () => resolveToolLoad(status, objectList, ace.units, ace.hardwareDetected, connection),
    [status, objectList, ace.units, ace.hardwareDetected, connection],
  );
  const filamentSlots = useMemo(
    () => resolveFilamentSlots(
      status,
      settings.filamentSlotColors,
      settings.filamentSlotBrands,
      settings.filamentSlotMaterials,
      toolLoad,
    ),
    [status, settings.filamentSlotColors, settings.filamentSlotBrands, settings.filamentSlotMaterials, toolLoad],
  );
  const effectiveFilamentSlotColors = useMemo(
    () => filamentSlots.map((slot) => slot.color),
    [filamentSlots],
  );

  // Keep native paint/preview prefs aligned with the saved slot colours.
  useEffect(() => {
    if (!settingsLoaded) return;
    setFilamentSlotColors(effectiveFilamentSlotColors).catch(() => {});
  }, [settingsLoaded, effectiveFilamentSlotColors]);

  // Mirror the printer list for the native print dialog's printer picker.
  useEffect(() => {
    if (!settingsLoaded) return;
    setNativePrinters(
      settings.printers
        .map((p) => ({ name: p.name, url: printerConnectionUrl(p) }))
        .filter((p) => p.url),
    ).catch(() => {});
  }, [settingsLoaded, settings.printers]);

  const normalizePath = (p: string) => p.replace(/^file:\/\//, '');

  const syncLastSlice = useCallback(async (modelPath: string | null) => {
    if (!modelPath) return;
    try {
      const last = await getLastSliceResult();
      if (last && normalizePath(last.modelPath ?? '') === normalizePath(modelPath)) {
        setSlice({ state: 'success', result: last });
      }
    } catch {
      // Native bridge unavailable — ignore.
    }
  }, []);

  const applyOpenedFile = useCallback((openedFile: SharedModelFile) => {
    handledUrlRef.current = null;
    awaitingInteractive.current = false;
    clearLastSlice().catch(() => {});
    setSlice({ state: 'idle' });
    setUpload({ state: 'idle' });
    setPrintStart({ state: 'idle' });
    setPlates([]);
    setSelectedPlate(null);
    setPlatesFor(null);
    setDownload({
      state: 'success',
      message: `Opened ${openedFile.fileName}.`,
      result: {
        designId: null,
        instanceId: null,
        fileName: openedFile.fileName,
        filePath: openedFile.filePath,
        sizeBytes: openedFile.sizeBytes,
      },
    });
  }, []);

  const pickLocalModel = useCallback(async () => {
    try {
      const file = await pickModelFile();
      applyOpenedFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(message)) return;
      Alert.alert('Upload', message);
    }
  }, [applyOpenedFile]);

  const clearModel = useCallback(() => {
    handledUrlRef.current = null;
    awaitingInteractive.current = false;
    clearLastSlice().catch(() => {});
    setSlice({ state: 'idle' });
    setUpload({ state: 'idle' });
    setPrintStart({ state: 'idle' });
    setPlates([]);
    setSelectedPlate(null);
    setPlatesFor(null);
    setDownload({ state: 'idle', message: '' });
  }, []);

  // Open-with can finish importing after the Slice tab first paints — subscribe
  // so we still show the model when the native handoff lands late.
  useEffect(() => subscribePendingModel(applyOpenedFile), [applyOpenedFile]);

  // Re-check MakerWorld login + pick up interactive downloads / native slice results.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const pending = takeMwDownload();
      if (pending) {
        handledUrlRef.current = null;
        awaitingInteractive.current = false;
        setDownload({ state: 'success', message: 'Model ready.', result: pending });
        setSlice({ state: 'idle' });
        setUpload({ state: 'idle' });
        setPrintStart({ state: 'idle' });
      } else if (awaitingInteractive.current) {
        awaitingInteractive.current = false;
        handledUrlRef.current = null;
        setDownload({
          state: 'idle',
          message: 'Import cancelled. Share a MakerWorld link to try again.',
        });
      } else {
        const openedFile = takePendingModel();
        if (openedFile) applyOpenedFile(openedFile);
      }
      getMakerWorldCookies()
        .then((c) => active && setMwAuthed(c.hasAuth))
        .catch(() => {});
      if (download.state === 'success') {
        syncLastSlice(download.result.filePath);
      }
      return () => {
        active = false;
      };
    }, [applyOpenedFile, syncLastSlice, download])
  );

  const checkStatus = useCallback(async () => {
    try {
      const [status, share] = await Promise.all([
        getNativeSlicerStatus(),
        getSharedMakerWorldLink(),
      ]);
      setResult({ state: 'ready', status });
      setSharedLink(share);
    } catch (error) {
      setResult({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const startDownload = useCallback(async (url: string, force = false) => {
    if (!force && handledUrlRef.current === url) return;
    handledUrlRef.current = url;
    setSlice({ state: 'idle' });
    setUpload({ state: 'idle' });
    setPrintStart({ state: 'idle' });
    clearLastSlice().catch(() => {});
    setDownload({ state: 'downloading', message: 'Opening MakerWorld…' });
    try {
      const designId = MW_DESIGN_RE.exec(url)?.[1];
      if (!designId) throw new Error('Not a MakerWorld model link.');
      const instanceId = MW_INSTANCE_RE.exec(url)?.[1] ?? '';
      const startUrl = `https://makerworld.com/en/models/${designId}${instanceId ? `#profileId-${instanceId}` : ''}`;
      const r = await openMakerWorldDownloader(designId, instanceId || null, startUrl);
      const downloaded: NativeMakerWorldDownload = {
        ...r,
        designId: r.designId ?? designId,
        instanceId: r.instanceId ?? instanceId,
      };
      setDownload({
        state: 'success',
        message: 'Model ready.',
        result: downloaded,
      });
    } catch (error) {
      handledUrlRef.current = null;
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = message.includes('closed before a file');
      setDownload({
        state: cancelled ? 'idle' : 'error',
        message: cancelled
          ? "Import cancelled. Tap Import Link and use MakerWorld's Download button."
          : message,
      });
    }
    return;
    /*
    setDownload({ state: 'downloading', message: 'Resolving via logged-in page...' });
    try {
      const designId = MW_DESIGN_RE.exec(url)?.[1];
      if (!designId) throw new Error('Not a MakerWorld model link.');
      if (!fetcherRef.current) throw new Error('Fetcher not ready.');
      const instanceId = MW_INSTANCE_RE.exec(url)?.[1] ?? '';

      // Ask the logged-in WebView page to fetch the download URL in-origin,
      // preferring the instance from the shared link.
      const r = await fetcherRef.current.resolve(designId, instanceId);
      if (r.err) throw new Error(`In-page fetch failed: ${r.err}`);

      let signedUrl = r.fileUrl ?? '';
      let fileName = r.fileName || `makerworld_${designId}.3mf`;
      if (!signedUrl && r.body) {
        try {
          const parsed = JSON.parse(r.body);
          if (parsed.url) signedUrl = parsed.url;
          if (parsed.name) fileName = parsed.name;
        } catch {
          // body wasn't JSON
        }
      }

      if (!signedUrl) {
        // Headless fetch hit a CAPTCHA / bot-check (MakerWorld throws GeeTest at
        // API requests). Fall back to the interactive page where the user solves
        // it once and we intercept the resulting file.
        const captcha = /not a robot|captcha|geetest/i.test(r.body ?? '') || r.status === 418;
        if (captcha) {
          awaitingInteractive.current = true;
          setDownload({
            state: 'downloading',
            message: 'MakerWorld needs a human check — opening the page. Tap its Download button.',
          });
          // Pass only clean numeric ids — a raw URL param (with ?/#) breaks
          // expo-router navigation and the modal silently never opens.
          router.push({
            pathname: '/makerworld-download',
            params: { designId, instanceId },
          });
          return;
        }
        throw new Error(
          `No download URL found.\n[design=${designId} designStatus=${r.designStatus} dlStatus=${r.status} inst=${r.instance}]\n[body]: ${(r.body ?? '').slice(0, 200)}`
        );
      }

      // Signed CDN URLs are pre-authorized — plain download, no auth needed.
      setDownload({ state: 'downloading', message: `Downloading ${fileName}...` });
      const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
      const targetUri = `${baseDir}makerworld_${designId}.3mf`;
      await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {});
      const file = await FileSystem.downloadAsync(signedUrl, targetUri);
      const info = await FileSystem.getInfoAsync(file.uri);
      if (!info.exists || !info.size) throw new Error('Downloaded file is empty.');

      setDownload({
        state: 'success',
        message: 'Downloaded 3MF into Helix app storage.',
        result: {
          designId,
          instanceId: r.instance ?? designId,
          fileName,
          filePath: file.uri.replace(/^file:\/\//, ''),
          sizeBytes: info.size,
        },
      });
    } catch (error) {
      handledUrlRef.current = null;
      setDownload({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    */
  }, []);

  useEffect(() => {
    if (sharedLink?.makerWorldUrl) {
      startDownload(sharedLink.makerWorldUrl);
    }
  }, [sharedLink?.makerWorldUrl, startDownload]);

  const startUpload = useCallback(
    async (gcodePath: string, sourceName?: string | null, thenPreprocess = false) => {
      setUpload({ state: 'uploading', message: `Uploading to ${activeUrl || 'printer'}...` });
      setPrintStart({ state: 'idle' });
      try {
        if (!activeUrl) throw new Error('Printer URL is blank.');
        const requestedName = buildPrinterUploadFilename(sourceName, gcodePath);
        const uploaded = await uploadGcodeToPrinter(activeUrl, requestedName, gcodePath);
        const uploadedName = uploaded && 'filename' in uploaded ? uploaded.filename : requestedName;
        const moonrakerPath = uploadedPathFromResponse(uploaded, uploadedName);
        setUpload({ state: 'uploading', message: `Checking printer file list for ${moonrakerPath}...` });
        const verifiedPath = await verifyUploadedGcode(activeUrl, moonrakerPath, uploadedName);
        setUpload({ state: 'uploading', message: `Reading metadata for ${verifiedPath}...` });
        const preview = await readUploadedPreview(activeUrl, verifiedPath);
        setUpload({
          state: 'done',
          message: `Uploaded ${verifiedPath}`,
          filename: uploadedName,
          moonrakerPath: verifiedPath,
          preview,
          printerId: settings.activePrinterId,
        });
        // "Upload & Print" flows straight into the Print Preprocessing dialog.
        if (thenPreprocess) {
          setPrintStart({ state: 'idle' });
          setPreprocessOpen(true);
        }
      } catch (error) {
        setUpload({
          state: 'error',
          message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [activeUrl, settings.activePrinterId]
  );

  // Detect multi-plate 3MFs once per imported file, so the user can pick a plate.
  const modelFilePath = download.state === 'success' ? download.result.filePath : null;
  useEffect(() => {
    let active = true;
    if (!modelFilePath) {
      setPlates([]);
      setSelectedPlate(null);
      setPlatesFor(null);
      return;
    }
    if (platesFor === modelFilePath) return;
    getModelPlates(modelFilePath)
      .then((found) => {
        if (!active) return;
        setPlatesFor(modelFilePath);
        setPlates(found.length > 1 ? found : []);
        setSelectedPlate(null);
      })
      .catch(() => {
        if (!active) return;
        setPlates([]);
        setSelectedPlate(null);
      });
    return () => {
      active = false;
    };
  }, [modelFilePath, platesFor]);

  const choosePlate = useCallback(
    async (plate: ModelPlate) => {
      if (!modelFilePath || selectedPlate?.id === plate.id) return;
      setExtracting(true);
      try {
        const extracted = await extractModelPlate(modelFilePath, plate.id);
        setSelectedPlate({ id: plate.id, path: extracted.filePath, name: plate.name });
        setSlice({ state: 'idle' });
        setUpload({ state: 'idle' });
        setPrintStart({ state: 'idle' });
      } catch (error) {
        Alert.alert('Plate', error instanceof Error ? error.message : String(error));
      } finally {
        setExtracting(false);
      }
    },
    [modelFilePath, selectedPlate],
  );

  const prepareAndSlice = useCallback(async () => {
    if (download.state !== 'success') return;
    if (plates.length > 1 && !selectedPlate) {
      Alert.alert('Plates', 'This model has multiple plates — pick one to slice first.');
      return;
    }
    if (toolLoad.blockReason) {
      Alert.alert('Filament', toolLoad.blockReason);
      return;
    }
    const path = selectedPlate?.path ?? download.result.filePath;
    const title = selectedPlate
      ? `${download.result.fileName} — ${selectedPlate.name}`
      : download.result.fileName;
    try {
      const materialProfiles = await resolveNativeMaterialProfiles(
        connection === 'connected' ? activeUrl : null,
        filamentSlots,
      );
      await openNativeModelPreview(
        path,
        title,
        effectiveFilamentSlotColors,
        colors.primary,
        connection === 'connected' ? activeUrl : null,
        toolLoad.selectedTool,
        toolLoad.nativeLoadedToolMask,
        Boolean(selectedPlate),
        materialProfiles,
      );
    } catch (error) {
      Alert.alert('Prepare & Slice', error instanceof Error ? error.message : String(error));
    }
  }, [activeUrl, connection, download, effectiveFilamentSlotColors, filamentSlots, toolLoad, plates, selectedPlate]);

  const updateFilamentSlots = useCallback(
    async (next: string[]) => {
      const normalized = normalizeFilamentSlotColors(next);
      await updateSettings({ filamentSlotColors: normalized });
      try {
        await setFilamentSlotColors(normalized);
      } catch {
        // Native module unavailable on non-Android — settings still saved.
      }
      if (activeUrl) {
        try {
          await Promise.all(normalized.map((color, channel) => api.setFilamentSlot(
            activeUrl,
            channel,
            {
              VENDOR: status.filament_detect?.info?.[channel]?.VENDOR && status.filament_detect.info[channel].VENDOR !== 'NONE'
                ? status.filament_detect.info[channel].VENDOR
                : status.print_task_config?.filament_vendor?.[channel] || 'Generic',
              MAIN_TYPE: status.print_task_config?.filament_type?.[channel] || settings.filamentSlotMaterials[channel] || 'PLA',
              SUB_TYPE: status.filament_detect?.info?.[channel]?.SUB_TYPE || 'Basic',
              RGB_1: parseInt(color.replace('#', '').slice(0, 6), 16),
              ALPHA: 255,
            },
          )));
        } catch (error) {
          Alert.alert('Printer update unavailable', error instanceof Error ? error.message : 'Helix saved the value locally.');
        }
      }
    },
    [activeUrl, settings.filamentSlotMaterials, status, updateSettings],
  );

  const updateFilamentMaterials = useCallback(
    async (next: string[]) => {
      const normalized = Array.from({ length: 4 }, (_, i) => {
        const value = next[i]?.trim().toUpperCase();
        return value || settings.filamentSlotMaterials[i] || 'PLA';
      });
      await updateSettings({ filamentSlotMaterials: normalized });
      if (activeUrl) {
        try {
          await Promise.all(normalized.map((material, channel) => api.setFilamentSlot(
            activeUrl,
            channel,
            {
              VENDOR: status.filament_detect?.info?.[channel]?.VENDOR && status.filament_detect.info[channel].VENDOR !== 'NONE'
                ? status.filament_detect.info[channel].VENDOR
                : status.print_task_config?.filament_vendor?.[channel] || 'Generic',
              MAIN_TYPE: material,
              SUB_TYPE: status.filament_detect?.info?.[channel]?.SUB_TYPE || 'Basic',
              RGB_1: parseInt(normalizeFilamentSlotColors(settings.filamentSlotColors)[channel].replace('#', '').slice(0, 6), 16),
              ALPHA: 255,
            },
          )));
        } catch (error) {
          Alert.alert('Printer update unavailable', error instanceof Error ? error.message : 'Helix saved the value locally.');
        }
      }
    },
    [activeUrl, settings.filamentSlotColors, settings.filamentSlotMaterials, status, updateSettings],
  );

  const updateFilamentBrands = useCallback(
    async (next: string[]) => {
      await updateSettings({ filamentSlotBrands: next });
      if (activeUrl) {
        try {
          await Promise.all(next.map((brand, channel) => api.setFilamentSlot(
            activeUrl,
            channel,
            {
              VENDOR: brand || 'Generic',
              MAIN_TYPE: status.print_task_config?.filament_type?.[channel] || settings.filamentSlotMaterials[channel] || 'PLA',
              SUB_TYPE: status.filament_detect?.info?.[channel]?.SUB_TYPE || 'Basic',
              RGB_1: parseInt(normalizeFilamentSlotColors(settings.filamentSlotColors)[channel].replace('#', '').slice(0, 6), 16),
              ALPHA: 255,
            },
          )));
        } catch (error) {
          Alert.alert('Printer update unavailable', error instanceof Error ? error.message : 'Helix saved the value locally.');
        }
      }
    },
    [activeUrl, settings.filamentSlotColors, settings.filamentSlotMaterials, status, updateSettings],
  );

  const openToolpathPreview = useCallback(async () => {
    if (slice.state !== 'success') return;
    const sourceName = download.state === 'success' ? download.result.fileName : null;
    const initialTool = slice.result.initialTool ?? toolLoad.selectedTool;
    try {
      await openNativeGcodePreview(
        slice.result.gcodePath,
        sourceName ?? 'Sliced toolpaths',
        colors.primary,
        connection === 'connected' ? activeUrl : null,
        initialTool,
        toolLoad.nativeLoadedToolMask,
        slice.result.usedToolMask ?? (1 << initialTool),
      );
    } catch (error) {
      Alert.alert('Toolpath Preview', error instanceof Error ? error.message : String(error));
    }
  }, [activeUrl, connection, download, slice, toolLoad]);

  const openPreprocess = useCallback(() => {
    if (slice.state !== 'success') return;
    setPrintStart({ state: 'idle' });
    setSendProgress(0);
    setPreprocessOpen(true);
  }, [slice.state]);

  // Cancel on the Send card: drop the slice result, back to the import state.
  const dismissSlice = useCallback(() => {
    setSlice({ state: 'idle' });
    setUpload({ state: 'idle' });
    setPrintStart({ state: 'idle' });
    clearLastSlice().catch(() => {});
  }, []);

  const selectPrinter = useCallback(
    (id: string) => {
      const p = settings.printers.find((x) => x.id === id);
      if (!p || p.id === settings.activePrinterId) return;
      updateSettings({
        activePrinterId: p.id,
        primaryUrl: p.url,
        tailscaleUrl: p.tailscaleUrl,
        cameraUrl: p.cameraUrl,
        connectionMode: p.connectionMode,
      });
    },
    [settings.printers, settings.activePrinterId, updateSettings],
  );

  // The dialog's Print button: upload the sliced gcode, verify it, then start —
  // all in one go, driving the dialog's progress bar.
  const uploadAndPrint = useCallback(async (
    requestedPrefs: Readonly<Record<PrintPref, boolean>>,
  ) => {
    if (slice.state !== 'success') return;
    if (!activeUrl) {
      setPrintStart({ state: 'error', message: 'Printer URL is blank.' });
      return;
    }
    const initialTool = slice.result.initialTool ?? toolLoad.selectedTool;
    const requiredToolMask = slice.result.usedToolMask ?? (1 << initialTool);
    const usedExtruders = [0, 1, 2, 3].filter((tool) => (requiredToolMask & (1 << tool)) !== 0);
    const missingTools = missingLoadedTools(toolLoad, requiredToolMask);
    if (missingTools) {
      setPrintStart({ state: 'error', message: `Load filament in ${missingTools} before printing.` });
      return;
    }

    const gcodePath = slice.result.gcodePath;
    const sourceName = download.state === 'success' ? download.result.fileName : null;
    setPrintStart({ state: 'starting', message: 'Uploading…' });
    setSendProgress(0.12);
    try {
      // Timelapse is gcode-driven: the printer only records frames if the gcode
      // itself calls the TIMELAPSE_* macros at each layer. Inject them before
      // upload when the toggle is on (SET_PRINT_PREFERENCES below just arms the
      // firmware preference; the frame captures have to live in the gcode).
      let uploadPath = gcodePath;
      if (requestedPrefs.timelapse) {
        setPrintStart({ state: 'starting', message: 'Preparing timelapse…' });
        uploadPath = await injectTimelapseMacros(gcodePath);
      }
      const requestedName = buildPrinterUploadFilename(sourceName, gcodePath);
      const uploaded = await uploadGcodeToPrinter(activeUrl, requestedName, uploadPath);
      setSendProgress(0.55);
      const uploadedName = uploaded && 'filename' in uploaded ? uploaded.filename : requestedName;
      const moonrakerPath = uploadedPathFromResponse(uploaded, uploadedName);
      setPrintStart({ state: 'starting', message: 'Verifying…' });
      const verifiedPath = await verifyUploadedGcode(activeUrl, moonrakerPath, uploadedName);
      setSendProgress(0.8);
      // Firmware caches these per-printer, so always send every preference explicitly —
      // otherwise a previous print's toggle state can leak into this one.
      setPrintStart({ state: 'starting', message: 'Applying print preferences…' });
      const before = await api.queryObjects<{
        print_stats?: { state?: string };
      }>(activeUrl, ['print_stats']);
      const currentState = before.status?.print_stats?.state;
      if (currentState === 'printing' || currentState === 'paused') {
        throw new Error(`Printer is already ${currentState}.`);
      }
      await api.runGcode(
        activeUrl,
        `SET_MAIN_STATE MAIN_STATE=IDLE\nSET_PRINT_USED_EXTRUDERS EXTRUDERS=${usedExtruders.join(',')}\nSET_PRINT_PREFERENCES BED_LEVEL=${requestedPrefs.autoLevel ? 1 : 0} TIME_LAPSE_CAMERA=${requestedPrefs.timelapse ? 1 : 0} FLOW_CALIBRATE=${requestedPrefs.flowCal ? 1 : 0} FLOW_CALIBRATE_EXTRUDERS=0,1,2,3`,
      );
      const applied = await api.queryObjects<{
        print_task_config?: {
          auto_bed_leveling?: boolean;
          time_lapse_camera?: boolean;
          flow_calibrate?: boolean;
          flow_calib_extruders?: boolean[];
          extruders_used?: boolean[];
        };
      }>(activeUrl, ['print_task_config']);
      const taskConfig = applied.status?.print_task_config;
      if (
        taskConfig?.auto_bed_leveling !== requestedPrefs.autoLevel ||
        taskConfig?.time_lapse_camera !== requestedPrefs.timelapse ||
        taskConfig?.flow_calibrate !== requestedPrefs.flowCal ||
        taskConfig?.flow_calib_extruders?.length !== 4 ||
        !taskConfig?.flow_calib_extruders?.every(Boolean) ||
        taskConfig?.extruders_used?.length !== 4 ||
        !taskConfig?.extruders_used?.every((used, tool) => used === usedExtruders.includes(tool))
      ) {
        throw new Error('Printer rejected the selected print preferences.');
      }
      setPrintStart({ state: 'starting', message: 'Starting print…' });
      await api.startPrint(activeUrl, verifiedPath);
      setSendProgress(1);
      setPrintStart({ state: 'done', message: `Print started: ${verifiedPath}` });
      setPreprocessOpen(false);
      setPrintSentNotice({ filename: verifiedPath });
      // Push a concrete Home route after staging the one-shot notice. Unlike a
      // tab-level navigate to an already-mounted route, this cannot be ignored
      // as a no-op by the nested navigator.
      router.push('/');
    } catch (error) {
      setSendProgress(0);
      setPrintStart({
        state: 'error',
        message: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [activeUrl, slice, toolLoad, download, router]);

  const refresh = async () => {
    setRefreshing(true);
    await checkStatus();
    setRefreshing(false);
  };

  const ready = result.state === 'ready' ? result.status.loaded && !result.status.coreError : false;
  const printerReady = connection === 'connected' && Boolean(activeUrl);
  const hasModel = download.state === 'success';
  const sliced = slice.state === 'success';
  const slicedInitialTool = slice.state === 'success'
    ? slice.result.initialTool ?? toolLoad.selectedTool
    : toolLoad.selectedTool;
  const slicedRequiredToolMask = slice.state === 'success'
    ? slice.result.usedToolMask ?? (1 << slicedInitialTool)
    : 1 << slicedInitialTool;
  const missingPrintTools = sliced ? missingLoadedTools(toolLoad, slicedRequiredToolMask) : null;
  const printDialogSlots = useMemo(
    () => filamentSlots.filter((slot) => (slicedRequiredToolMask & (1 << slot.index)) !== 0),
    [filamentSlots, slicedRequiredToolMask],
  );

  // Pull the render thumbnail baked into the sliced gcode (shows in the card
  // immediately, before any upload — same preview the home card uses).
  const [sliceThumb, setSliceThumb] = useState<string | null>(null);
  const slicedGcodePath = slice.state === 'success' ? slice.result.gcodePath : null;
  useEffect(() => {
    let active = true;
    if (!slicedGcodePath) {
      setSliceThumb(null);
      return;
    }
    getGcodeThumbnail(slicedGcodePath)
      .then((uri) => active && setSliceThumb(uri))
      .catch(() => active && setSliceThumb(null));
    getGcodeFilamentGrams(slicedGcodePath)
      .then((g) => active && setPerToolGrams(g))
      .catch(() => active && setPerToolGrams([]));
    return () => {
      active = false;
    };
  }, [slicedGcodePath]);

  return (
    <>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    >
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Filaments</Text>
        <Text style={styles.mutedText}>T0-T3 filament colors and materials.</Text>
        <FilamentSlotsEditor
          slotColors={settings.filamentSlotColors}
          slotBrands={settings.filamentSlotBrands}
          slotMaterials={settings.filamentSlotMaterials}
          slots={filamentSlots}
          onChange={updateFilamentSlots}
          onBrandsChange={updateFilamentBrands}
          onMaterialsChange={updateFilamentMaterials}
        />
        <Text style={styles.mutedText}>
          {toolLoad.known
            ? `Single-colour slices use T${toolLoad.selectedTool}.`
            : 'Filament load is unknown until Helix can read the printer.'}
        </Text>
        {toolLoad.blockReason ? (
          <Text style={[styles.value, styles.bad]}>{toolLoad.blockReason}</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Model</Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={pickLocalModel}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="upload" size={18} color={colors.text} />
          <Text style={styles.buttonText}>Upload .3mf / .stl</Text>
        </TouchableOpacity>
        <Text
          style={[
            styles.value,
            download.state === 'success'
              ? styles.good
              : download.state === 'error'
                ? styles.bad
                : styles.mutedValue,
          ]}
        >
          {download.message}
        </Text>
        {download.state === 'downloading' ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>Importing…</Text>
          </View>
        ) : null}
        {hasModel ? (
          <View style={styles.modelFileRow}>
            <Text style={[styles.fileName, styles.modelFileName]} numberOfLines={1}>
              {download.result.fileName}
            </Text>
            <TouchableOpacity
              onPress={clearModel}
              hitSlop={8}
              accessibilityLabel="Remove model"
            >
              <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.subtext} />
            </TouchableOpacity>
          </View>
        ) : null}
        {!mwAuthed ? (
          <Text style={styles.hintText}>
            MakerWorld login is in{' '}
            <Text style={styles.hintLink} onPress={() => router.push('/settings')}>
              Settings
            </Text>
            {' '}— required to import shared models.
          </Text>
        ) : null}
        {sharedLink?.makerWorldUrl && !hasModel && download.state !== 'downloading' ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => startDownload(sharedLink.makerWorldUrl!, true)}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="download" size={18} color={colors.text} />
            <Text style={styles.buttonText}>Import from link</Text>
          </TouchableOpacity>
        ) : null}
        {hasModel && plates.length > 1 ? (
          <View style={styles.plateSection}>
            <Text style={styles.plateHeading}>
              {plates.length} plates — pick one to slice
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.plateRow}
            >
              {plates.map((plate) => {
                const active = selectedPlate?.id === plate.id;
                return (
                  <TouchableOpacity
                    key={plate.id}
                    style={[styles.plateCard, active && styles.plateCardActive]}
                    onPress={() => choosePlate(plate)}
                    disabled={extracting}
                    activeOpacity={0.85}
                  >
                    {plate.thumbnail ? (
                      <Image source={{ uri: plate.thumbnail }} style={styles.plateThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.plateThumb, styles.platePlaceholder]}>
                        <MaterialCommunityIcons name="grid" size={22} color={colors.subtext} />
                      </View>
                    )}
                    <Text style={styles.plateName} numberOfLines={1}>{plate.name}</Text>
                    <Text style={styles.plateMeta}>
                      {plate.objectCount} obj{plate.objectCount === 1 ? '' : 's'}
                    </Text>
                    {active ? (
                      <View style={styles.plateCheck}>
                        <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {extracting ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.body}>Preparing plate…</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {hasModel ? (
          <TouchableOpacity
            style={[
              styles.button,
              (!ready || toolLoad.blockReason || extracting || (plates.length > 1 && !selectedPlate)) &&
                styles.buttonOff,
            ]}
            disabled={
              !ready || Boolean(toolLoad.blockReason) || extracting ||
              (plates.length > 1 && !selectedPlate)
            }
            onPress={prepareAndSlice}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="cube-scan" size={20} color={colors.text} />
            <Text style={styles.buttonText}>
              {plates.length > 1 && !selectedPlate ? 'Pick a plate above' : 'Prepare & Slice'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {sliced && hasModel ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Send to printer</Text>
          {sliceThumb ? (
            <Image source={{ uri: sliceThumb }} style={styles.slicePreview} resizeMode="contain" />
          ) : null}
          <Text style={styles.statsLine}>
            {slice.result.totalLayers} layers · {Math.round(slice.result.estimatedTimeSeconds / 60)} min ·{' '}
            {slice.result.estimatedFilamentGrams.toFixed(1)} g
          </Text>
          <TouchableOpacity
            style={[styles.button, !printerReady && styles.buttonOff]}
            disabled={!printerReady}
            onPress={openPreprocess}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="printer-3d" size={18} color={colors.text} />
            <Text style={styles.buttonText}>
              {printerReady ? 'Upload & Print' : 'Printer offline'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={dismissSlice}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="close" size={18} color={colors.subtext} />
            <Text style={[styles.buttonText, { color: colors.subtext }]}>Cancel</Text>
          </TouchableOpacity>
          {printStart.state === 'error' ? (
            <Text style={[styles.value, styles.bad]}>{printStart.message}</Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>

    <PrintPreprocessDialog
      visible={preprocessOpen}
      onClose={() => setPreprocessOpen(false)}
      fileName={download.state === 'success' ? download.result.fileName : 'print.gcode'}
      estTimeSeconds={slice.state === 'success' ? slice.result.estimatedTimeSeconds : 0}
      estGramsTotal={slice.state === 'success' ? slice.result.estimatedFilamentGrams : 0}
      thumbnail={sliceThumb}
      printers={settings.printers.map((p) => ({ id: p.id, name: p.name }))}
      activePrinterId={settings.activePrinterId}
      onSelectPrinter={selectPrinter}
      slots={printDialogSlots}
      perToolGrams={perToolGrams}
      prefs={printPrefs}
      onTogglePref={(pref) => setPrintPrefs((prev) => ({ ...prev, [pref]: !prev[pref] }))}
      sending={printStart.state === 'starting'}
      progress={sendProgress}
      errorMessage={printStart.state === 'error' ? printStart.message : null}
      onSend={uploadAndPrint}
    />
    </>
  );
}

function buildPrinterUploadFilename(sourceName: string | null | undefined, gcodePath: string): string {
  const source = sourceName?.trim() || fileBaseName(gcodePath) || 'print';
  const stem = fileBaseName(source).replace(/\.[^.]+$/, '');
  const clean = stem
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'print';
  return `${clean}_${Date.now()}.gcode`;
}

function uploadedPathFromResponse(uploaded: UploadResult, fallback: string): string {
  if (!uploaded) return fallback;

  try {
    const parsed = JSON.parse(uploaded.body);
    const itemPath = parsed?.item?.path;
    if (typeof itemPath === 'string' && itemPath.trim()) return itemPath;
  } catch {}

  return uploaded.filename || fallback;
}

async function readUploadedPreview(baseUrl: string, moonrakerPath: string): Promise<UploadPreview> {
  const displayName = fileBaseName(moonrakerPath).replace(/\.gcode$/i, '');

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const meta: any = await api.metadata(baseUrl, moonrakerPath);
      const thumbs: any[] = Array.isArray(meta?.thumbnails) ? meta.thumbnails : [];
      const best = thumbs.reduce(
        (winner, current) => (!winner || (current?.width ?? 0) > (winner?.width ?? 0) ? current : winner),
        null as any
      );
      if (best?.relative_path) {
        return {
          displayName,
          thumbnail: thumbnailUrl(baseUrl, moonrakerPath, best.relative_path),
        };
      }
    } catch {}

    await delay(900);
  }

  return { displayName, thumbnail: null };
}

async function verifyUploadedGcode(baseUrl: string, moonrakerPath: string, uploadedName: string): Promise<string> {
  const candidates = new Set(
    [moonrakerPath, uploadedName, fileBaseName(moonrakerPath), fileBaseName(uploadedName)].filter(Boolean)
  );
  let lastError = '';

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const files = await api.listFiles(baseUrl);
      const found = files.find((file) => {
        const path = file.path || '';
        const base = fileBaseName(path);
        return candidates.has(path) || candidates.has(base) || path.endsWith(`/${uploadedName}`);
      });
      if (found) return found.path;
      lastError = `not found in ${files.length} gcodes`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(900);
  }

  throw new Error(`Moonraker accepted the upload, but the file was not found on the printer. ${lastError}`);
}

function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveToolLoad(
  status: Record<string, any>,
  objectList: string[],
  aceUnits: AceUnit[],
  aceHardwareDetected: boolean,
  connection: string,
): ToolLoadInfo {
  const slots: ToolLoadSlot[] = [0, 1, 2, 3].map((index) => ({ index, status: 'unknown' }));
  let source: ToolLoadInfo['source'] = 'unknown';
  let hasData = false;

  if (connection === 'connected' && Array.isArray(status.print_task_config?.filament_exist)) {
    source = 'printer';
    for (let index = 0; index < 4; index++) {
      const exists = status.print_task_config.filament_exist[index];
      if (typeof exists === 'boolean') {
        hasData = true;
        slots[index].status = exists ? 'loaded' : 'empty';
      }
    }
  }

  if (connection === 'connected' && !hasData && aceHardwareDetected) {
    source = 'ace';
    for (const unit of aceUnits) {
      for (const lane of unit.lanes) {
        if (lane.index < 0 || lane.index > 3) continue;
        const next = lane.status === 'loaded' || lane.status === 'drying'
          ? 'loaded'
          : lane.status === 'busy'
            ? 'busy'
            : lane.status === 'empty'
              ? 'empty'
              : 'unknown';
        if (next !== 'unknown') hasData = true;
        slots[lane.index].status = strongerToolStatus(slots[lane.index].status, next);
      }
    }
  }

  if (connection === 'connected' && !hasData) {
    const sensorKeys = Array.from(
      new Set(
        [...Object.keys(status), ...objectList].filter((key) =>
          /^filament_(switch|motion)_sensor /.test(key),
        ),
      ),
    );
    if (sensorKeys.length) {
      source = 'sensor';
      const booleanKeys = sensorKeys.filter((key) => typeof status[key]?.filament_detected === 'boolean');
      for (const key of booleanKeys) {
        const detected = Boolean(status[key]?.filament_detected);
        const index = toolIndexFromSensorKey(key) ?? (booleanKeys.length === 1 ? 0 : null);
        if (index == null || index < 0 || index > 3) continue;
        hasData = true;
        slots[index].status = detected ? 'loaded' : 'empty';
      }
    }
  }

  const firstLoaded = slots.find((slot) => slot.status === 'loaded')?.index ?? null;
  const loadedToolMask = slots.reduce(
    (mask, slot) => (slot.status === 'loaded' ? mask | (1 << slot.index) : mask),
    0,
  );
  const known = hasData && slots.some((slot) => slot.status !== 'unknown');
  const selectedTool = firstLoaded ?? 0;
  const blockReason = known && firstLoaded == null
    ? 'No loaded filament detected. Load a U1 head before slicing or printing.'
    : null;

  return {
    source,
    slots,
    firstLoaded,
    selectedTool,
    loadedToolMask,
    nativeLoadedToolMask: known ? loadedToolMask : -1,
    known,
    blockReason,
  };
}

function resolveFilamentSlots(
  status: Record<string, any>,
  manualColors: string[],
  manualBrands: string[],
  manualMaterials: string[],
  toolLoad: ToolLoadInfo,
): FilamentSlotDisplay[] {
  const ptc = status.print_task_config ?? {};

  return Array.from({ length: 4 }, (_, index) => {
    const loadStatus = toolLoad.slots[index]?.status ?? 'unknown';
    const printerColor = loadStatus !== 'empty'
      ? rgbaStringToHex(Array.isArray(ptc.filament_color_rgba) ? ptc.filament_color_rgba[index] : null)
      : null;
    const printerMaterial = loadStatus !== 'empty' ? materialLabelFromPrintTask(ptc, index) : '';
    const printerBrand = loadStatus !== 'empty' ? arrayString(ptc.filament_vendor, index) : '';
    const fallbackColor = normalizeFilamentSlotColors(manualColors)[index];
    const fallbackBrand = manualBrands[index] || 'Generic';
    const fallbackMaterial = manualMaterials[index] || 'PLA';
    const genericBlack = printerColor === '#000000' && !printerMaterial;
    const hasPrinterMetadata = !genericBlack && Boolean(printerColor || printerMaterial);

    return {
      index,
      status: loadStatus,
      color: loadStatus === 'empty' ? '#30343A' : (hasPrinterMetadata ? printerColor : null) ?? fallbackColor,
      brand: printerBrand && printerBrand !== 'NONE' ? printerBrand : fallbackBrand,
      material: loadStatus === 'empty' ? 'Empty' : printerMaterial || fallbackMaterial,
      source: hasPrinterMetadata ? 'printer' : 'manual',
    };
  });
}

function rgbaStringToHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!/^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)) return null;
  return `#${value.slice(0, 6).toUpperCase()}`;
}

function materialLabelFromPrintTask(ptc: Record<string, any>, index: number): string {
  const type = arrayString(ptc.filament_type, index);
  const subType = arrayString(ptc.filament_sub_type, index);
  if (!type || type === 'NONE') return '';
  return [type, subType && subType !== 'NONE' ? subType : '']
    .filter(Boolean)
    .join(' ');
}

function arrayString(raw: unknown, index: number): string {
  if (!Array.isArray(raw)) return '';
  const value = raw[index];
  return typeof value === 'string' ? value.trim() : '';
}

function strongerToolStatus(a: ToolLoadStatus, b: ToolLoadStatus): ToolLoadStatus {
  const priority: Record<ToolLoadStatus, number> = {
    unknown: 0,
    empty: 1,
    busy: 2,
    loaded: 3,
  };
  return priority[b] > priority[a] ? b : a;
}

function toolIndexFromSensorKey(key: string): number | null {
  const tail = key.replace(/^filament_(switch|motion)_sensor\s*/i, '').toLowerCase();
  if (/^extruder$/.test(tail)) return 0;
  const named = /(?:tool|toolhead|head|slot|lane|extruder|t)[\s_-]*([0-3])\b/.exec(tail);
  if (named) return Number(named[1]);
  const lone = /(?:^|[^0-9])([0-3])(?:[^0-9]|$)/.exec(tail);
  return lone ? Number(lone[1]) : null;
}

function missingLoadedTools(toolLoad: ToolLoadInfo, requiredToolMask: number): string | null {
  if (toolLoad.nativeLoadedToolMask < 0) return null;
  const missing = (requiredToolMask & 0x0F) & ~toolLoad.loadedToolMask & 0x0F;
  return missing ? maskToTools(missing) : null;
}

function maskToTools(mask: number): string {
  return [0, 1, 2, 3]
    .filter((index) => (mask & (1 << index)) !== 0)
    .map((index) => `T${index}`)
    .join(' ');
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl + 80,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
  },
  loadingRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  body: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  linkText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  mutedText: {
    color: colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  loadedRow: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  loadedLabel: {
    color: colors.subtext,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  toolBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  toolBadge: {
    minWidth: 70,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    gap: 2,
  },
  toolBadgeLoaded: {
    backgroundColor: '#13251a',
    borderColor: '#245f3b',
  },
  toolBadgeEmpty: {
    backgroundColor: '#2a1b1b',
    borderColor: '#653030',
  },
  toolBadgeBusy: {
    backgroundColor: '#332a16',
    borderColor: '#624f22',
  },
  toolBadgeUnknown: {
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
  },
  toolBadgeName: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
  },
  toolBadgeStatus: {
    color: colors.subtext,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  mutedValue: {
    color: colors.subtext,
  },
  rawText: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  previewRow: {
    minHeight: 76,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  slicePreview: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    backgroundColor: '#0d0f12',
    marginBottom: spacing.sm,
  },
  plateSection: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  plateHeading: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: '700',
  },
  plateRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  plateCard: {
    width: 104,
    borderRadius: 12,
    padding: spacing.xs,
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  plateCardActive: {
    borderColor: colors.primary,
  },
  plateThumb: {
    width: '100%',
    height: 88,
    borderRadius: 8,
    backgroundColor: '#0d0f12',
  },
  platePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  plateMeta: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 1,
  },
  plateCheck: {
    position: 'absolute',
    top: spacing.xs + 2,
    right: spacing.xs + 2,
    backgroundColor: colors.bg,
    borderRadius: 10,
  },
  previewImage: {
    width: 58,
    height: 58,
    borderRadius: 6,
    backgroundColor: colors.bg,
  },
  previewPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
    borderWidth: 1,
  },
  previewText: {
    flex: 1,
    gap: 3,
  },
  previewTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  previewPath: {
    color: colors.subtext,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  row: {
    gap: 4,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    color: colors.subtext,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  good: {
    color: colors.success,
  },
  bad: {
    color: colors.warning,
  },
  button: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonOff: {
    opacity: 0.4,
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  fileName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  modelFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modelFileName: {
    flex: 1,
    marginTop: 0,
  },
  hintText: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  hintLink: {
    color: colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  statsLine: {
    color: colors.subtext,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
});
