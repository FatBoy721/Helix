// Files — the Shelf list, History and Timelapse.
//
// The list, search and per-file metadata live in useFileLibrary; this screen
// owns the print flow that opens when a file is tapped (printer choice, slot
// assignment, tool remapping and the upload/start sequence).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMoonraker } from '../../hooks/useMoonraker';
import { api, printerConnectionUrl, thumbnailUrl } from '../../services/moonraker';
import ShelfFiles from '../../components/files/ShelfFiles';
import HistoryPanel from '../../components/files/HistoryPanel';
import TimelapsePanel from '../../components/files/TimelapsePanel';
import { COCKPIT as P, alpha } from '../../components/dashboard/shared';
import { useFileLibrary, type LibraryFile } from '../../hooks/useFileLibrary';
import { usePrintHistory } from '../../hooks/usePrintHistory';
import { t } from '../../services/i18n';
import { useThemedAlert } from '../../hooks/useThemedAlert';
import { useSettings } from '../../hooks/useSettings';
import PrintPreprocessDialog, { type PrintPref } from '../../components/PrintPreprocessDialog';
import type { FilamentSlotDisplay } from '../../components/FilamentSlotsEditor';
import { normalizeFilamentSlotColors } from '../../constants/filamentColors';
import * as FileSystem from 'expo-file-system/legacy';
import { fileUrl } from '../../services/moonraker';
import { injectTimelapseMacros, uploadGcodeToPrinter } from '../../services/nativeSlicer';
import { routeTools } from '../../services/printPreprocess';

type Mode = 'files' | 'history' | 'timelapse';

const MODES: { key: Mode; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'history', label: 'History' },
  { key: 'timelapse', label: 'Timelapse' },
];

export default function FilesScreen() {
  const { connection, activeUrl, status } = useMoonraker();
  const { settings } = useSettings();
  const connected = connection === 'connected';
  const [mode, setMode] = useState<Mode>('files');
  const library = useFileLibrary();
  const history = usePrintHistory(activeUrl, connected);
  const [selectedFile, setSelectedFile] = useState<LibraryFile | null>(null);
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

  const openPrintModal = useCallback(async (file: LibraryFile) => {
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
    setSendProgress(0.05);
    try {
      const materialMismatch = findMaterialMismatch(selectedMeta, assignments, availableSlots);
      if (materialMismatch) {
        throw new Error(
          `This file was sliced for ${materialMismatch.fileMaterial}, but ${materialMismatch.slotName} is loaded in T${materialMismatch.loadedSlot}. Re-slice the model with the loaded material before printing.`,
        );
      }

      // Route file tools onto loaded lanes (manual wins → identity-if-loaded → first-free-loaded lane).
      const required = fileSlots.length ? fileSlots.map((slot) => slot.index) : [0];
      const routing = routeTools(required, loadedSlots, assignments);
      const effectiveAssignments = Object.fromEntries(
        required.map((tool) => [tool, routing[tool]?.lane ?? tool]),
      );
      const usedExtruders = [...new Set(Object.values(effectiveAssignments) as number[])].sort((a, b) => a - b);

      // Busy check — refuse if the target printer is already printing/paused.
      const before = await api.queryObjects<{ print_stats?: { state?: string } }>(targetUrl, ['print_stats']);
      const currentState = before?.status?.print_stats?.state;
      if (currentState === 'printing' || currentState === 'paused') {
        throw new Error(`Printer is already ${currentState}.`);
      }

      // Decide whether we need a local copy: remapped lanes or injected timelapse macros.
      const needsRemap = targetUrl !== activeUrl
        || Object.entries(effectiveAssignments).some(([fileTool, lane]) => Number(fileTool) !== lane);
      let printPath = selectedFile.path;
      if (needsRemap || prefs.timelapse) {
        setSendProgress(0.15);
        const sourcePath = `${FileSystem.cacheDirectory ?? ''}helix-reprint-source-${Date.now()}.gcode`;
        await FileSystem.downloadAsync(fileUrl(activeUrl, 'gcodes', selectedFile.path), sourcePath);
        let workPath = sourcePath;
        if (needsRemap) {
          const source = await FileSystem.readAsStringAsync(sourcePath);
          const remapped = remapGcodeTools(source, effectiveAssignments);
          const outputPath = `${FileSystem.cacheDirectory ?? ''}helix-reprint-${Date.now()}.gcode`;
          await FileSystem.writeAsStringAsync(outputPath, remapped);
          workPath = outputPath;
        }
        if (prefs.timelapse) {
          setSendProgress(0.35);
          workPath = await injectTimelapseMacros(workPath);
        }
        const uploadName = `${fileStem(selectedFile.path)}_helix_reprint_${Date.now()}.gcode`;
        const uploaded = await uploadGcodeToPrinter(targetUrl, uploadName, workPath);
        printPath = uploaded?.path ?? uploadName;
      }

      // Apply preferences (always explicit — firmware caches prior job state).
      setSendProgress(0.7);
      await api.runGcode(
        targetUrl,
        `SET_MAIN_STATE MAIN_STATE=IDLE\nSET_PRINT_USED_EXTRUDERS EXTRUDERS=${usedExtruders.join(',')}\nSET_PRINT_PREFERENCES BED_LEVEL=${prefs.autoLevel ? 1 : 0} TIME_LAPSE_CAMERA=${prefs.timelapse ? 1 : 0} FLOW_CALIBRATE=${prefs.flowCal ? 1 : 0} FLOW_CALIBRATE_EXTRUDERS=0,1,2,3`,
      );

      // Verify the firmware accepted the preferences; abort if not.
      const applied = await api.queryObjects<{
        print_task_config?: {
          auto_bed_leveling?: boolean;
          time_lapse_camera?: boolean;
          flow_calibrate?: boolean;
          flow_calib_extruders?: boolean[];
          extruders_used?: boolean[];
        };
      }>(targetUrl, ['print_task_config']);
      const taskConfig = applied?.status?.print_task_config;
      if (
        taskConfig?.auto_bed_leveling !== prefs.autoLevel ||
        taskConfig?.time_lapse_camera !== prefs.timelapse ||
        taskConfig?.flow_calibrate !== prefs.flowCal ||
        taskConfig?.flow_calib_extruders?.length !== 4 ||
        !taskConfig?.flow_calib_extruders?.every(Boolean) ||
        taskConfig?.extruders_used?.length !== 4 ||
        !taskConfig?.extruders_used?.every((used, tool) => used === usedExtruders.includes(tool))
      ) {
        throw new Error('Printer rejected the selected print preferences.');
      }

      setSendProgress(0.92);
      await api.startPrint(targetUrl, printPath);
      setSendProgress(1);
      closePrintModal();
      showAlert({ title: t('Print started'), message: printPath, icon: 'check-circle' });
    } catch (e: any) {
      setModalError(String(e?.message ?? e));
    } finally {
      setSending(false);
    }
  }, [activeUrl, assignments, availableSlots, closePrintModal, fileSlots, loadedSlots, selectedFile, selectedMeta, selectedPrinter, showAlert]);

  // The library already fetched the largest thumbnail for the row, so the
  // dialog can show it immediately instead of waiting on the metadata call.
  const dialogThumbnail = selectedFile
    ? selectedFile.thumbUri
      ?? (selectedMeta ? metadataThumbnail(activeUrl, selectedFile.path, selectedMeta) : null)
    : null;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.segmentRow}>
          {MODES.map((m) => {
            const on = m.key === mode;
            return (
              <Pressable
                key={m.key}
                onPress={() => setMode(m.key)}
                style={[styles.segment, on && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{t(m.label)}</Text>
              </Pressable>
            );
          })}
        </View>

        {mode === 'files' ? (
          <ShelfFiles library={library} onOpen={openPrintModal} />
        ) : mode === 'history' ? (
          <HistoryPanel base={activeUrl} history={history} />
        ) : (
          <TimelapsePanel base={activeUrl} connected={connected} />
        )}
      </SafeAreaView>

      {alertDialog}
      <PrintPreprocessDialog
        visible={Boolean(selectedFile)}
        onClose={closePrintModal}
        fileName={selectedFile?.path ?? 'print.gcode'}
        estTimeSeconds={Number(selectedMeta?.estimated_time ?? 0)}
        estGramsTotal={Number(selectedMeta?.filament_weight_total ?? 0)}
        thumbnail={dialogThumbnail}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  flex: { flex: 1 },

  segmentRow: {
    flexDirection: 'row',
    gap: 4,
    margin: 16,
    marginBottom: 0,
    padding: 4,
    borderRadius: 999,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  segment: { flex: 1, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: alpha(P.accent, 0.18) },
  segmentText: { color: P.dim, fontSize: 13, fontWeight: '800' },
  segmentTextOn: { color: P.accent },
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
