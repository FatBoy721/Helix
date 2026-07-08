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
  getGcodeThumbnail,
  getLastSliceResult,
  getMakerWorldCookies,
  getNativeSlicerStatus,
  getSharedMakerWorldLink,
  NativeMakerWorldDownload,
  NativeSliceResult,
  NativeSlicerStatus,
  openMakerWorldDownloader,
  openNativeGcodePreview,
  openNativeModelPreview,
  setFilamentSlotColors,
  SharedMakerWorldLink,
  uploadGcodeToPrinter,
} from '../../services/nativeSlicer';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useACE } from '../../hooks/useACE';
import type { AceUnit } from '../../hooks/useACE';
import { useSettings } from '../../hooks/useSettings';
import FilamentSlotsEditor, { type FilamentSlotDisplay } from '../../components/FilamentSlotsEditor';
import { normalizeFilamentSlotColors } from '../../constants/filamentColors';
import { takeMwDownload } from '../../services/mwBus';
import { api, thumbnailUrl } from '../../services/moonraker';

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
  | { state: 'done'; message: string; filename: string; moonrakerPath: string; preview: UploadPreview }
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
      settings.filamentSlotMaterials,
      toolLoad,
    ),
    [status, settings.filamentSlotColors, settings.filamentSlotMaterials, toolLoad],
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
    }, [syncLastSlice, download])
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
    async (gcodePath: string, sourceName?: string | null) => {
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
        });
      } catch (error) {
        setUpload({
          state: 'error',
          message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [activeUrl]
  );

  const prepareAndSlice = useCallback(async () => {
    if (download.state !== 'success') return;
    if (toolLoad.blockReason) {
      Alert.alert('Filament', toolLoad.blockReason);
      return;
    }
    try {
      await openNativeModelPreview(
        download.result.filePath,
        download.result.fileName,
        effectiveFilamentSlotColors,
        colors.primary,
        connection === 'connected' ? activeUrl : null,
        toolLoad.selectedTool,
        toolLoad.nativeLoadedToolMask,
      );
    } catch (error) {
      Alert.alert('Prepare & Slice', error instanceof Error ? error.message : String(error));
    }
  }, [activeUrl, connection, download, effectiveFilamentSlotColors, toolLoad]);

  const updateFilamentSlots = useCallback(
    async (next: string[]) => {
      const normalized = normalizeFilamentSlotColors(next);
      await updateSettings({ filamentSlotColors: normalized });
      try {
        await setFilamentSlotColors(normalized);
      } catch {
        // Native module unavailable on non-Android — settings still saved.
      }
    },
    [updateSettings],
  );

  const updateFilamentMaterials = useCallback(
    async (next: string[]) => {
      const normalized = Array.from({ length: 4 }, (_, i) => {
        const value = next[i]?.trim().toUpperCase();
        return value || settings.filamentSlotMaterials[i] || 'PLA';
      });
      await updateSettings({ filamentSlotMaterials: normalized });
    },
    [settings.filamentSlotMaterials, updateSettings],
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

  const startUploadedPrint = useCallback(async () => {
    if (!activeUrl) {
      setPrintStart({ state: 'error', message: 'Printer URL is blank.' });
      return;
    }
    if (upload.state !== 'done') {
      setPrintStart({ state: 'error', message: 'Upload a verified G-code file first.' });
      return;
    }
    const initialTool = slice.state === 'success' ? slice.result.initialTool ?? toolLoad.selectedTool : toolLoad.selectedTool;
    const requiredToolMask = slice.state === 'success'
      ? slice.result.usedToolMask ?? (1 << initialTool)
      : 1 << initialTool;
    const missingTools = missingLoadedTools(toolLoad, requiredToolMask);
    if (missingTools) {
      setPrintStart({ state: 'error', message: `Load filament in ${missingTools} before printing.` });
      return;
    }

    setPrintStart({ state: 'starting', message: `Starting ${upload.moonrakerPath}...` });
    try {
      await api.startPrint(activeUrl, upload.moonrakerPath);
      setPrintStart({ state: 'done', message: `Print started: ${upload.moonrakerPath}` });
      router.replace('/');
    } catch (error) {
      setPrintStart({
        state: 'error',
        message: `Start failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [activeUrl, router, slice, toolLoad, upload]);

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
    return () => {
      active = false;
    };
  }, [slicedGcodePath]);

  return (
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
          slotMaterials={settings.filamentSlotMaterials}
          slots={filamentSlots}
          onChange={updateFilamentSlots}
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
          <Text style={styles.fileName}>{download.result.fileName}</Text>
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
        {hasModel ? (
          <TouchableOpacity
            style={[styles.button, (!ready || toolLoad.blockReason) && styles.buttonOff]}
            disabled={!ready || Boolean(toolLoad.blockReason)}
            onPress={prepareAndSlice}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="cube-scan" size={20} color={colors.text} />
            <Text style={styles.buttonText}>Prepare & Slice</Text>
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
            style={styles.secondaryButton}
            onPress={openToolpathPreview}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="layers-triple-outline" size={18} color={colors.text} />
            <Text style={styles.buttonText}>View toolpaths</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, (!printerReady || upload.state === 'uploading') && styles.buttonOff]}
            disabled={!printerReady || upload.state === 'uploading'}
            onPress={() => startUpload(slice.result.gcodePath, download.result.fileName)}
            activeOpacity={0.85}
          >
            {upload.state === 'uploading' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <MaterialCommunityIcons
                name={upload.state === 'done' ? 'check' : 'printer-3d'}
                size={18}
                color={colors.text}
              />
            )}
            <Text style={styles.buttonText}>
              {upload.state === 'done'
                ? 'Uploaded'
                : printerReady
                  ? 'Upload G-code'
                  : 'Printer offline'}
            </Text>
          </TouchableOpacity>
          {upload.state === 'done' ? (
            <>
              <View style={styles.previewRow}>
                {upload.preview.thumbnail ? (
                  <Image source={{ uri: upload.preview.thumbnail }} style={styles.previewImage} resizeMode="cover" />
                ) : (
                  <View style={[styles.previewImage, styles.previewPlaceholder]}>
                    <MaterialCommunityIcons name="file-code-outline" size={28} color={colors.subtext} />
                  </View>
                )}
                <View style={styles.previewText}>
                  <Text style={styles.previewTitle}>{upload.preview.displayName}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  styles.button,
                  (!printerReady || printStart.state === 'starting' || missingPrintTools) && styles.buttonOff,
                ]}
                disabled={!printerReady || printStart.state === 'starting' || Boolean(missingPrintTools)}
                onPress={startUploadedPrint}
                activeOpacity={0.85}
              >
                {printStart.state === 'starting' ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <MaterialCommunityIcons
                    name={printStart.state === 'done' ? 'check' : 'play'}
                    size={18}
                    color={colors.text}
                  />
                )}
                <Text style={styles.buttonText}>
                  {missingPrintTools
                    ? `Load ${missingPrintTools}`
                    : printStart.state === 'done'
                      ? 'Print started'
                      : 'Start print'}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
          {upload.state === 'error' ? (
            <Text style={[styles.value, styles.bad]}>{upload.message}</Text>
          ) : null}
          {printStart.state === 'error' ? (
            <Text style={[styles.value, styles.bad]}>{printStart.message}</Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
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
    const fallbackColor = normalizeFilamentSlotColors(manualColors)[index];
    const fallbackMaterial = manualMaterials[index] || 'PLA';

    return {
      index,
      status: loadStatus,
      color: loadStatus === 'empty' ? '#30343A' : printerColor ?? fallbackColor,
      material: loadStatus === 'empty' ? 'Empty' : printerMaterial || fallbackMaterial,
      source: printerColor || printerMaterial ? 'printer' : 'manual',
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
  const vendor = arrayString(ptc.filament_vendor, index);
  const type = arrayString(ptc.filament_type, index);
  const subType = arrayString(ptc.filament_sub_type, index);
  if (!type || type === 'NONE') return '';
  return [vendor && vendor !== 'NONE' ? vendor : '', type, subType && subType !== 'NONE' ? subType : '']
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
