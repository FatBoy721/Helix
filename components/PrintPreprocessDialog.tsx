// Print preprocess — Ticket sheet. The last screen before a print starts.
//
// Graduated from the preprocess lab. By the time this opens you already decided
// in the slicer (or tapped a file to reprint). The sheet answers four things at
// a glance, folds routing and options away, and makes the commit itself
// deliberate with a press-and-hold.
//
// Auto-routing (services/printPreprocess.ts) fills gaps so an empty lane next to
// loaded ones does not block a printable job. Blocking is reserved for genuinely
// unsatisfiable cases — fewer usable lanes than the file needs, printer busy, or
// offline.
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDuration } from './PrintProgress';
import type { FilamentSlotDisplay } from './FilamentSlotsEditor';
import { COCKPIT as P, alpha, ThumbMock, type IconName } from './dashboard/shared';
import { PrinterIcon } from './PrinterIcon';
import { Chevron, Collapsible } from './ui';
import {
  PREF_COPY,
  buildPreprocessChecks,
  buildPreprocessTools,
  finishClock,
  laneDetail,
  laneLabel,
  type PrintPref,
  type PreprocessLane,
  type PreprocessTool,
} from '../services/printPreprocess';

export type { PrintPref };

type PrinterOption = {
  id: string;
  name: string;
  status?: string;
  busy?: boolean;
  selectable?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  fileName: string;
  estTimeSeconds: number;
  estGramsTotal: number;
  thumbnail: string | null;
  printers: PrinterOption[];
  activePrinterId: string;
  onSelectPrinter: (id: string) => void;
  /** File tools the gcode asks for (subset of lanes). */
  slots: FilamentSlotDisplay[];
  /** Physical lanes available to remap onto. */
  availableSlots?: FilamentSlotDisplay[];
  /** Manual overrides only — auto-routing fills the rest. */
  assignments?: Record<number, number>;
  onAssignSlot?: (fileTool: number, loadedSlot: number) => void;
  requiredColors?: Record<number, string>;
  perToolGrams: number[];
  prefs: Record<PrintPref, boolean>;
  onTogglePref: (pref: PrintPref) => void;
  sending: boolean;
  progress: number;
  statusMessage?: string | null;
  errorMessage?: string | null;
  onSend: (prefs: Readonly<Record<PrintPref, boolean>>) => void;
  sendLabel?: string;
  /** Moonraker connected for the active printer. */
  connected?: boolean;
  /** Active bed_mesh profile name, or null. */
  meshProfile?: string | null;
  layers?: number;
};

const HOLD_MS = 700;

function asLane(slot: FilamentSlotDisplay): PreprocessLane {
  return {
    index: slot.index,
    color: slot.color,
    brand: slot.brand,
    material: slot.material,
    mainType: slot.mainType,
    subType: slot.subType,
    status: slot.status,
  };
}

export default function PrintPreprocessDialog({
  visible,
  onClose,
  fileName,
  estTimeSeconds,
  estGramsTotal,
  thumbnail,
  printers,
  activePrinterId,
  onSelectPrinter,
  slots,
  availableSlots = [],
  assignments = {},
  onAssignSlot,
  requiredColors,
  perToolGrams,
  prefs,
  onTogglePref,
  sending,
  progress,
  statusMessage,
  errorMessage,
  onSend,
  sendLabel = 'Hold to start',
  connected = true,
  meshProfile = null,
  layers = 0,
}: Props) {
  const insets = useSafeAreaInsets();
  const [openFold, setOpenFold] = useState<'routing' | 'options' | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [printerOpen, setPrinterOpen] = useState(false);
  const hold = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);

  const lanes = useMemo(() => {
    const pool = availableSlots.length > 0 ? availableSlots : slots;
    // Pad to four lanes so routeTools can address T0–T3 by index.
    const byIndex = new Map(pool.map((slot) => [slot.index, asLane(slot)]));
    return Array.from({ length: 4 }, (_, index) => {
      const existing = byIndex.get(index);
      if (existing) return existing;
      return {
        index,
        color: requiredColors?.[index] ?? '#888888',
        material: 'PLA',
        status: 'empty' as const,
      };
    });
  }, [availableSlots, slots, requiredColors]);

  const required = useMemo(
    () => slots.map((slot) => slot.index).sort((a, b) => a - b),
    [slots],
  );

  const tools = useMemo(
    () => buildPreprocessTools(required, lanes, assignments, perToolGrams),
    [required, lanes, assignments, perToolGrams],
  );

  const selectedPrinter = printers.find((printer) => printer.id === activePrinterId) ?? printers[0];
  const printerBusy = Boolean(selectedPrinter?.busy);

  const checks = useMemo(
    () =>
      buildPreprocessChecks({
        connected,
        printerBusy,
        printerName: selectedPrinter?.name ?? 'Printer',
        tools,
        lanes,
      }),
    [connected, printerBusy, selectedPrinter?.name, tools, lanes],
  );

  const failing = checks.filter((check) => check.tone === 'fail' && check.blocking);
  const blocked = failing.length > 0;
  const blockReason = failing[0]?.detail ?? null;
  const notes = checks.filter((check) => check.tone === 'warn' || check.tone === 'fail');
  const rerouted = tools.filter((tool) => tool.source === 'auto');
  const canRemap = Boolean(onAssignSlot) && lanes.length > 0;
  const routingOpen = openFold === 'routing' || blocked;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const displayGrams =
    estGramsTotal > 0
      ? estGramsTotal
      : tools.reduce((sum, tool) => sum + tool.grams, 0);

  const layerTwoOpen = picking != null || printerOpen;
  const closeTopLayer = () => {
    setPicking(null);
    setPrinterOpen(false);
  };
  const requestClose = () => {
    if (sending) return;
    if (layerTwoOpen) closeTopLayer();
    else onClose();
  };

  // Drag-down-to-dismiss for the sheet and its layer-2 picker. Latest close
  // fn is held in a ref so the (once-created) PanResponder never goes stale.
  const dismissMain = useRef(requestClose);
  dismissMain.current = requestClose;
  const dismissTop = useRef(closeTopLayer);
  dismissTop.current = closeTopLayer;
  const dismissOnDrag = (onDismiss: () => void) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 12 && g.dy > Math.abs(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 70 || g.vy > 0.6) onDismiss();
      },
    }).panHandlers;
  const mainPan = useRef(dismissOnDrag(() => dismissMain.current())).current;
  const topPan = useRef(dismissOnDrag(() => dismissTop.current())).current;

  const beginHold = () => {
    if (blocked || sending) return;
    setHolding(true);
    Animated.timing(hold, { toValue: 1, duration: HOLD_MS, useNativeDriver: false }).start(
      ({ finished }) => {
        setHolding(false);
        hold.setValue(0);
        if (finished) {
          try {
            Vibration.vibrate(18);
          } catch {
            // Vibration is best-effort — some devices refuse it.
          }
          onSend(prefs);
        }
      },
    );
  };

  const cancelHold = () => {
    hold.stopAnimation(() => {
      Animated.timing(hold, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    });
    setHolding(false);
  };

  const holdWidth = hold.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={requestClose}>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={requestClose} />

        <View
          style={[
            styles.sheet,
            { paddingBottom: 12 + insets.bottom },
            (layerTwoOpen || sending) && styles.sheetBack,
          ]}
          {...mainPan}
        >
          <View style={styles.grabber} />

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              {thumbnail ? (
                <Image source={{ uri: thumbnail }} style={styles.heroThumb} resizeMode="contain" />
              ) : (
                <ThumbMock palette={P} size={72} radius={16} />
              )}
              <View style={styles.heroText}>
                <Text style={styles.heroTitle} numberOfLines={2}>
                  {fileName.replace(/\.gcode$/i, '').split(/[\\/]/).pop() ?? fileName}
                </Text>
                <Pressable
                  onPress={() => setPrinterOpen(true)}
                  style={styles.heroPrinter}
                  disabled={printers.length === 0}
                >
                  <PrinterIcon size={13} />
                  <Text style={styles.heroPrinterText} numberOfLines={1}>
                    {selectedPrinter?.name ?? 'No printer'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={15} color={P.dim} />
                </Pressable>
              </View>
            </View>

            <View style={styles.statBand}>
              <Stat icon="clock-outline" value={formatDuration(estTimeSeconds)} label="Duration" />
              <View style={styles.statDivider} />
              <Stat
                icon="calendar-clock"
                value={finishClock(estTimeSeconds)}
                label="Done by"
                tone={P.accent}
              />
              <View style={styles.statDivider} />
              <Stat
                icon="weight-gram"
                value={`${displayGrams.toFixed(1)} g`}
                label={layers > 0 ? `${layers} layers` : 'Filament'}
              />
            </View>

            {notes.length > 0 ? (
              <View
                style={[
                  styles.notice,
                  {
                    borderColor: alpha(blocked ? P.danger : P.warn, 0.5),
                    backgroundColor: alpha(blocked ? P.danger : P.warn, 0.1),
                  },
                ]}
              >
                {notes.map((note) => (
                  <View key={note.key} style={styles.noticeRow}>
                    <MaterialCommunityIcons
                      name={toneIcon(note.tone)}
                      size={16}
                      color={toneColor(note.tone)}
                    />
                    <Text style={styles.noticeText}>{note.detail}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.clean}>
                <MaterialCommunityIcons name="check-circle" size={15} color={P.success} />
                <Text style={styles.cleanText}>
                  {rerouted.length > 0
                    ? `Routed around empty lanes — ${rerouted
                        .map((tool) => `T${tool.fileTool} on lane ${tool.assigned + 1}`)
                        .join(', ')}`
                    : 'Lanes loaded, printer idle'}
                </Text>
              </View>
            )}

            {errorMessage ? <Text style={styles.errText}>{errorMessage}</Text> : null}

            <Pressable
              style={styles.foldHead}
              onPress={() => setOpenFold(routingOpen && !blocked ? null : 'routing')}
              disabled={blocked}
            >
              <View style={styles.foldLanes}>
                {tools.map((tool) => (
                  <LaneChip key={tool.fileTool} tool={tool} size={26} />
                ))}
              </View>
              <Text style={styles.foldLabel}>
                {tools.length} {tools.length === 1 ? 'lane' : 'lanes'}
              </Text>
              <WeightBar tools={tools} />
              <Chevron open={routingOpen} color={P.dim} />
            </Pressable>

            <Collapsible open={routingOpen}>
              <View style={styles.foldBody}>
                {tools.map((tool) => (
                  <Pressable
                    key={tool.fileTool}
                    onPress={() => canRemap && setPicking(tool.fileTool)}
                    disabled={!canRemap}
                    style={styles.laneRow}
                  >
                    <LaneChip tool={tool} size={34} />
                    <View style={styles.laneText}>
                      <Text style={styles.laneTitle}>
                        {laneLabel(tool.lane)}
                        {tool.source !== 'identity' ? (
                          <Text style={styles.remapNote}>
                            {'  '}
                            {tool.source === 'manual' ? '→' : 'auto →'} lane {tool.assigned + 1}
                          </Text>
                        ) : null}
                      </Text>
                      <Text style={styles.laneSub}>
                        lane {tool.assigned + 1} · {laneDetail(tool.lane)}
                      </Text>
                    </View>
                    {tool.grams > 0 ? (
                      <Text style={styles.laneGram}>{tool.grams.toFixed(1)} g</Text>
                    ) : null}
                    {canRemap ? (
                      <MaterialCommunityIcons name="chevron-right" size={17} color={P.dim} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </Collapsible>

            <Pressable
              style={styles.foldHead}
              onPress={() => setOpenFold(openFold === 'options' ? null : 'options')}
            >
              <MaterialCommunityIcons name="tune-variant" size={17} color={P.dim} />
              <Text style={[styles.foldLabel, styles.foldGrow]}>
                {PREF_COPY.filter(({ key }) => prefs[key])
                  .map(({ label }) => label)
                  .join(', ') || 'Print preferences'}
              </Text>
              <Chevron open={openFold === 'options'} color={P.dim} />
            </Pressable>

            <Collapsible open={openFold === 'options'}>
              <View style={styles.foldBody}>
                {PREF_COPY.map(({ key, label, hint, icon }) => {
                  const on = prefs[key];
                  return (
                    <Pressable key={key} onPress={() => onTogglePref(key)} style={styles.prefRow}>
                      <MaterialCommunityIcons name={icon} size={18} color={on ? P.accent : P.dim} />
                      <View style={styles.laneText}>
                        <Text style={styles.laneTitle}>{label}</Text>
                        <Text style={styles.laneSub}>{hint}</Text>
                      </View>
                      <View
                        style={[
                          styles.track,
                          on && { backgroundColor: P.accent, borderColor: P.accent },
                        ]}
                      >
                        <View style={[styles.knob, on && styles.knobOn]} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </Collapsible>
          </ScrollView>

          {blocked ? (
            <Pressable
              style={styles.fixBar}
              onPress={() => {
                const starved = tools.find((tool) => tool.lane.status === 'empty');
                if (starved && canRemap) setPicking(starved.fileTool);
                else setPrinterOpen(true);
              }}
            >
              <MaterialCommunityIcons name="wrench-outline" size={18} color={P.danger} />
              <Text style={styles.fixBarText} numberOfLines={1}>
                {blockReason ?? 'Fix to continue'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPressIn={beginHold}
              onPressOut={cancelHold}
              disabled={sending}
              style={[styles.holdBtn, sending && styles.holdOff]}
            >
              <Animated.View style={[styles.holdFill, { width: holdWidth }]} />
              <MaterialCommunityIcons name="printer-3d-nozzle" size={19} color={P.onAccent} />
              <Text style={styles.holdText}>
                {holding ? 'Keep holding…' : sendLabel}
              </Text>
            </Pressable>
          )}
        </View>

        {layerTwoOpen ? (
          <>
            <Pressable
              style={[StyleSheet.absoluteFill, styles.scrim]}
              onPress={closeTopLayer}
            />
            <View
              style={[styles.pickerSheet, { paddingBottom: 14 + insets.bottom }]}
              {...topPan}
            >
            <View style={styles.grabber} />
            <View style={styles.pickerHeader}>
              <Pressable style={styles.backButton} onPress={closeTopLayer}>
                <MaterialCommunityIcons name="chevron-left" size={18} color={P.text} />
                <Text style={styles.backText}>Back</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.pickerContent}>
              {picking != null ? (
                <>
                  <Text style={styles.pickerTitle}>Lane for T{picking}</Text>
                  <Text style={styles.pickerHint}>
                    Choose the physical spool that feeds this tool.
                  </Text>
                  {lanes.map((lane) => {
                    const active =
                      (tools.find((tool) => tool.fileTool === picking)?.assigned ?? picking) ===
                      lane.index;
                    const empty = lane.status === 'empty';
                    return (
                      <Pressable
                        key={lane.index}
                        style={[styles.pickerRow, active && { backgroundColor: alpha(P.accent, 0.14) }]}
                        onPress={() => {
                          onAssignSlot?.(picking, lane.index);
                          closeTopLayer();
                        }}
                      >
                        <View
                          style={[
                            styles.pickerBadge,
                            { borderColor: empty ? alpha(P.danger, 0.6) : lane.color },
                          ]}
                        >
                          <Text style={styles.pickerBadgeText}>{lane.index + 1}</Text>
                        </View>
                        <View style={styles.laneText}>
                          <Text style={styles.laneTitle}>{laneLabel(lane)}</Text>
                          <Text style={styles.laneSub}>{laneDetail(lane)}</Text>
                        </View>
                        {active ? (
                          <MaterialCommunityIcons name="check" size={18} color={P.accent} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </>
              ) : (
                <>
                  <Text style={styles.pickerTitle}>Select Printer</Text>
                  {printers.map((printer) => {
                    const active = printer.id === activePrinterId;
                    return (
                      <Pressable
                        key={printer.id}
                        style={[styles.pickerRow, active && { backgroundColor: alpha(P.accent, 0.14) }]}
                        disabled={printer.busy || printer.selectable === false}
                        onPress={() => {
                          onSelectPrinter(printer.id);
                          closeTopLayer();
                        }}
                      >
                        <View style={[styles.printerIcon, { backgroundColor: alpha(P.accent, 0.14) }]}>
                          <PrinterIcon size={18} />
                        </View>
                        <View style={styles.laneText}>
                          <Text style={styles.laneTitle}>{printer.name}</Text>
                          <Text style={[styles.laneSub, printer.busy && { color: P.warn }]}>
                            {printer.status ?? 'Checking…'}
                          </Text>
                        </View>
                        {active ? (
                          <MaterialCommunityIcons name="check" size={18} color={P.accent} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </>
              )}
            </ScrollView>
          </View>
          </>
        ) : null}

        {sending ? (
          <View style={styles.blockingLayer}>
            <View style={styles.blockingCard}>
              <View style={[styles.blockingIcon, { backgroundColor: alpha(P.accent, 0.14) }]}>
                <ActivityIndicator color={P.accent} size="large" />
              </View>
              <Text style={styles.blockingTitle}>Starting print</Text>
              <Text style={styles.statusText} numberOfLines={2}>
                {statusMessage || 'Preparing your print…'}
              </Text>
              <View style={styles.progressRow}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.progressPct}>{pct}%</Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function toneColor(tone: string): string {
  if (tone === 'pass') return P.success;
  if (tone === 'warn') return P.warn;
  if (tone === 'fail') return P.danger;
  return P.dim;
}

function toneIcon(tone: string): IconName {
  if (tone === 'pass') return 'check-circle';
  if (tone === 'warn') return 'alert-circle-outline';
  if (tone === 'fail') return 'close-circle';
  return 'help-circle-outline';
}

function Stat({
  icon,
  value,
  label,
  tone,
}: {
  icon: IconName;
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <View style={styles.stat}>
      <MaterialCommunityIcons name={icon} size={15} color={tone ?? P.dim} />
      <Text style={[styles.statValue, tone ? { color: tone } : null]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function WeightBar({ tools }: { tools: PreprocessTool[] }) {
  const total = tools.reduce((sum, tool) => sum + Math.max(tool.grams, 0.01), 0) || 1;
  return (
    <View style={styles.weightBar}>
      {tools.map((tool) => (
        <View
          key={tool.fileTool}
          style={{
            flex: Math.max(tool.grams, 0.01) / total,
            backgroundColor: tool.lane.status === 'empty' ? alpha(P.danger, 0.5) : tool.lane.color,
          }}
        />
      ))}
    </View>
  );
}

function LaneChip({ tool, size = 38 }: { tool: PreprocessTool; size?: number }) {
  const empty = tool.lane.status === 'empty';
  const ring = empty
    ? alpha(P.danger, 0.8)
    : tool.source === 'manual'
      ? P.accent
      : tool.lane.color;
  return (
    <View
      style={[
        styles.laneChip,
        { width: size, height: size, borderRadius: size / 2, borderColor: ring },
      ]}
    >
      <Text style={[styles.laneChipText, { fontSize: size * 0.34 }]}>T{tool.fileTool}</Text>
      {empty ? (
        <View style={styles.laneChipWarn}>
          <MaterialCommunityIcons name="alert" size={9} color={P.bg} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    backgroundColor: P.bg,
    borderTopLeftRadius: P.radius + 10,
    borderTopRightRadius: P.radius + 10,
    borderWidth: 1,
    borderColor: P.border,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  sheetBack: { transform: [{ scale: 0.94 }, { translateY: -14 }], opacity: 0.5 },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    backgroundColor: P.border,
  },
  body: { paddingTop: 16, paddingBottom: 14, gap: 11 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroThumb: { width: 72, height: 72, borderRadius: 16 },
  heroText: { flex: 1, minWidth: 0, gap: 7 },
  heroTitle: {
    color: P.text,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.55,
    lineHeight: 25,
  },
  heroPrinter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
  },
  heroPrinterText: { color: P.text, fontSize: 12, fontWeight: '700', maxWidth: 150 },

  statBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: P.radius - 4,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    padding: 14,
  },
  statDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: P.border },
  stat: { flex: 1, gap: 3 },
  statValue: { color: P.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.4 },
  statLabel: {
    color: P.dim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  notice: { borderWidth: 1, borderRadius: P.radius - 6, padding: 12, gap: 8 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  noticeText: { flex: 1, color: P.text, fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  clean: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  cleanText: { flex: 1, color: P.dim, fontSize: 12, fontWeight: '600' },
  errText: { color: P.danger, fontSize: 12, fontWeight: '700' },

  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 13,
    borderRadius: P.radius - 6,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
  },
  foldLanes: { flexDirection: 'row', gap: 4 },
  foldLabel: { color: P.text, fontSize: 12.5, fontWeight: '700' },
  foldGrow: { flex: 1 },
  foldBody: { paddingTop: 4, gap: 4 },
  weightBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: P.surfaceAlt,
  },

  laneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  laneText: { flex: 1, minWidth: 0, gap: 2 },
  laneTitle: { color: P.text, fontSize: 14, fontWeight: '700' },
  laneSub: { color: P.dim, fontSize: 11.5, fontWeight: '600' },
  laneGram: { color: P.dim, fontSize: 12, fontWeight: '800' },
  remapNote: { color: P.accent, fontSize: 12, fontWeight: '800' },

  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  track: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: P.surfaceAlt,
    borderWidth: 1,
    borderColor: P.border,
    padding: 2,
    justifyContent: 'center',
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: P.dim,
    alignSelf: 'flex-start',
  },
  knobOn: { alignSelf: 'flex-end', backgroundColor: P.onAccent },

  holdBtn: {
    height: 56,
    borderRadius: 999,
    backgroundColor: P.accentFill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    overflow: 'hidden',
  },
  holdOff: { opacity: 0.5 },
  holdFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  holdText: { color: P.onAccent, fontSize: 15, fontWeight: '800' },

  fixBar: {
    height: 56,
    borderRadius: 999,
    backgroundColor: alpha(P.danger, 0.16),
    borderWidth: 1,
    borderColor: alpha(P.danger, 0.5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 16,
  },
  fixBarText: { flexShrink: 1, color: P.danger, fontSize: 14, fontWeight: '800' },

  laneChip: {
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.bg,
  },
  laneChipText: { color: P.text, fontWeight: '900' },
  laneChipWarn: {
    position: 'absolute',
    right: -3,
    top: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: P.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pickerSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '74%',
    backgroundColor: P.bg,
    borderTopLeftRadius: P.radius + 8,
    borderTopRightRadius: P.radius + 8,
    borderWidth: 1,
    borderColor: P.border,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: P.gap,
    paddingTop: 10,
  },
  backButton: { flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 2 },
  backText: { color: P.text, fontSize: 13, fontWeight: '700' },
  pickerContent: { paddingHorizontal: P.gap, paddingBottom: P.gap, paddingTop: 4 },
  pickerTitle: { color: P.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  pickerHint: { color: P.dim, fontSize: 12, marginTop: 4, marginBottom: 12 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderRadius: P.radius - 4,
    paddingHorizontal: 10,
    marginVertical: 3,
  },
  pickerBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.bg,
  },
  pickerBadgeText: { color: P.text, fontSize: 12, fontWeight: '900' },
  printerIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  blockingLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.76)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
  },
  blockingCard: {
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
  blockingIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockingTitle: { color: P.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  statusText: { color: P.text, fontSize: 13, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: P.surfaceAlt,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: P.accent },
  progressPct: { color: P.dim, fontSize: 12, fontWeight: '800', minWidth: 34, textAlign: 'right' },
});
