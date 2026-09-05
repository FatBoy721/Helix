import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors } from '../../constants/theme';
import { alpha, COCKPIT as P } from '../../components/dashboard/shared';
import { ProgressBar } from '../../components/ui/progress';
import { formatDuration } from '../../components/PrintProgress';
import FilamentEditor from '../../components/dashboard/parts/FilamentEditor';
import {
  ActionBar,
  Banner,
  HeroCard,
  PlateStrip,
  Secondary,
  StatRow,
  ToolRail,
} from '../../components/slicer/parts';
import {
  addExtractProgressListener,
  clearLastSlice,
  extractModelPlate,
  getGcodeFilamentGrams,
  getGcodeThumbnail,
  getLastSliceResult,
  getMakerWorldCookies,
  getModelPlates,
  getNativeSlicerStatus,
  getSharedMakerWorldLink,
  takeBambuSendRequest,
  ModelPlate,
  NativeMakerWorldDownload,
  NativeSliceResult,
  NativeSlicerStatus,
  openMakerWorldDownloader,
  openNativeGcodePreview,
  openNativeModelPreview,
  injectTimelapseMacros,
  pickModelFile,
  setFilamentSlots,
  type NativeFilamentSlot,
  collapseModelToTool,
  remapModelExtruders,
  sliceModelFile,
  setNativePrinters,
  SharedMakerWorldLink,
  uploadGcodeToPrinter,
  getModelPlateStats,
  type ModelPlateStats,
  type SharedModelFile,
} from '../../services/nativeSlicer';
import { useMoonraker } from '../../hooks/useMoonraker';
import { fetchMakerWorldPlateStats } from '../../services/makerWorld';
import { useACE } from '../../hooks/useACE';
import { useMaterialStation } from '../../hooks/useMaterialStation';
import {
  canUseReportedFilamentSlots,
  materialStationSlots,
  unavailableMaterialStationSlots,
} from '../../services/filamentSlots';
import type { AceUnit } from '../../hooks/useACE';
import { useSettings } from '../../hooks/useSettings';
import {
  printerProfile,
  resolveMachineProfile,
  type PrinterKind,
} from '../../services/printerProfiles';
import { type FilamentSlotDisplay } from '../../components/FilamentSlotsEditor';
import { normalizeFilamentSlotColors } from '../../constants/filamentColors';
import { takeMwDownload } from '../../services/mwBus';
import { subscribePendingModel, takePendingModel } from '../../services/pendingModel';
import { setPrintSentNotice } from '../../services/printSentBus';
import { setPrintIntent } from '../../services/printIntent';
import { ifsOffPrintGcode } from '../../services/zmodPrintPrompt';
import PrintPreprocessDialog, { type PrintPref } from '../../components/PrintPreprocessDialog';
import { applicablePrefs, routeTools } from '../../services/printPreprocess';
import {
  api,
  buildAiMonitoringCommand,
  normalizeMoonrakerUrl,
  printerConnectionUrl,
  thumbnailUrl,
} from '../../services/moonraker';
import { resolveNativeMaterialProfiles } from '../../services/filamentProfiles';
import { useThemedAlert } from '../../hooks/useThemedAlert';
import { startBambuProjectFile, uploadBambuPrintArtifact } from '../../services/bambuMqtt';

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

const PAGE = 16;

const EXTRACT_SAYINGS = [
  'Slicing the un-sliceable…',
  'Convincing triangles to behave…',
  'Aligning the molecular lattice…',
  'Counting layers like sheep…',
  'Polishing vertices to a shine…',
  'Negotiating with the build plate…',
  'Bribing the extruder…',
  'Untangling the spaghetti code…',
  'Consulting the print gods…',
  'Hammering pixels into plastic…',
];

export default function SliceLabScreen() {
  const router = useRouter();
  const { showAlert, alertDialog } = useThemedAlert();
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
  const [selectedPlate, setSelectedPlate] = useState<{ id: number; name: string } | null>(null);
  const [platesFor, setPlatesFor] = useState<string | null>(null);
  // Embedded 3MF plate render, shown in the hero as soon as a model is picked —
  // before any slicing happens. Null for STLs and 3MFs without thumbnails.
  const [modelThumb, setModelThumb] = useState<string | null>(null);
  // Slice stats baked into the 3MF by the original slicer (MakerWorld etc.) —
  // lets the stat cards show real numbers before any in-app slice. Empty for
  // geometry-only 3MFs and STLs.
  const [modelStats, setModelStats] = useState<ModelPlateStats[]>([]);
  // MakerWorld API stats for in-app downloads (the 3MFs usually lack embedded
  // plate G-code, so the native scan above finds nothing). Keyed by file path
  // so stats from a previous download can't bleed into a freshly opened file.
  const [mwStats, setMwStats] = useState<{ forPath: string; stats: ModelPlateStats[] } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ percent: number; phase: string } | null>(null);
  const [sayingIdx, setSayingIdx] = useState(0);
  // When the user remaps a single-material slice to a different loaded slot in
  // the print dialog, this holds { fileTool -> chosenLoadedSlot }. Print then
  // re-slices: if every file tool routes to the SAME slot the model is collapsed
  // to single-material; otherwise each colour is remapped to its own slot
  // (multi-colour stays multi-colour). null = use the sliced tools as-is.
  const [toolRemap, setToolRemap] = useState<Record<number, number> | null>(null);
  const [preprocessOpen, setPreprocessOpen] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [perToolGrams, setPerToolGrams] = useState<number[]>([]);
  const [printPrefs, setPrintPrefs] = useState<Record<PrintPref, boolean>>({
    flowCal: false,
    timelapse: false,
    autoLevel: false,
    ifs: true,
  });
  const [aiMonitoring, setAiMonitoring] = useState(true);
  const handledUrlRef = useRef<string | null>(null);
  const awaitingInteractive = useRef(false);
  const { activeUrl, connection, status, objectList } = useMoonraker();
  const ace = useACE();
  const { settings, update: updateSettings, loaded: settingsLoaded } = useSettings();
  // Bed of the printer this model is headed for, so the native preview draws the
  // machine you are actually on instead of always the U1's 270mm plate. Bambu
  // needs the serial too — one kind, two different plates.
  const activeMachine = useMemo(() => {
    const active = settings.printers.find((printer) => printer.id === settings.activePrinterId);
    return resolveMachineProfile(active);
  }, [settings.printers, settings.activePrinterId]);
  const activePrinterKind = useMemo(
    () =>
      settings.printers.find((printer) => printer.id === settings.activePrinterId)?.kind ?? null,
    [settings.printers, settings.activePrinterId],
  );
  const bambuExternalSpool = activePrinterKind === 'bambu-lan'
    && status.print_task_config?.bambu_filament_source === 'external';
  const toolLoad = useMemo(
    () => resolveToolLoad(
      status,
      objectList,
      ace.units,
      ace.hardwareDetected,
      connection,
      activePrinterKind,
    ),
    [status, objectList, ace.units, ace.hardwareDetected, connection, activePrinterKind],
  );
  // The AD5X reports its lanes over FlashForge's REST API, not Moonraker: it
  // publishes no print_task_config at all, so resolveFilamentSlots below finds
  // nothing and every lane silently falls back to the saved manual settings —
  // which is how the slicer ended up offering spools from a different printer.
  const materialStation = useMaterialStation();
  const filamentSlots = useMemo(
    () => {
      if (activePrinterKind === 'flashforge-ad5x') {
        const fromStation = materialStationSlots(materialStation.units);
        // Never fall through to the global manual U1 slots. If FlashForge
        // credentials are missing or its REST query has not answered yet,
        // unknown neutral lanes are more honest than cached filament.
        return fromStation ?? unavailableMaterialStationSlots();
      }
      return resolveFilamentSlots(
        status,
        settings.filamentSlotColors,
        settings.filamentSlotBrands,
        settings.filamentSlotMaterials,
        toolLoad,
      );
    },
    [activePrinterKind, materialStation.units, status, settings.filamentSlotColors, settings.filamentSlotBrands, settings.filamentSlotMaterials, toolLoad],
  );
  const effectiveFilamentSlotColors = useMemo(
    () => filamentSlots.map((slot) => slot.color),
    [filamentSlots],
  );

  // Keep native prefs aligned with the full per-slot filament picture so the
  // print preprocess sheet can label each lane exactly as the RN slicer does.
  useEffect(() => {
    if (!settingsLoaded) return;
    setFilamentSlots(
      filamentSlots.map((slot): NativeFilamentSlot => ({
        color: slot.color,
        material: slot.material,
        mainType: slot.mainType ?? '',
        subType: slot.subType ?? '',
        brand: slot.brand ?? '',
        status: slot.status,
      })),
    ).catch(() => {});
  }, [settingsLoaded, filamentSlots]);

  // Rotate the playful "sayings" while the prepare overlay is up so there's
  // always motion even between native progress ticks.
  useEffect(() => {
    if (!extracting) return;
    const id = setInterval(() => setSayingIdx((i) => (i + 1) % EXTRACT_SAYINGS.length), 2400);
    return () => clearInterval(id);
  }, [extracting]);

  // Mirror the printer list for the native print dialog's printer picker.
  // Send BOTH the preferred url and the alternate (LAN ↔ Tailscale) so the
  // native dialog can fail over when the user is away from home (LAN down).
  useEffect(() => {
    if (!settingsLoaded) return;
    setNativePrinters(
      settings.printers
        .map((p) => {
          const lan = normalizeMoonrakerUrl(p.url || '');
          const tailscale = normalizeMoonrakerUrl(p.tailscaleUrl || '');
          const primary = printerConnectionUrl(p);
          const alternate = primary === lan ? tailscale : lan;
          return { name: p.name, url: primary, tailscaleUrl: alternate };
        })
        .filter((p) => p.url || p.tailscaleUrl),
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
    setMwStats(null);
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
    // The tab can be reached before persisted printer settings and the native
    // slicer status finish their cold-start reads. Opening Android's picker in
    // that window races the activity result against initialization and also
    // renders the model against DEFAULT_SETTINGS (the U1), regardless of the
    // actual active printer.
    if (!settingsLoaded || result.state === 'loading') return;
    try {
      const file = await pickModelFile();
      applyOpenedFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(message)) return;
      showAlert({ title: 'Upload', message, icon: 'alert-circle-outline' });
    }
  }, [applyOpenedFile, result.state, settingsLoaded, showAlert]);

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
    setModelThumb(null);
    setModelStats([]);
    setMwStats(null);
    setDownload({ state: 'idle', message: '' });
  }, []);

  // Open-with can finish importing after the Slice tab first paints — subscribe
  // so we still show the model when the native handoff lands late.
  useEffect(() => subscribePendingModel(applyOpenedFile), [applyOpenedFile]);

  // The native Bambu preview cannot perform its own send: that verified path
  // needs the live RN MQTT session plus saved credentials. Its Upload & Print
  // button returns here and raises this one-shot request instead.
  useEffect(() => {
    let active = true;
    const openRequestedSend = async () => {
      if (!(await takeBambuSendRequest()) || !active) return;
      const last = await getLastSliceResult();
      if (!last || !active) {
        showAlert({
          title: 'Bambu print',
          message: 'The completed slice is no longer available. Slice the model again.',
          icon: 'alert-circle-outline',
        });
        return;
      }
      setSlice({ state: 'success', result: last });
      setPrintStart({ state: 'idle' });
      setSendProgress(0);
      setPreprocessOpen(true);
    };
    void openRequestedSend();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void openRequestedSend();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [showAlert]);

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
    setMwStats(null);
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
      // The 3MF itself usually has no embedded slice stats — the design API
      // does (time + filament per plate). Layers stay '--': not published.
      const plateStats = await fetchMakerWorldPlateStats(designId, instanceId || null);
      setMwStats(
        plateStats.length > 0
          ? {
              forPath: downloaded.filePath,
              stats: plateStats.map((s) => ({ ...s, layers: 0 })),
            }
          : null
      );
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
      setModelThumb(null);
      setModelStats([]);
      return;
    }
    if (platesFor === modelFilePath) return;
    getModelPlates(modelFilePath)
      .then((found) => {
        if (!active) return;
        setPlatesFor(modelFilePath);
        setPlates(found.length > 1 ? found : []);
        setSelectedPlate(null);
        setModelThumb(found[0]?.thumbnail ?? null);
      })
      .catch(() => {
        if (!active) return;
        setPlates([]);
        setSelectedPlate(null);
        setModelThumb(null);
      });
    getModelPlateStats(modelFilePath)
      .then((stats) => {
        if (active) setModelStats(stats);
      })
      .catch(() => {
        if (active) setModelStats([]);
      });
    return () => {
      active = false;
    };
  }, [modelFilePath, platesFor]);

  const choosePlate = useCallback(
    (plate: ModelPlate) => {
      if (selectedPlate?.id === plate.id) return;
      // Selection only — extraction happens in prepareAndSlice so tapping a
      // plate card is instant instead of blocking on the native repack.
      setSelectedPlate({ id: plate.id, name: plate.name });
      setModelThumb(plate.thumbnail ?? null);
      setSlice({ state: 'idle' });
      setUpload({ state: 'idle' });
      setPrintStart({ state: 'idle' });
    },
    [selectedPlate],
  );

  const prepareAndSlice = useCallback(async () => {
    if (download.state !== 'success') return;
    if (plates.length > 1 && !selectedPlate) {
      showAlert({ title: 'Plates', message: 'This model has multiple plates — pick one to slice first.' });
      return;
    }
    if (toolLoad.blockReason) {
      showAlert({ title: 'Filament', message: toolLoad.blockReason, icon: 'alert-circle-outline' });
      return;
    }
    let path = download.result.filePath;
    let title = download.result.fileName;
    setExtracting(true);
    const sub = addExtractProgressListener((p) => setExtractProgress(p));
    // Yield one frame so React paints the overlay BEFORE the (possibly very
    // fast) native extraction + activity launch. Without this, the native call
    // resolves and the Activity covers the screen before the overlay ever
    // renders — so the user only sees a dulled button, never the progress bar.
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      if (selectedPlate) {
        const extracted = await extractModelPlate(download.result.filePath, selectedPlate.id);
        path = extracted.filePath;
        title = `${download.result.fileName} — ${selectedPlate.name}`;
        setExtractProgress({ percent: 100, phase: 'Opening slicer…' });
      }
      const materialProfiles = await resolveNativeMaterialProfiles(
        connection === 'connected' ? activeUrl : null,
        filamentSlots,
      );
      // Bambu's file stays on logical tool 0. The selected AMS lane travels in
      // the project_file payload later; baking the physical lane into T-codes
      // would make the old U1-oriented engine emit the wrong tool semantics.
      // The loaded mask remains physical AMS truth, though: the native print
      // sheet uses it to decide which lanes can actually feed that logical tool.
      const bambuLane = toolLoad.firstLoaded ?? toolLoad.selectedTool;
      const bambu = activePrinterKind === 'bambu-lan';
      const previewColors = bambu
        ? [effectiveFilamentSlotColors[bambuLane] ?? effectiveFilamentSlotColors[0], ...effectiveFilamentSlotColors.slice(1)]
        : effectiveFilamentSlotColors;
      const sliceMaterials = bambu && materialProfiles[bambuLane]
        ? [materialProfiles[bambuLane], ...materialProfiles.slice(1)]
        : materialProfiles;
      await openNativeModelPreview(
        path,
        title,
        previewColors,
        colors.primary,
        connection === 'connected' ? activeUrl : null,
        bambu ? 0 : toolLoad.selectedTool,
        toolLoad.nativeLoadedToolMask,
        Boolean(selectedPlate),
        sliceMaterials,
        activeMachine,
      );
    } catch (error) {
      showAlert({
        title: 'Prepare & Slice',
        message: error instanceof Error ? error.message : String(error),
        icon: 'alert-circle-outline',
      });
    } finally {
      sub.remove();
      setExtractProgress(null);
      setExtracting(false);
    }
  }, [activeMachine, activePrinterKind, activeUrl, connection, download, effectiveFilamentSlotColors, filamentSlots, showAlert, toolLoad, plates, selectedPlate]);

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
        activeMachine,
      );
    } catch (error) {
      showAlert({
        title: 'Toolpath Preview',
        message: error instanceof Error ? error.message : String(error),
        icon: 'alert-circle-outline',
      });
    }
  }, [activeMachine, activeUrl, connection, download, showAlert, slice, toolLoad]);

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
    rawPrefs: Readonly<Record<PrintPref, boolean>>,
  ) => {
    if (slice.state !== 'success') return;
    // The dialog can swap printers, and the toggles are one state object — so a
    // time-lapse enabled for the U1 is still set after switching to an AD5X,
    // where the toggle is not even shown and the macros do not exist. Honour
    // only what the selected machine actually offers.
    const requestedPrefs = applicablePrefs(rawPrefs, {
      printerKind: activePrinterKind,
      multicolor: (slice.result.usedToolMask ?? 0) !== 0
        && [0, 1, 2, 3].filter((t) => ((slice.result.usedToolMask ?? 0) & (1 << t)) !== 0).length > 1,
    });
    if (!activeUrl) {
      setPrintStart({ state: 'error', message: 'Printer URL is blank.' });
      return;
    }
    const slicedTool = slice.result.initialTool ?? toolLoad.selectedTool;
    const fileRequiredMask = slice.result.usedToolMask ?? (1 << slicedTool);
    const fileTools = [0, 1, 2, 3].filter((t) => (fileRequiredMask & (1 << t)) !== 0);

    const isBambu = activePrinterKind === 'bambu-lan';
    // Bambu keeps file tools logical and sends their physical AMS routing in
    // project_file. Every existing printer keeps the old identity/remap path.
    const remap = toolRemap ?? {};
    const fullTarget: Record<number, number> = {};
    if (isBambu) {
      const routes = routeTools(
        fileTools,
        filamentSlots.map((slot) => ({
          index: slot.index,
          color: slot.color,
          brand: slot.brand,
          material: slot.material,
          mainType: slot.mainType,
          subType: slot.subType,
          status: slot.status,
        })),
        remap,
      );
      for (const ft of fileTools) fullTarget[ft] = routes[ft].lane;
    } else {
      for (const ft of fileTools) fullTarget[ft] = remap[ft] ?? ft;
    }
    const targets = fileTools.map((ft) => fullTarget[ft]);
    const allSameTarget = targets.length > 0 && targets.every((t) => t === targets[0]);
    const collapseSlot = allSameTarget ? targets[0] : -1;

    // Re-slice when the user routed any file tool to a different loaded slot.
    const routedElsewhere = !isBambu && fileTools.some((ft) => fullTarget[ft] !== ft);
    const canReslice =
      Boolean(slice.result.modelPath) &&
      Boolean(slice.result.sliceSettings) &&
      Boolean(slice.result.materialProfiles);
    const wantsReslice = routedElsewhere && canReslice;

    // Routing to a different material and NOT re-slicing means uploading gcode
    // whose temps/flow belong to the material it was sliced for. That used to
    // happen silently, which made it look like remapping simply did nothing —
    // the file went up unchanged and printed at the original material's temps.
    // Refuse instead of lying: the user can still print by re-slicing manually.
    if (routedElsewhere && !canReslice) {
      setPrintStart({
        state: 'error',
        message:
          'Cannot re-slice for the selected lane — the original model is no longer available. '
          + 'Re-open the model and slice again, or route this print back to its own lane.',
      });
      return;
    }

    const requiredToolMask = wantsReslice
      ? targets.reduce((mask, t) => mask | (1 << t), 0)
      : fileRequiredMask;
    const usedExtruders = [0, 1, 2, 3].filter((tool) => (requiredToolMask & (1 << tool)) !== 0);
    const missingTools = isBambu
      ? targets.some((lane) => filamentSlots.find((slot) => slot.index === lane)?.status === 'empty')
        ? bambuExternalSpool
          ? 'External Spool'
          : targets.map((lane) => `Lane ${lane + 1}`).join(', ')
        : null
      : missingLoadedTools(toolLoad, requiredToolMask);
    if (missingTools) {
      setPrintStart({ state: 'error', message: `Load filament in ${missingTools} before printing.` });
      return;
    }
    // One toolhead, so colors can only come from the material station — or, with
    // IFS off, from the external side spool. zmod's per-print IFS-off path is a
    // SET_ZCOLOR sent in place of the normal print start; see ifsOffPrintGcode.
    const ifsOff =
      printerProfile(activePrinterKind).printPrefs.includes('ifs') && !requestedPrefs.ifs;

    const sourceName = download.state === 'success' ? download.result.fileName : null;
    try {
      let gcodePath = slice.result.gcodePath;
      if (isBambu) {
        if (fileRequiredMask !== 1 || fileTools.length !== 1 || fileTools[0] !== 0) {
          throw new Error('Bambu LAN printing currently supports one logical filament only.');
        }
        const printer = settings.printers.find((entry) => entry.id === settings.activePrinterId);
        const host = bambuHostFromUrl(printer?.url ?? '');
        const serial = printer?.serialNumber?.trim() ?? '';
        const accessCode = printer?.checkCode?.trim() ?? '';
        if (!host || !serial || !accessCode) {
          throw new Error('The Bambu printer needs its LAN address, serial number, and access code.');
        }
        const serialPrefix = serial.toUpperCase().slice(0, 3);
        const p1s = serialPrefix === '01P';
        const fullSizeA1 = serialPrefix === '039';
        if (!p1s && !fullSizeA1) {
          throw new Error('Bambu LAN printing currently supports the P1S and full-size A1 only.');
        }
        const currentState = status?.print_stats?.state;
        if (currentState === 'printing' || currentState === 'paused') {
          throw new Error(`Printer is already ${currentState}.`);
        }
        const targetLane = fullTarget[0];
        const filament = filamentSlots.find((slot) => slot.index === targetLane);
        if (!filament || filament.status === 'empty') {
          throw new Error(bambuExternalSpool
            ? 'Load filament on the External Spool before printing.'
            : `Load filament in Lane ${targetLane + 1} before printing.`);
        }

        const remoteName = buildBambuProjectFilename(sourceName, gcodePath);
        setPrintStart({ state: 'starting', message: 'Uploading project over FTPS…' });
        setSendProgress(0.15);
        const uploaded = await uploadBambuPrintArtifact({
          host,
          serial,
          accessCode,
          gcodePath,
          remoteName,
          usedToolMask: fileRequiredMask,
          predictionSeconds: slice.result.estimatedTimeSeconds,
          weightGrams: slice.result.estimatedFilamentGrams,
          filamentType: bambuFilamentType(filament.mainType || filament.material),
          filamentColor: normalizeFilamentSlotColors([filament.color])[0],
        });
        setPrintStart({ state: 'starting', message: 'Waiting for printer confirmation…' });
        setSendProgress(0.75);
        await startBambuProjectFile({
          remoteName: uploaded.remoteName,
          subtaskName: uploaded.remoteName.replace(/\.gcode\.3mf$/i, ''),
          archiveMd5: uploaded.archiveMd5,
          toolToLane: { 0: bambuExternalSpool ? -1 : targetLane },
          // Preserve the payload accepted by the real P1S. The A1 is beta and
          // may have any supported plate installed, so let its firmware detect
          // the plate instead of falsely claiming it is SuperTack.
          bedType: p1s ? 'supertack_plate' : 'auto',
          useAms: !bambuExternalSpool,
          bedLeveling: requestedPrefs.autoLevel,
          flowCalibration: requestedPrefs.flowCal,
          timelapse: requestedPrefs.timelapse,
          vibrationCalibration: requestedPrefs.autoLevel,
        });
        setSendProgress(1);
        setPrintStart({ state: 'done', message: `Print started: ${uploaded.remoteName}` });
        setPreprocessOpen(false);
        setPrintSentNotice({ filename: uploaded.remoteName });
        router.push('/');
        return;
      }
      if (wantsReslice) {
        const onResliceProgress = (percentage: number) =>
          setSendProgress(0.05 + (Math.max(0, Math.min(100, percentage)) / 100) * 0.06);
        if (allSameTarget) {
          // Collapse: every object -> one material (single-tool slice).
          const chosenMaterial =
            filamentSlots.find((s) => s.index === collapseSlot)?.material ?? `slot ${collapseSlot}`;
          setPrintStart({ state: 'starting', message: `Re-slicing for ${chosenMaterial}…` });
          setSendProgress(0.05);
          // Collapsing rewrites per-object extruder tags inside a 3MF. An STL
          // carries no such tags — it is a single mesh — so there is nothing to
          // reassign and initialTool below already does the whole job. Running
          // the collapse on one threw "No objects found in <name>.stl", because
          // it looks for a 3D/3dmodel.model zip entry an STL does not have, and
          // that killed the send outright.
          const modelPath = slice.result.modelPath as string;
          const collapsedPath = /\.3mf$/i.test(modelPath)
            ? await collapseModelToTool(modelPath, collapseSlot)
            : modelPath;
          const resliced = await sliceModelFile(
            collapsedPath,
            {
              initialTool: collapseSlot,
              sliceSettings: slice.result.sliceSettings,
              materialProfiles: slice.result.materialProfiles,
              machineProfile: JSON.stringify(activeMachine),
            },
            onResliceProgress,
          );
          if (!resliced.success || !resliced.gcodePath) {
            throw new Error(resliced.errorMessage || 'Re-slice failed.');
          }
          gcodePath = resliced.gcodePath;
        } else {
          // Per-color remap: keep multi-color, route each file color to its slot.
          setPrintStart({ state: 'starting', message: 'Re-slicing per-color…' });
          setSendProgress(0.05);
          const extruderMap: Record<number, number> = {};
          for (const ft of fileTools) extruderMap[ft + 1] = fullTarget[ft];
          const forceExtruderCount = Math.max(...targets) + 1;
          const remappedPath = await remapModelExtruders(slice.result.modelPath as string, extruderMap);
          const resliced = await sliceModelFile(
            remappedPath,
            {
              initialTool: targets[0],
              sliceSettings: slice.result.sliceSettings,
              materialProfiles: slice.result.materialProfiles,
              forceExtruderCount,
              machineProfile: JSON.stringify(activeMachine),
            },
            onResliceProgress,
          );
          if (!resliced.success || !resliced.gcodePath) {
            throw new Error(resliced.errorMessage || 'Re-slice failed.');
          }
          gcodePath = resliced.gcodePath;
        }
      }
      setPrintStart({ state: 'starting', message: 'Uploading…' });
      setSendProgress(0.12);
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
      // PAXX/U1 firmware only — see supportsPrintPreferences. Other machines
      // have neither the macros nor print_task_config, so this both errored and
      // failed its own verification.
      if (activeMachine.supportsPrintPreferences) {
        await api.runGcode(
          activeUrl,
          `${buildAiMonitoringCommand(aiMonitoring, settings.aiDetectionSensitivity)}\nSET_MAIN_STATE MAIN_STATE=IDLE\nSET_PRINT_USED_EXTRUDERS EXTRUDERS=${usedExtruders.join(',')}\nSET_PRINT_PREFERENCES BED_LEVEL=${requestedPrefs.autoLevel ? 1 : 0} TIME_LAPSE_CAMERA=${requestedPrefs.timelapse ? 1 : 0} FLOW_CALIBRATE=${requestedPrefs.flowCal ? 1 : 0} FLOW_CALIBRATE_EXTRUDERS=0,1,2,3`,
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
      }
      setPrintStart({ state: 'starting', message: 'Starting print…' });
      if (ifsOff) {
        // IFS off: SET_ZCOLOR SILENT=2 starts the print with no material
        // prompt at all, so there is nothing to stage an intent for — every
        // T-command is ignored and the external side spool feeds the print.
        await api.runGcode(activeUrl, ifsOffPrintGcode(verifiedPath, requestedPrefs.autoLevel));
      } else {
        // A zmod printer answers this with a material-selection prompt. Stage the
        // mapping so it can be answered with the user's slots instead of the
        // printer's guess. Helix slices so the G-code's tool index already is the
        // physical slot, hence the identity map over the tools actually used.
        setPrintIntent({
          filename: verifiedPath,
          toolToSlot: Object.fromEntries(usedExtruders.map((tool) => [tool, tool])),
          // The AD5X takes levelling on its print macro, not as a preference.
          autoLevel: requestedPrefs.autoLevel,
        });
        await api.startPrint(activeUrl, verifiedPath);
      }
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
  }, [activeMachine, activePrinterKind, activeUrl, aiMonitoring, bambuExternalSpool, download, filamentSlots, router, settings.activePrinterId, settings.aiDetectionSensitivity, settings.printers, slice, status, toolLoad, toolRemap]);

  const refresh = async () => {
    setRefreshing(true);
    await checkStatus();
    setRefreshing(false);
  };

  const ready = result.state === 'ready' ? result.status.loaded && !result.status.coreError : false;
  const startupReady = settingsLoaded && result.state !== 'loading';
  const printerReady = connection === 'connected' && Boolean(activeUrl);
  const hasModel = download.state === 'success';
  const sliced = slice.state === 'success';
  // Pre-slice stats: the file's own embedded G-code first (any 3MF), then the
  // MakerWorld API numbers for in-app downloads. Selected plate wins, then
  // plate 1 — real numbers on the cards before anything is sliced here.
  const plateStats =
    modelStats.length > 0
      ? modelStats
      : mwStats && mwStats.forPath === modelFilePath
        ? mwStats.stats
        : [];
  const embeddedStats = sliced
    ? null
    : plateStats.find((s) => s.id === selectedPlate?.id) ?? plateStats[0] ?? null;
  const slicedInitialTool = slice.state === 'success'
    ? slice.result.initialTool ?? toolLoad.selectedTool
    : toolLoad.selectedTool;
  const slicedRequiredToolMask = slice.state === 'success'
    ? slice.result.usedToolMask ?? (1 << slicedInitialTool)
    : 1 << slicedInitialTool;
  // A Bambu slice deliberately asks for logical T0 even when AMS Lane 1 is
  // empty; the dialog routes that logical tool to a loaded physical lane.
  const missingPrintTools = sliced && activePrinterKind !== 'bambu-lan'
    ? missingLoadedTools(toolLoad, slicedRequiredToolMask)
    : null;
  const printDialogSlots = useMemo(
    () => filamentSlots.filter((slot) => (slicedRequiredToolMask & (1 << slot.index)) !== 0),
    [filamentSlots, slicedRequiredToolMask],
  );
  // Existing printers preserve their identity defaults exactly. Bambu passes
  // manual choices only so the dialog's routeTools can auto-pick a loaded AMS
  // lane when logical T0's same-numbered lane is empty.
  const printDialogAssignments = useMemo(() => {
    if (activePrinterKind === 'bambu-lan') return toolRemap ?? {};
    const m: Record<number, number> = {};
    for (const slot of printDialogSlots) m[slot.index] = toolRemap?.[slot.index] ?? slot.index;
    return m;
  }, [activePrinterKind, printDialogSlots, toolRemap]);

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

  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const heroHeight = Math.round((width - PAGE * 2) * (9 / 16));

  const heroState = !hasModel
    ? download.state === 'downloading'
      ? { label: 'IMPORTING', color: P.warn }
      : download.state === 'error'
        ? { label: 'IMPORT FAILED', color: P.danger }
        : { label: 'NO MODEL', color: P.dim }
    : extracting
      ? { label: 'PREPARING', color: P.warn }
      : sliced
        ? { label: 'SLICED', color: P.success }
        : toolLoad.blockReason
          ? { label: 'BLOCKED', color: P.danger }
          : { label: 'READY TO SLICE', color: P.accent };

  // The pinned action says why it can't run rather than just going grey. The
  // order matters: the reason nearest the user's next tap wins.
  const primaryAction = (() => {
    if (!startupReady) {
      return { icon: 'progress-wrench' as const, label: 'Loading printer…', enabled: false, onPress: noop };
    }
    if (!hasModel) {
      const importing = download.state === 'downloading';
      return {
        icon: 'tray-arrow-up' as const,
        label: importing ? 'Importing…' : 'Upload .3mf / .stl',
        enabled: !importing,
        onPress: pickLocalModel,
      };
    }
    if (extracting) {
      return { icon: 'progress-clock' as const, label: 'Preparing…', enabled: false, onPress: noop };
    }
    if (sliced) {
      return {
        icon: 'printer-3d' as const,
        label: printerReady ? 'Upload & Print' : 'Printer offline',
        enabled: printerReady,
        onPress: openPreprocess,
      };
    }
    if (toolLoad.blockReason) {
      return {
        icon: 'alert-circle-outline' as const,
        label: 'Load filament to slice',
        enabled: false,
        onPress: noop,
      };
    }
    if (!ready) {
      return { icon: 'progress-wrench' as const, label: 'Slicer starting…', enabled: false, onPress: noop };
    }
    if (plates.length > 1 && !selectedPlate) {
      return { icon: 'cube-scan' as const, label: 'Pick a plate above', enabled: false, onPress: noop };
    }
    return { icon: 'cube-scan' as const, label: 'Prepare & Slice', enabled: true, onPress: prepareAndSlice };
  })();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={P.dim} />
          }
        >
          {!hasModel ? (
            <Pressable
              onPress={pickLocalModel}
              disabled={!startupReady || download.state === 'downloading'}
            >
              <HeroCard
                thumbUri={sliced ? sliceThumb : modelThumb}
                height={heroHeight}
                stateLabel={heroState.label}
                stateColor={heroState.color}
                fileName={null}
                percent={extracting && extractProgress ? extractProgress.percent : null}
                onClear={clearModel}
                expand
              />
            </Pressable>
          ) : (
            <HeroCard
              thumbUri={sliced ? sliceThumb : modelThumb}
              height={heroHeight}
              stateLabel={heroState.label}
              stateColor={heroState.color}
              fileName={hasModel ? download.result.fileName : null}
              percent={extracting && extractProgress ? extractProgress.percent : null}
              onClear={clearModel}
              expand
            />
          )}

          {extracting && extractProgress ? (
            <ProgressBar
              progress={Math.max(0.02, Math.min(1, extractProgress.percent / 100))}
              color={P.accent}
              trackColor={P.surfaceAlt}
              height={7}
            />
          ) : null}

          {toolLoad.blockReason ? (
            <Banner tone="bad" icon="alert-circle-outline" text={toolLoad.blockReason} />
          ) : null}

          {sliced && missingPrintTools ? (
            <Banner
              tone="bad"
              icon="alert-circle-outline"
              text={`${missingPrintTools} not loaded — this print needs them.`}
            />
          ) : null}

          {!ready ? (
            <Banner tone="muted" icon="progress-wrench" text="Slicer engine is still starting." />
          ) : null}

          {!mwAuthed ? (
            <Banner
              tone="muted"
              icon="cloud-off-outline"
              text="MakerWorld login is in Settings — required to import shared models."
              action="Settings"
              onAction={() => router.push('/settings')}
            />
          ) : null}

          {printStart.state === 'error' ? (
            <Banner tone="bad" icon="printer-alert" text={printStart.message} />
          ) : null}

          {download.message && !toolLoad.blockReason ? (
            <Text
              style={[
                styles.status,
                download.state === 'success'
                  ? { color: P.success }
                  : download.state === 'error'
                    ? { color: P.danger }
                    : { color: P.dim },
              ]}
            >
              {download.message}
            </Text>
          ) : null}

          {sharedLink?.makerWorldUrl && !hasModel && download.state !== 'downloading' ? (
            <Secondary
              icon="download"
              label="Import from link"
              accent
              onPress={() => startDownload(sharedLink.makerWorldUrl!, true)}
            />
          ) : null}

          {hasModel && plates.length > 1 ? (
            <PlateStrip
              plates={plates}
              selectedId={selectedPlate?.id ?? null}
              onPick={choosePlate}
              disabled={extracting}
            />
          ) : null}

          <StatRow
            on={sliced || embeddedStats !== null}
            layers={
              sliced
                ? String(slice.result.totalLayers)
                : embeddedStats && embeddedStats.layers > 0
                  ? String(embeddedStats.layers)
                  : null
            }
            time={
              sliced
                ? formatDuration(slice.result.estimatedTimeSeconds)
                : embeddedStats && embeddedStats.timeSeconds > 0
                  ? formatDuration(embeddedStats.timeSeconds)
                  : null
            }
            grams={
              sliced
                ? `${slice.result.estimatedFilamentGrams.toFixed(1)} g`
                : embeddedStats && embeddedStats.grams > 0
                  ? `${embeddedStats.grams.toFixed(1)} g`
                  : null
            }
          />

          <ToolRail
            slots={filamentSlots}
            onEdit={setEditingSlot}
            externalSpool={bambuExternalSpool}
          />

          {sliced ? <Secondary icon="close" label="Cancel slice" onPress={dismissSlice} /> : null}
        </ScrollView>
      </SafeAreaView>

      <ActionBar
        icon={primaryAction.icon}
        label={primaryAction.label}
        enabled={primaryAction.enabled}
        onPress={primaryAction.onPress}
        bottomInset={0}
      />

      {editingSlot != null ? (
        <FilamentEditor slot={editingSlot} onClose={() => setEditingSlot(null)} />
      ) : null}

    {extracting ? (
      <View style={styles.prepareOverlay}>
        <View style={styles.prepareCard}>
          <View style={styles.prepareIcon}>
            <MaterialCommunityIcons name="cube-scan" size={26} color={P.accent} />
          </View>
          <Text style={styles.prepareTitle}>
            {selectedPlate ? `Preparing ${selectedPlate.name}` : 'Preparing model'}
          </Text>
          {extractProgress ? (
            <>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(2, Math.min(100, extractProgress.percent))}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressPct}>{extractProgress.percent}%</Text>
              <Text style={styles.preparePhase}>{extractProgress.phase}</Text>
              <Text style={styles.prepareSaying}>{EXTRACT_SAYINGS[sayingIdx]}</Text>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={P.accent} />
              <Text style={styles.prepareSub}>Opening slicer…</Text>
            </>
          )}
        </View>
      </View>
    ) : null}

    <PrintPreprocessDialog
      visible={preprocessOpen}
      onClose={() => {
        setPreprocessOpen(false);
        setToolRemap(null);
      }}
      fileName={download.state === 'success' ? download.result.fileName : 'print.gcode'}
      estTimeSeconds={slice.state === 'success' ? slice.result.estimatedTimeSeconds : 0}
      estGramsTotal={slice.state === 'success' ? slice.result.estimatedFilamentGrams : 0}
      thumbnail={sliceThumb}
      printers={settings.printers.map((p) => ({ id: p.id, name: p.name }))}
      activePrinterId={settings.activePrinterId}
      onSelectPrinter={selectPrinter}
      slots={printDialogSlots}
      availableSlots={filamentSlots}
      assignments={printDialogAssignments}
      onAssignSlot={(_fileTool, loadedSlot) =>
        setToolRemap((prev) => ({ ...(prev ?? {}), [_fileTool]: loadedSlot }))
      }
      perToolGrams={perToolGrams}
      prefs={printPrefs}
      onTogglePref={(pref) => setPrintPrefs((prev) => ({ ...prev, [pref]: !prev[pref] }))}
      aiMonitoring={aiMonitoring}
      onToggleAiMonitoring={() => setAiMonitoring((enabled) => !enabled)}
      sending={printStart.state === 'starting'}
      progress={sendProgress}
      statusMessage={printStart.state === 'starting' ? printStart.message : null}
      errorMessage={printStart.state === 'error' ? printStart.message : null}
      onSend={uploadAndPrint}
      printerKind={activePrinterKind}
      externalSpool={bambuExternalSpool}
      // Mirrors the send-time gate in uploadAndPrint, so the sheet only promises
      // a re-slice when one can actually run.
      canReslice={
        slice.state === 'success'
        && Boolean(slice.result.modelPath)
        && Boolean(slice.result.sliceSettings)
        && Boolean(slice.result.materialProfiles)
      }
    />
    {alertDialog}
    </View>
  );
}

function noop() {}

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

function buildBambuProjectFilename(sourceName: string | null | undefined, gcodePath: string): string {
  return buildPrinterUploadFilename(sourceName, gcodePath).replace(/\.gcode$/i, '.gcode.3mf');
}

function bambuHostFromUrl(url: string): string {
  return url.trim().replace(/^\w+:\/\//, '').replace(/[/:].*$/, '');
}

function bambuFilamentType(value: string): string {
  return (value || 'PLA')
    .trim()
    .replace(/[^A-Za-z0-9+_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'PLA';
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
  printerKind: PrinterKind | null,
): ToolLoadInfo {
  const slotCount = status.print_task_config?.bambu_filament_source === 'external' ? 1 : 4;
  const slots: ToolLoadSlot[] = Array.from(
    { length: slotCount },
    (_, index) => ({ index, status: 'unknown' }),
  );
  let source: ToolLoadInfo['source'] = 'unknown';
  let hasData = false;

  // A Bambu reconnect retains the last complete MQTT report while the new
  // socket comes up. Keep that printer-authored AMS occupancy visible instead
  // of flashing old manual U1 slots, but retain the connected-only rule for
  // Moonraker printers whose stale sensor state must not authorize a print.
  const mayUseReportedSlots = canUseReportedFilamentSlots(connection, printerKind);
  if (mayUseReportedSlots && Array.isArray(status.print_task_config?.filament_exist)) {
    source = 'printer';
    for (let index = 0; index < slotCount; index++) {
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
        if (lane.index < 0 || lane.index >= slots.length) continue;
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
        if (index == null || index < 0 || index >= slots.length) continue;
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
    ? 'No loaded filament detected. Load filament before slicing or printing.'
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
  const slotCount = ptc.bambu_filament_source === 'external' ? 1 : 4;

  return Array.from({ length: slotCount }, (_, index) => {
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
      brand: printerBrand && printerBrand !== 'NONE' && printerBrand !== 'GENERIC'
        ? printerBrand
        : fallbackBrand,
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
  root: { flex: 1, backgroundColor: P.bg },
  flex: { flex: 1 },
  // Bottom padding clears the pinned action bar.
  content: { padding: PAGE, paddingBottom: 108, gap: 11, flexGrow: 1 },
  status: { fontSize: 12, fontWeight: '700' },

  // Prepare overlay, restyled into the Cockpit palette with the rest of the tab.
  // Kept as a full-screen block rather than folded inline: extraction locks the
  // screen anyway, and the sayings need somewhere to live.
  prepareOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha('#000000', 0.74),
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  prepareCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    padding: 22,
    gap: 13,
    alignItems: 'center',
  },
  prepareIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(P.accent, 0.12),
  },
  prepareTitle: {
    color: P.text,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  prepareSub: { color: P.dim, fontSize: 13, fontWeight: '600' },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: P.surfaceAlt,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: P.accent },
  progressPct: { color: P.text, fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  preparePhase: { color: P.accent, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  prepareSaying: {
    color: P.dim,
    fontSize: 12,
    fontWeight: '600',
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
