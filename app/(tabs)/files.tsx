import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMoonraker } from '../../hooks/useMoonraker';
import { api, FileEntry, printerConnectionUrl, thumbnailUrl } from '../../services/moonraker';
import HistoryView from '../../components/HistoryView';
import TimelapseView from '../../components/TimelapseView';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';
import { useThemedAlert } from '../../hooks/useThemedAlert';
import { useSettings } from '../../hooks/useSettings';
import PrintPreprocessDialog, { type PrintPref } from '../../components/PrintPreprocessDialog';
import type { FilamentSlotDisplay } from '../../components/FilamentSlotsEditor';
import { normalizeFilamentSlotColors } from '../../constants/filamentColors';
import * as FileSystem from 'expo-file-system/legacy';
import { fileUrl } from '../../services/moonraker';
import { uploadGcodeToPrinter } from '../../services/nativeSlicer';

// path|modified -> thumbnail URL, null = file genuinely has no thumbnail.
// cached at module level so scrolling doesn't re-hit /server/files/metadata
// for every row. modified is in the key so re-sliced files bust the cache.
const thumbCache = new Map<string, string | null>();

function FileThumb({ base, file }: { base: string; file: FileEntry }) {
  const cacheKey = `${file.path}|${file.modified}`;
  const [thumb, setThumb] = useState<string | null | undefined>(thumbCache.get(cacheKey));

  useEffect(() => {
    if (thumb !== undefined || !base) return;
    let live = true;
    (async () => {
      try {
        const meta: any = await api.metadata(base, file.path);
        const thumbs: any[] = Array.isArray(meta?.thumbnails) ? meta.thumbnails : [];
        const best = thumbs.reduce(
          (a, b) => (!a || (b?.width ?? 0) > (a.width ?? 0) ? b : a),
          null as any
        );
        const url = best?.relative_path ? thumbnailUrl(base, file.path, best.relative_path) : null;
        thumbCache.set(cacheKey, url);
        if (live) setThumb(url);
      } catch {
        thumbCache.set(cacheKey, null);
        if (live) setThumb(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [base, cacheKey, thumb, file.path]);

  if (thumb) {
    return <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />;
  }
  return (
    <View style={[styles.thumb, styles.thumbPlaceholder]}>
      <MaterialCommunityIcons name="file-code-outline" size={24} color={colors.subtext} />
    </View>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function FilesScreen() {
  const { connection, activeUrl, status } = useMoonraker();
  const { settings } = useSettings();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'files' | 'history' | 'timelapse'>('files');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<any | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [printPrefs, setPrintPrefs] = useState<Record<PrintPref, boolean>>({
    flowCal: false,
    timelapse: false,
    autoLevel: false,
  });
  const [assignments, setAssignments] = useState<Record<number, number>>({});
  const [selectedPrinterId, setSelectedPrinterId] = useState(settings.activePrinterId);
  const [printerStatuses, setPrinterStatuses] = useState<Record<string, { label: string; busy: boolean; selectable: boolean }>>({});
  const { showAlert, alertDialog } = useThemedAlert();

  const printState: string = status.print_stats?.state ?? '';

  const refresh = useCallback(async () => {
    if (!activeUrl) return;
    setLoading(true);
    setError('');
    try {
      const list = await api.listFiles(activeUrl);
      setFiles([...list].sort((a, b) => b.modified - a.modified));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [activeUrl]);

  useEffect(() => {
    if (connection === 'connected') refresh();
  }, [connection, refresh]);

  const openPrintModal = useCallback(async (file: FileEntry) => {
    if (printState === 'printing' || printState === 'paused') {
      showAlert({
        title: t('Printer busy'),
        message: t('A print is already in progress.'),
        icon: 'printer-alert',
      });
      return;
    }
    setSelectedFile(file);
    setSelectedMeta(null);
    setAssignments({});
    setSelectedPrinterId(settings.activePrinterId);
    setModalError(null);
    setModalLoading(true);
    try {
      setSelectedMeta(await api.metadata(activeUrl, file.path));
    } catch {
      setSelectedMeta({});
    } finally {
      setModalLoading(false);
    }
  }, [activeUrl, printState, settings.activePrinterId, showAlert]);

  const printerOptions = useMemo(() => settings.printers.map((printer) => ({
    id: printer.id,
    name: printer.name,
    url: printerConnectionUrl(printer),
  })), [settings.printers]);

  useEffect(() => {
    if (!selectedFile || printerOptions.length === 0) return;
    let live = true;
    setPrinterStatuses(Object.fromEntries(printerOptions.map((printer) => [printer.id, {
      label: 'Checking…',
      busy: false,
      selectable: Boolean(printer.url),
    }])));
    Promise.all(printerOptions.map(async (printer) => {
      if (!printer.url) return [printer.id, { label: 'No URL', busy: false, selectable: false }] as const;
      try {
        const result = await api.queryObjects<{ print_stats?: { state?: string } }>(printer.url, ['print_stats']);
        const state = result?.status?.print_stats?.state ?? 'unknown';
        const busy = state === 'printing' || state === 'paused';
        const label = state === 'printing' ? 'Printing' : state === 'paused' ? 'Paused' : state === 'error' ? 'Error' : 'Ready';
        return [printer.id, { label, busy, selectable: !busy }] as const;
      } catch {
        return [printer.id, { label: 'Offline', busy: false, selectable: false }] as const;
      }
    })).then((entries) => {
      if (live) setPrinterStatuses(Object.fromEntries(entries));
    });
    return () => { live = false; };
  }, [printerOptions, selectedFile]);

  const selectedPrinter = printerOptions.find((printer) => printer.id === selectedPrinterId) ?? printerOptions[0];

  const closePrintModal = useCallback(() => {
    if (sending) return;
    setSelectedFile(null);
    setSelectedMeta(null);
    setModalError(null);
  }, [sending]);

  const loadedSlots = useMemo(() => resolveFileSlots(
    status,
    settings.filamentSlotColors,
    settings.filamentSlotBrands,
    settings.filamentSlotMaterials,
  ), [
    status,
    settings.filamentSlotColors,
    settings.filamentSlotBrands,
    settings.filamentSlotMaterials,
  ]);
  const fileSlots = useMemo(() => {
    const used = selectedMeta?.filament_used_mm ?? selectedMeta?.filament_weight;
    if (!Array.isArray(used) || !used.some((value: unknown) => Number(value) > 0)) return loadedSlots;
    return loadedSlots.filter((slot) => Number(used[slot.index]) > 0);
  }, [loadedSlots, selectedMeta]);
  const availableSlots = useMemo(() => {
    const loaded = loadedSlots.filter((slot) => slot.status === 'loaded');
    return loaded.length > 0 ? loaded : loadedSlots;
  }, [loadedSlots]);
  const requiredColors = useMemo(() => {
    const raw: string[] = typeof selectedMeta?.filament_colour === 'string'
      ? selectedMeta.filament_colour.split(';')
      : [];
    return raw.reduce<Record<number, string>>((result, value, index) => {
      const color = value.trim().replace(/^#/, '');
      if (/^[0-9a-f]{6,8}$/i.test(color) && fileSlots.some((slot) => slot.index === index)) {
        result[index] = `#${color.slice(0, 6)}`;
      }
      return result;
    }, {});
  }, [fileSlots, selectedMeta]);

  useEffect(() => {
    if (!selectedMeta) return;
    setAssignments((previous) => {
      const initial = createInitialAssignments(selectedMeta, availableSlots);
      if (Object.keys(previous).length === 0) return initial;
      const next = { ...previous };
      for (const [fileTool, defaultSlot] of Object.entries(initial)) {
        if (next[Number(fileTool)] == null) next[Number(fileTool)] = defaultSlot;
      }
      return next;
    });
  }, [availableSlots, selectedMeta]);

  const assignSlot = useCallback((fileTool: number, loadedSlot: number) => {
    setAssignments((previous) => {
      const otherTool = Object.keys(previous).find(
        (key) => Number(key) !== fileTool && previous[Number(key)] === loadedSlot,
      );
      if (otherTool == null) return { ...previous, [fileTool]: loadedSlot };
      return {
        ...previous,
        [fileTool]: loadedSlot,
        [Number(otherTool)]: previous[fileTool] ?? fileTool,
      };
    });
  }, []);

  const reprint = useCallback(async (prefs: Readonly<Record<PrintPref, boolean>>) => {
    if (!selectedFile || !activeUrl || !selectedPrinter?.url) return;
    const targetUrl = selectedPrinter.url;
    setSending(true);
    setModalError(null);
    setSendProgress(0.2);
    try {
      const materialMismatch = findMaterialMismatch(selectedMeta, assignments, availableSlots);
      if (materialMismatch) {
        throw new Error(
          `This file was sliced for ${materialMismatch.fileMaterial}, but ${materialMismatch.slotName} is loaded in T${materialMismatch.loadedSlot}. Re-slice the model with the loaded material before printing.`,
        );
      }
      await api.runGcode(
        targetUrl,
        `SET_MAIN_STATE MAIN_STATE=IDLE\nSET_PRINT_PREFERENCES BED_LEVEL=${prefs.autoLevel ? 1 : 0} TIME_LAPSE_CAMERA=${prefs.timelapse ? 1 : 0} FLOW_CALIBRATE=${prefs.flowCal ? 1 : 0} FLOW_CALIBRATE_EXTRUDERS=0,1,2,3`,
      );
      setSendProgress(0.65);
      let printPath = selectedFile.path;
      if (targetUrl !== activeUrl || Object.entries(assignments).some(([fileTool, loadedSlot]) => Number(fileTool) !== loadedSlot)) {
        const sourcePath = `${FileSystem.cacheDirectory ?? ''}helix-reprint-source-${Date.now()}.gcode`;
        const outputPath = `${FileSystem.cacheDirectory ?? ''}helix-reprint-${Date.now()}.gcode`;
        await FileSystem.downloadAsync(fileUrl(activeUrl, 'gcodes', selectedFile.path), sourcePath);
        const source = await FileSystem.readAsStringAsync(sourcePath);
        const remapped = remapGcodeTools(source, assignments);
        await FileSystem.writeAsStringAsync(outputPath, remapped);
        const uploadName = `${fileStem(selectedFile.path)}_helix_reprint_${Date.now()}.gcode`;
        const uploaded = await uploadGcodeToPrinter(targetUrl, uploadName, outputPath);
        printPath = uploaded?.path ?? uploadName;
      }
      await api.startPrint(targetUrl, printPath);
      setSendProgress(1);
      const printed = printPath;
      closePrintModal();
      showAlert({ title: t('Print started'), message: printed, icon: 'check-circle' });
    } catch (e: any) {
      setModalError(String(e?.message ?? e));
    } finally {
      setSending(false);
    }
  }, [activeUrl, assignments, closePrintModal, selectedFile, showAlert]);

  const empty = useMemo(
    () => (
      <Text style={styles.empty}>
        {connection !== 'connected'
          ? t('Not connected')
          : error
            ? `${t('Error')}: ${error}`
            : t('No G-code files on printer')}
      </Text>
    ),
    [connection, error]
  );

  return (
    <>
      <View style={styles.screen}>
        <View style={styles.segmentRow}>
        {(['files', 'history', 'timelapse'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segment, mode === m && { backgroundColor: colors.primary }]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'files' ? t('Files') : m === 'history' ? t('History') : t('Timelapse')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mode === 'history' ? (
        <HistoryView base={activeUrl} connected={connection === 'connected'} />
      ) : mode === 'timelapse' ? (
        <TimelapseView base={activeUrl} connected={connection === 'connected'} />
      ) : (
      <FlatList
        data={files}
        keyExtractor={(item) => item.path}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.subtext} />
        }
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.fileCard} onPress={() => openPrintModal(item)}>
            <FileThumb base={activeUrl} file={item} />
            <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={2}>
                {item.path}
              </Text>
              <View style={styles.fileMeta}>
                <Text style={styles.metaText}>{formatSize(item.size)}</Text>
                <Text style={styles.metaText}>{formatDate(item.modified)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
      )}
      </View>
      {alertDialog}
      <PrintPreprocessDialog
        visible={Boolean(selectedFile)}
        onClose={closePrintModal}
        fileName={selectedFile?.path ?? 'print.gcode'}
        estTimeSeconds={Number(selectedMeta?.estimated_time ?? 0)}
        estGramsTotal={Number(selectedMeta?.filament_weight_total ?? 0)}
        thumbnail={selectedFile && selectedMeta ? metadataThumbnail(activeUrl, selectedFile.path, selectedMeta) : null}
        printers={printerOptions.map((printer) => ({
          id: printer.id,
          name: printer.name,
          status: printerStatuses[printer.id]?.label ?? 'Checking…',
          busy: printerStatuses[printer.id]?.busy ?? false,
          selectable: printerStatuses[printer.id]?.selectable ?? Boolean(printer.url),
        }))}
        activePrinterId={selectedPrinterId}
        onSelectPrinter={setSelectedPrinterId}
        slots={fileSlots}
        availableSlots={availableSlots}
        assignments={assignments}
        onAssignSlot={assignSlot}
        requiredColors={requiredColors}
        perToolGrams={[]}
        prefs={printPrefs}
        onTogglePref={(pref) => setPrintPrefs((prev) => ({ ...prev, [pref]: !prev[pref] }))}
        sending={sending || modalLoading}
        progress={sendProgress}
        errorMessage={modalError}
        onSend={reprint}
        sendLabel="Print Again"
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  segmentRow: {
    flexDirection: 'row',
    margin: spacing.lg,
    marginBottom: 0,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentText: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  fileCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 6,
    backgroundColor: colors.cardAlt,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  fileMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  metaText: {
    color: colors.subtext,
    fontSize: 11,
  },
  empty: {
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.xl * 2,
  },
});

function metadataThumbnail(base: string, path: string, meta: any): string | null {
  const thumbs: any[] = Array.isArray(meta?.thumbnails) ? meta.thumbnails : [];
  const best = thumbs.reduce((a, b) => (!a || (b?.width ?? 0) > (a.width ?? 0) ? b : a), null as any);
  return best?.relative_path ? thumbnailUrl(base, path, best.relative_path) : null;
}

function createInitialAssignments(meta: any, availableSlots: FilamentSlotDisplay[]): Record<number, number> {
  const usage = meta?.filament_used_mm ?? meta?.filament_weight;
  const required = Array.isArray(usage)
    ? usage.map((value: unknown, index: number) => Number(value) > 0 ? index : -1).filter((index: number) => index >= 0)
    : [];
  const choices = availableSlots.length ? availableSlots : [{ index: 0 } as FilamentSlotDisplay];
  return required.reduce<Record<number, number>>((result, fileTool, position) => {
    result[fileTool] = choices.find((slot) => slot.index === fileTool)?.index ?? choices[position % choices.length].index;
    return result;
  }, {});
}

function remapGcodeTools(source: string, assignments: Record<number, number>): string {
  return source.split(/(\r?\n)/).map((line) => {
    if (/^\s*;/.test(line)) return line;
    return line.replace(/\bT([0-3])\b/g, (match, rawTool: string) => {
      const tool = Number(rawTool);
      return `T${assignments[tool] ?? tool}`;
    });
  }).join('');
}

function findMaterialMismatch(
  meta: any,
  assignments: Record<number, number>,
  availableSlots: FilamentSlotDisplay[],
): { fileMaterial: string; loadedSlot: number; slotName: string } | null {
  const fileMaterials = typeof meta?.filament_type === 'string'
    ? meta.filament_type.split(';')
    : [];
  for (const [rawTool, rawSlot] of Object.entries(assignments)) {
    const fileMaterial = normalizeMaterial(fileMaterials[Number(rawTool)]);
    const loadedSlot = Number(rawSlot);
    const loaded = availableSlots.find((slot) => slot.index === loadedSlot);
    const loadedMaterial = normalizeMaterial(loaded?.material);
    if (fileMaterial && loadedMaterial && fileMaterial !== loadedMaterial) {
      return {
        fileMaterial,
        loadedSlot,
        slotName: [loaded?.brand || 'Generic', loadedMaterial].join(' '),
      };
    }
  }
  return null;
}

function normalizeMaterial(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function fileStem(path: string): string {
  const name = path.split('/').pop() || 'print';
  return name.replace(/\.gcode$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'print';
}

function resolveFileSlots(
  status: Record<string, any>,
  manualColors: string[],
  manualBrands: string[],
  manualMaterials: string[],
): FilamentSlotDisplay[] {
  const task = status.print_task_config && typeof status.print_task_config === 'object'
    ? status.print_task_config
    : {};
  const exists = Array.isArray(task.filament_exist) ? task.filament_exist : [];
  const printerColors = Array.isArray(task.filament_color_rgba) ? task.filament_color_rgba : [];
  const fallbackColors = normalizeFilamentSlotColors(manualColors);
  return Array.from({ length: 4 }, (_, index) => {
    const rawColor = typeof printerColors[index] === 'string' ? printerColors[index].replace(/^#/, '') : '';
    const color = /^[0-9a-f]{6,8}$/i.test(rawColor) ? `#${rawColor.slice(0, 6)}` : fallbackColors[index];
    const loaded = typeof exists[index] === 'boolean' ? exists[index] : undefined;
    const material = typeof task.filament_type?.[index] === 'string' && task.filament_type[index]
      ? task.filament_type[index]
      : manualMaterials[index] || 'PLA';
    const brand = typeof task.filament_vendor?.[index] === 'string' && task.filament_vendor[index]
      ? task.filament_vendor[index]
      : manualBrands[index] || 'Generic';
    return {
      index,
      color,
      brand,
      material,
      status: loaded === true ? 'loaded' : loaded === false ? 'empty' : 'unknown',
      source: rawColor || material ? 'printer' : 'manual',
    };
  });
}
