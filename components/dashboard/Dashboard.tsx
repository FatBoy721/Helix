// Cockpit dashboard — the chosen redesign, reading live printer state.
//
// Section order is deliberate: camera (see the printer) → job (what is it
// doing) → toolheads (what is loaded) → temps (is it healthy) → panda breath
// (chamber/dryer) → macros (what do I run often) → printer screen (mirror) →
// e-stop (last, it's destructive).
//
// Camera and job are separate cards, not one overlaid hero: an unobstructed
// feed matters more than the vertical space a scrim would save.
//
// Every section maps to a settings.dashboard.* toggle and renders independently,
// so hiding any one of them leaves the rest intact.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import ThemedDialog from '../ThemedDialog';
import PrinterEditorModal from '../settings/PrinterEditorModal';
import { t } from '../../services/i18n';
import { takePrintSentNotice, type PrintSentNotice } from '../../services/printSentBus';
import { NotificationButton, NotificationPanel } from './parts/NotificationCenter';
import FilamentEditor from './parts/FilamentEditor';
import { useNotifications } from '../../hooks/useNotifications';
import { CameraCard, JobCard } from './parts/Hero';
import { EstopBar, MacroRow, PandaBreathRow, PrinterScreen, TempRow, ToolheadRail } from './parts/Modules';
import { useCockpitData, type CockpitData } from './parts/data';
import { alpha, COCKPIT as P, Dot } from './shared';
import PrinterIcon from '../PrinterIcon';
import { useSettings, type PrinterEntry } from '../../hooks/useSettings';
import { api, printerConnectionUrl } from '../../services/moonraker';

const PAGE = 16;
const PICKER_GAP = 8;

type PickerAnchor = { x: number; y: number; width: number; height: number };
type PrinterRuntime = { state: 'idle' | 'busy' | 'offline'; progress: number };
type PrinterStatusQuery = {
  print_stats?: { state?: string };
  virtual_sdcard?: { progress?: number };
  display_status?: { progress?: number };
};

function activePrinterRuntime(data: CockpitData): PrinterRuntime {
  if (!data.online) return { state: 'offline', progress: 0 };
  if (data.state === 'printing') {
    return { state: 'busy', progress: data.job?.progress ?? 0 };
  }
  return { state: 'idle', progress: 0 };
}

function runtimeLabel(runtime: PrinterRuntime): string {
  if (runtime.state === 'busy') {
    return `${t('Busy')} · ${Math.round(runtime.progress * 100)}%`;
  }
  return runtime.state === 'offline' ? t('Offline') : t('Idle');
}

export default function Cockpit() {
  const { width } = useWindowDimensions();
  const contentWidth = width - PAGE * 2;
  const data = useCockpitData();
  const { settings, update } = useSettings();

  // The slicer hands off a one-shot "print sent" notice for Home to surface.
  // Nothing else consumes it, so dropping this silently loses the confirmation.
  const [printSent, setPrintSent] = useState<PrintSentNotice | null>(null);
  useFocusEffect(
    useCallback(() => {
      const notice = takePrintSentNotice();
      if (notice) setPrintSent(notice);
    }, [])
  );

  // Which toolhead's filament is being edited, if any.
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor | null>(null);
  const [addingPrinter, setAddingPrinter] = useState<PrinterEntry | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [estopConfirm, setEstopConfirm] = useState(false);
  const notifications = useNotifications();
  // Released to the embedded printer panel while it's being touched.
  const [scrollEnabled, setScrollEnabled] = useState(true);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={scrollEnabled}>
        <TopBar
          data={data}
          unread={notifications.unread}
          onOpenPicker={setPickerAnchor}
          onOpenNotifications={() => {
            setNotificationsOpen(true);
            notifications.markAllSeen();
          }}
        />
        {/* Every section honors its Settings → Dashboard toggle. */}
        {settings.dashboard.camera ? <CameraCard data={data} width={contentWidth} /> : null}
        {settings.dashboard.progress ? <JobCard data={data} /> : null}
        {settings.dashboard.filaments ? (
          <ToolheadRail data={data} onEditSlot={setEditingSlot} />
        ) : null}
        {settings.dashboard.temps ? (
          <TempRow cardWidth={(contentWidth - 20) / 3} data={data} />
        ) : null}
        {settings.dashboard.pandaBreath ? <PandaBreathRow data={data} /> : null}
        {settings.dashboard.macros ? <MacroRow data={data} /> : null}
        {settings.dashboard.gui ? (
          <PrinterScreen
            data={data}
            width={contentWidth}
            onInteractStart={() => setScrollEnabled(false)}
            onInteractEnd={() => setScrollEnabled(true)}
          />
        ) : null}
        {settings.dashboard.estop ? <EstopBar onPress={() => setEstopConfirm(true)} /> : null}
      </ScrollView>

      {editingSlot != null ? (
        <FilamentEditor slot={editingSlot} onClose={() => setEditingSlot(null)} />
      ) : null}

      {pickerAnchor ? (
        <PrinterPicker
          data={data}
          anchor={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
          onAdd={() => {
            setPickerAnchor(null);
            setAddingPrinter({
              id: `p${Date.now()}`,
              name: '',
              url: '',
              tailscaleUrl: '',
              cameraUrl: '/webcam/webrtc',
              connectionMode: 'lan',
            });
          }}
        />
      ) : null}

      <PrinterEditorModal
        mode="add"
        printer={addingPrinter}
        onClose={() => setAddingPrinter(null)}
        onSave={async (printer) => {
          const printers = [...settings.printers, printer];
          await update({
            printers,
            activePrinterId: printer.id,
            primaryUrl: printer.url,
            tailscaleUrl: printer.tailscaleUrl,
            cameraUrl: printer.cameraUrl,
            connectionMode: printer.connectionMode,
          });
          return true;
        }}
      />

      {notificationsOpen ? (
        <NotificationPanel
          list={notifications.list}
          onClose={() => setNotificationsOpen(false)}
        />
      ) : null}

      {/* The one control that halts the machine outright, so it takes the
          whole screen rather than a sheet you can thumb through. */}
      {estopConfirm ? (
        <ThemedDialog
          visible
          title={t('Emergency stop?')}
          message={t('Halts the printer immediately and cancels any running print. The firmware needs a restart afterwards.')}
          icon="alert-octagon"
          onClose={() => setEstopConfirm(false)}
          actions={[
            {
              text: t('Stop the printer'),
              icon: 'alert-octagon',
              variant: 'danger',
              onPress: () => {
                setEstopConfirm(false);
                data.actions.emergencyStop();
              },
            },
            { text: t('Cancel'), onPress: () => setEstopConfirm(false) },
          ]}
        />
      ) : null}

      <ThemedDialog
        visible={!!printSent}
        placement="center"
        title={t('Print sent')}
        message={
          printSent
            ? `${printSent.filename.split('/').pop()} ${t('is now starting on the printer.')}`
            : undefined
        }
        icon="check-circle-outline"
        onClose={() => setPrintSent(null)}
        actions={[
          { text: t('OK'), icon: 'check', variant: 'primary', onPress: () => setPrintSent(null) },
        ]}
      />
    </View>
  );
}

function TopBar({
  data,
  unread,
  onOpenPicker,
  onOpenNotifications,
}: {
  data: CockpitData;
  unread: number;
  onOpenPicker: (anchor: PickerAnchor) => void;
  onOpenNotifications: () => void;
}) {
  const pickerRef = useRef<View>(null);
  const runtime = activePrinterRuntime(data);

  return (
    <View style={styles.topBar}>
      <Pressable
        ref={pickerRef}
        style={({ pressed }) => [styles.printerChip, pressed && { opacity: 0.75 }]}
        onPress={() => {
          pickerRef.current?.measureInWindow((x, y, width, height) => {
            onOpenPicker({ x, y, width, height });
          });
        }}
      >
        <View style={[styles.printerIcon, { backgroundColor: alpha(P.accent, 0.12) }]}>
          <PrinterIcon size={19} color={P.accent} />
        </View>
        <View style={styles.printerNames}>
          <Text style={styles.printerName} numberOfLines={1}>
            {data.printerName}
          </Text>
          <View style={styles.statusRow}>
            <Dot color={runtime.state === 'offline' ? P.danger : P.success} size={6} />
            <Text style={styles.statusText}>{runtimeLabel(runtime)}</Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={20} color={P.dim} />
      </Pressable>

      <NotificationButton unread={unread} onPress={onOpenNotifications} />
    </View>
  );
}

function PrinterPicker({
  data,
  anchor,
  onClose,
  onAdd,
}: {
  data: CockpitData;
  anchor: PickerAnchor;
  onClose: () => void;
  onAdd: () => void;
}) {
  const { settings, update } = useSettings();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const printers = settings.printers ?? [];
  const activeRuntime = activePrinterRuntime(data);
  const [runtimeByPrinter, setRuntimeByPrinter] = useState<Record<string, PrinterRuntime>>({});
  // Android's Modal window includes the translucent status bar while
  // measureInWindow reports coordinates below it.
  const anchorY = anchor.y + insets.top;
  const popoverAbove =
    anchorY + anchor.height + PICKER_GAP + Math.min(360, height * 0.5) >
    height - insets.bottom;

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const entries = await Promise.all(
        printers
          .filter((printer) => printer.id !== settings.activePrinterId)
          .map(async (printer): Promise<[string, PrinterRuntime]> => {
            const url = printerConnectionUrl(printer);
            if (!url) return [printer.id, { state: 'offline', progress: 0 }];
            try {
              const result = await api.queryObjects<PrinterStatusQuery>(url, [
                'print_stats',
                'virtual_sdcard',
                'display_status',
              ]);
              const rawState = result.status?.print_stats?.state?.toLowerCase();
              const rawProgress =
                result.status?.virtual_sdcard?.progress ??
                result.status?.display_status?.progress ??
                0;
              const progress = Math.max(0, Math.min(1, Number(rawProgress) || 0));
              return [
                printer.id,
                {
                  state: rawState === 'printing' || rawState === 'paused' ? 'busy' : 'idle',
                  progress,
                },
              ];
            } catch {
              return [printer.id, { state: 'offline', progress: 0 }];
            }
          })
      );
      if (mounted) setRuntimeByPrinter(Object.fromEntries(entries));
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [printers, settings.activePrinterId]);

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.pickerLayer}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          pointerEvents="none"
          style={[
            styles.pickerMirror,
            { left: anchor.x, top: anchorY, width: anchor.width, height: anchor.height, borderColor: P.accent },
          ]}
        >
          <View style={[styles.printerIcon, { backgroundColor: alpha(P.accent, 0.12) }]}>
            <PrinterIcon size={19} color={P.accent} />
          </View>
          <View style={styles.printerNames}>
            <Text style={styles.printerName} numberOfLines={1}>{data.printerName}</Text>
            <View style={styles.statusRow}>
              <Dot color={activeRuntime.state === 'offline' ? P.danger : P.success} size={6} />
              <Text style={styles.statusText}>{runtimeLabel(activeRuntime)}</Text>
            </View>
          </View>
          <MaterialCommunityIcons name="chevron-up" size={20} color={P.accent} />
        </View>
        <View
          style={[
            styles.pickerPopover,
            {
              left: anchor.x,
              width: anchor.width,
              maxHeight: Math.min(360, height * 0.5),
              ...(popoverAbove
                ? { bottom: height - anchorY + PICKER_GAP }
                : { top: anchorY + anchor.height + PICKER_GAP }),
            },
          ]}
        >
          <ScrollView nestedScrollEnabled>
            {printers.length === 0 ? (
              <Text style={styles.pickerEmpty}>{t('No printers configured yet.')}</Text>
            ) : (
              printers.map((printer) => {
                const active = printer.id === settings.activePrinterId;
                const runtime = active
                  ? activeRuntime
                  : runtimeByPrinter[printer.id] ?? { state: 'offline', progress: 0 };
                const runtimeColor =
                  runtime.state === 'busy'
                    ? P.accent
                    : runtime.state === 'offline'
                      ? P.danger
                      : P.success;
                return (
                  <Pressable
                    key={printer.id}
                    style={[styles.printerRow, active && { backgroundColor: alpha(P.accent, 0.1) }]}
                    onPress={() => {
                      if (!active) {
                        void update({
                          activePrinterId: printer.id,
                          primaryUrl: printer.url,
                          tailscaleUrl: printer.tailscaleUrl,
                          cameraUrl: printer.cameraUrl,
                          connectionMode: printer.connectionMode,
                        });
                      }
                      onClose();
                    }}
                  >
                    <Dot color={runtimeColor} size={8} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {printer.name?.trim() || t('Printer')}
                      </Text>
                    </View>
                    <Text style={[styles.rowStatus, { color: runtimeColor }]}>
                      {runtimeLabel(runtime)}
                    </Text>
                    {active ? (
                      <MaterialCommunityIcons name="check" size={18} color={P.accent} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <Pressable
            style={[styles.addRow, { borderColor: alpha(P.accent, 0.4), backgroundColor: alpha(P.accent, 0.08) }]}
            onPress={onAdd}
          >
            <MaterialCommunityIcons name="plus" size={20} color={P.accent} />
            <Text style={[styles.addText, { color: P.accent }]}>{t('Add printer')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: P.bg },
  content: { padding: PAGE, paddingBottom: 40, gap: P.gap },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  printerChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  printerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printerNames: { flex: 1 },
  printerName: { color: P.text, fontSize: 15, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusText: { color: P.dim, fontSize: 11, fontWeight: '700' },

  pickerLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: alpha('#000000', 0.35),
  },
  pickerMirror: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: P.surface,
    borderWidth: 1,
  },
  pickerPopover: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 16,
    padding: 8,
    gap: 6,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
  },
  pickerEmpty: { color: P.dim, fontSize: 13, fontWeight: '600', padding: 12 },

  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  rowText: { flex: 1 },
  rowName: { color: P.text, fontSize: 13, fontWeight: '800' },
  rowStatus: { fontSize: 11, fontWeight: '800' },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  addText: { fontSize: 13, fontWeight: '800' },

});
