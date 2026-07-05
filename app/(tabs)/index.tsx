import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import type { PrinterEntry } from '../../hooks/useSettings';
import {
  api,
  normalizeMoonrakerUrl,
  printerConnectionUrl,
  resolveCameraUrl,
  resolveSnapshotUrl,
  thumbnailUrl,
} from '../../services/moonraker';
import {
  findMachineChamberTemperatureSource,
  findPandaBreathTemperatureSource,
} from '../../services/chamberTemperature';
import { formatDuration } from '../../components/PrintProgress';
import CameraFeed, { CameraStat } from '../../components/CameraFeed';
import ControlsPanel from '../../components/ControlsPanel';
import MacrosPanel from '../../components/MacrosPanel';
import {
  ArcGauge,
  Card,
  Chevron,
  FadeInUp,
  GlowBackdrop,
  LiveDot,
  PopIn,
  PressableScale,
  ProgressBar,
} from '../../components/ui';
import { t } from '../../services/i18n';
import { displayTemperature } from '../../services/temperature';
import type { TemperatureUnit } from '../../services/temperature';
import { colors, radius, shadow, spacing, withAlpha } from '../../constants/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface PickerPrinterStatus {
  connected: boolean;
  state: string;
  progress: number;
}

type PrinterStatusQuery = {
  print_stats?: { state?: string };
  display_status?: { progress?: number };
};

interface PickerAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MetadataThumbnail {
  width?: number;
  relative_path?: string;
}

function stateColor(state: string): string {
  switch (state) {
    case 'printing': return colors.primary;
    case 'paused': return colors.warning;
    case 'error': return colors.danger;
    case 'cancelled':
    case 'canceled': return colors.warning;
    case 'complete':
    case 'ready': return colors.success;
    default: return colors.subtext;
  }
}

function statusText(state: string): string {
  switch (state) {
    case 'printing': return t('Printing');
    case 'paused': return t('Paused');
    case 'complete': return t('Success');
    case 'error': return t('Failed');
    case 'cancelled':
    case 'canceled': return t('Cancelled');
    case 'ready': return t('Ready');
    default: return t('Idle');
  }
}

function connectionModeIcon(mode: string): IconName {
  if (mode === 'lan') return 'wifi';
  if (mode === 'tailscale') return 'vpn';
  return 'swap-horizontal';
}

function connectionModeLabel(mode: string): string {
  if (mode === 'lan') return 'LAN';
  if (mode === 'tailscale') return 'Tailscale';
  return 'Auto';
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '') || t('No URL set');
}

function fileLabel(filename: string): string {
  return filename.split('/').pop() || t('No file');
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function printerPollUrl(printer: PrinterEntry): string {
  return printerConnectionUrl(printer);
}

function printerBusy(state: string): boolean {
  return state === 'printing' || state === 'paused';
}

function pickerStatusLabel(status: PickerPrinterStatus): string {
  if (!status.connected) return t('Offline');
  if (printerBusy(status.state)) return t('Busy');
  return t('Idle');
}

function pickerStatusColor(status: PickerPrinterStatus): string {
  if (!status.connected) return colors.danger;
  if (status.state === 'paused') return colors.warning;
  if (printerBusy(status.state)) return colors.primary;
  return colors.success;
}

export default function Dashboard() {
  const {
    status,
    connection,
    klippyState,
    activeUrl,
    rpc,
    reconnect,
    sendGcode,
    gcodeHelp,
    webcams,
  } = useMoonraker();
  const { settings, update } = useSettings();
  const router = useRouter();
  const window = useWindowDimensions();
  const show = settings.dashboard;
  const unit = settings.temperatureUnit;
  const pickerTriggerRef = useRef<View>(null);

  // I hate this mf I kept wondering why it kept popping up.
  // crabcore
  const [dismissedJob, setDismissedJob] = useState('');
  const [observedLiveFilename, setObservedLiveFilename] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor | null>(null);
  const [pickerStatuses, setPickerStatuses] = useState<Record<string, PickerPrinterStatus>>({});
  const [thumb, setThumb] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState('');
  const [ledOverride, setLedOverride] = useState<{ key: string; on: boolean } | null>(null);

  const ledKey = useMemo(
    () => Object.keys(status).find((k) => /^(led|neopixel|dotstar) /.test(k)),
    [status]
  );
  const ledColors: number[][] = status[ledKey ?? '']?.color_data ?? [];
  const reportedLedOn = ledColors.some((c) => Array.isArray(c) && c.some((v) => v > 0));
  const activeLedOverride = ledOverride && ledOverride.key === ledKey ? ledOverride : null;
  const ledOn = activeLedOverride ? activeLedOverride.on : reportedLedOn;
  useEffect(() => {
    const pendingLed = ledOverride;
    if (!pendingLed || pendingLed.key !== ledKey || !ledColors.length) return;
    if (reportedLedOn === pendingLed.on) setLedOverride(null);
  }, [ledColors.length, ledKey, ledOverride, reportedLedOn]);
  const toggleLed = () => {
    if (!ledKey) return;
    const name = ledKey.replace(/^(led|neopixel|dotstar)\s+/, '');
    const hasWhite = (ledColors[0]?.length ?? 0) >= 4;
    const v = ledOn ? 0 : 1;
    setLedOverride({ key: ledKey, on: !ledOn });
    sendGcode(
      hasWhite
        ? `SET_LED LED=${name} RED=0 GREEN=0 BLUE=0 WHITE=${v} SYNC=0`
        : `SET_LED LED=${name} RED=${v} GREEN=${v} BLUE=${v} SYNC=0`
    );
  };

  const ps = status.print_stats ?? {};
  const vsd = status.virtual_sdcard ?? {};
  const state: string = ps.state ?? 'unknown';
  const printing = state === 'printing';
  const paused = state === 'paused';
  const connected = connection === 'connected' && klippyState === 'ready';
  const activeJob = printing || paused;
  const connecting = connection === 'connecting';

  const showErr = (e: unknown) => Alert.alert('Error', e instanceof Error ? e.message : String(e));
  const doPause = () => rpc('printer.print.pause').catch(showErr);
  const doResume = () => rpc('printer.print.resume').catch(showErr);
  const doCancel = () =>
    Alert.alert(t('Cancel print?'), t('This stops the current print.'), [
      { text: t('No'), style: 'cancel' },
      { text: t('Yes, cancel'), style: 'destructive', onPress: () => rpc('printer.print.cancel').catch(showErr) },
    ]);
  const doEstop = () => {
    rpc('printer.emergency_stop').catch(() => {});
    const primary = normalizeMoonrakerUrl(settings.primaryUrl);
    const tailscale = normalizeMoonrakerUrl(settings.tailscaleUrl);
    if (primary) api.emergencyStop(primary).catch(() => {});
    if (tailscale && tailscale !== primary) api.emergencyStop(tailscale).catch(() => {});
  };

  const extruderNames = ['extruder', 'extruder1', 'extruder2', 'extruder3'];
  const chamberTempSource = useMemo(() => findMachineChamberTemperatureSource(status), [status]);
  const pandaBreathTempSource = useMemo(
    () => show.pandaBreath ? findPandaBreathTemperatureSource(status) : null,
    [show.pandaBreath, status]
  );

  const filename: string = ps.filename ?? '';
  const [slicerEstimate, setSlicerEstimate] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setSlicerEstimate(null);
    setThumb(null);
    setSubtitle('');
    if (!filename || !activeUrl) return;
    api
      .metadata(activeUrl, filename)
      .then((m: { estimated_time?: number; thumbnails?: MetadataThumbnail[]; filament_name?: string | string[] }) => {
        if (!live) return;
        setSlicerEstimate(typeof m?.estimated_time === 'number' ? m.estimated_time : null);
        const thumbs = Array.isArray(m?.thumbnails) ? m.thumbnails : [];
        const best = thumbs.reduce<MetadataThumbnail | null>(
          (winner, current) => (!winner || (current.width ?? 0) > (winner.width ?? 0) ? current : winner),
          null
        );
        setThumb(best?.relative_path ? thumbnailUrl(activeUrl, filename, best.relative_path) : null);
        const fil = Array.isArray(m?.filament_name) ? m.filament_name[0] : m?.filament_name;
        setSubtitle(typeof fil === 'string' ? fil.split(/[;,]/)[0].trim() : '');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [filename, activeUrl]);

  const progress = clampProgress(vsd.progress ?? status.display_status?.progress ?? 0);
  const duration = ps.print_duration ?? 0;
  const progressEta = progress > 0.001 && duration > 0 ? duration / progress - duration : NaN;
  const remaining = Number.isFinite(progressEta) ? formatDuration(progressEta) : '--';
  const layer =
    ps.info?.current_layer != null && ps.info?.total_layer != null && ps.info.total_layer > 0
      ? `${ps.info.current_layer} / ${ps.info.total_layer}`
      : '';

  const cameraStats = useMemo<CameraStat[]>(() => {
    if (!activeJob) return [];
    const out: CameraStat[] = [];
    if (slicerEstimate != null) {
      out.push({ label: t('Slicer remaining'), value: formatDuration(Math.max(0, slicerEstimate - duration)) });
    }
    if (progress > 0.001 && duration > 0) {
      const eta = duration / progress - duration;
      out.push({ label: t('Est. remaining'), value: formatDuration(eta) });
    }
    if (typeof ps.info?.current_layer === 'number' && ps.info.current_layer > 0 && duration > 0) {
      out.push({ label: t('Per layer'), value: formatDuration(duration / ps.info.current_layer) });
    }
    return out;
  }, [activeJob, duration, ps.info?.current_layer, progress, slicerEstimate]);

  const homedAxes: string = status.toolhead?.homed_axes ?? '';
  const homed = homedAxes.includes('x') && homedAxes.includes('y') && homedAxes.includes('z');
  const canMove = connected && !activeJob;
  const doHome = () => sendGcode('G28');
  const doDock = () => sendGcode(homed ? 'PARK_EXTRUDER' : 'G28\nPARK_EXTRUDER');

  const finished = ['complete', 'cancelled', 'error'].includes(state);
  const jobKey = `${ps.filename ?? ''}|${state}`;
  const observedFinished = finished && !!filename && observedLiveFilename === filename;
  const displayState = finished && !observedFinished && connected ? 'ready' : state;

  useEffect(() => {
    if (!activeJob || !filename) return;
    setObservedLiveFilename(filename);
    setDismissedJob('');
  }, [activeJob, filename]);

  const reprint = async () => {
    if (!filename) return;
    try {
      await api.startPrint(activeUrl, filename);
    } catch (e: unknown) {
      showErr(e);
    }
  };

  const switchPrinter = (p: (typeof settings.printers)[number]) => {
    setPickerOpen(false);
    update({
      activePrinterId: p.id,
      primaryUrl: p.url,
      tailscaleUrl: p.tailscaleUrl,
      cameraUrl: p.cameraUrl,
      connectionMode: p.connectionMode,
    });
  };

  const openPrinterPicker = () => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    if (!pickerTriggerRef.current) {
      setPickerAnchor(null);
      setPickerOpen(true);
      return;
    }
    pickerTriggerRef.current.measureInWindow((x, y, width, height) => {
      setPickerAnchor({ x, y, width, height });
      setPickerOpen(true);
    });
  };

  useEffect(() => {
    if (!pickerOpen) return;
    let live = true;
    const pollPrinters = async () => {
      const next: Record<string, PickerPrinterStatus> = {};
      for (const p of settings.printers) {
        if (p.id === settings.activePrinterId) continue;
        const url = printerPollUrl(p);
        if (!url) {
          next[p.id] = { connected: false, state: 'offline', progress: 0 };
          continue;
        }
        try {
          const res = await api.queryObjects<PrinterStatusQuery>(normalizeMoonrakerUrl(url), [
            'print_stats',
            'display_status',
          ]);
          next[p.id] = {
            connected: true,
            state: res?.status?.print_stats?.state ?? 'unknown',
            progress: clampProgress(res?.status?.display_status?.progress ?? 0),
          };
        } catch {
          next[p.id] = { connected: false, state: 'offline', progress: 0 };
        }
      }
      if (live) setPickerStatuses(next);
    };
    pollPrinters();
    const timer = setInterval(pollPrinters, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pickerOpen, settings.printers, settings.activePrinterId]);

  const activePrinter = settings.printers.find((p) => p.id === settings.activePrinterId);
  const selectedPrinterUrl = activePrinter ? printerConnectionUrl(activePrinter) : '';
  const activeBaseUrl = activeUrl || selectedPrinterUrl;
  const mainCameraUrl = resolveCameraUrl(settings.cameraUrl, activeBaseUrl);
  const mainWebcam = webcams.find((w) => resolveCameraUrl(w.stream_url, activeBaseUrl) === mainCameraUrl);
  const mainSnapshotUrl = resolveSnapshotUrl(mainWebcam?.snapshot_url, settings.cameraUrl, activeBaseUrl);
  const hasCamera = show.camera && !!mainCameraUrl;

  const printerName = activePrinter?.name?.trim() || t('Printer');
  const connectionHost = shortUrl(activeUrl || selectedPrinterUrl);

  const bed = status.heater_bed ?? {};
  const chamber = chamberTempSource?.data ?? null;
  const pandaBreathTemp = pandaBreathTempSource?.data ?? null;

  // all heaters for the device slide (bed, cavity, Panda Breath, every toolhead)
  const temps: { key: string; label: string; temperature?: number; target?: number }[] = [
    { key: 'bed', label: t('Bed'), temperature: bed.temperature, target: bed.target },
    ...(chamber
      ? [{
          key: 'chamber',
          label: t(chamberTempSource?.label ?? 'Chamber'),
          temperature: chamber.temperature,
          target: chamber.target,
        }]
      : []),
    ...(pandaBreathTemp
      ? [{
          key: 'panda_breath',
          label: t(pandaBreathTempSource?.label ?? 'Panda Breath'),
          temperature: pandaBreathTemp.temperature,
          target: pandaBreathTemp.target,
        }]
      : []),
    ...extruderNames
      .filter((n) => n === 'extruder' || status[n])
      .map((n, i) => ({ key: n, label: `T${i}`, temperature: status[n]?.temperature, target: status[n]?.target })),
  ];

  const jobTitle = filename
    ? fileLabel(filename)
    : connected
      ? t('Ready to print')
      : t('Waiting for printer');
  const showJobCard =
    show.progress && (activeJob || (observedFinished && dismissedJob !== jobKey));
  const pct = `${Math.round(progress * 100)}%`;


  const showCameraValues = show.temps || show.homeDock;
  const pickerMargin = spacing.lg;
  const pickerWidth = Math.min(
    window.width - pickerMargin * 2,
    Math.max(320, pickerAnchor?.width ?? 0)
  );
  const pickerLeft = pickerAnchor
    ? clampNumber(
        pickerAnchor.x + pickerAnchor.width / 2 - pickerWidth / 2,
        pickerMargin,
        window.width - pickerWidth - pickerMargin
      )
    : Math.max(pickerMargin, (window.width - pickerWidth) / 2);
  const pickerTop = pickerAnchor
    ? pickerAnchor.y + pickerAnchor.height + spacing.xs
    : 76;
  const pickerMaxHeight = Math.max(
    180,
    Math.min(430, window.height - pickerTop - spacing.md)
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.headerStack}>
          {/* header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View ref={pickerTriggerRef} collapsable={false} style={styles.nameAnchor}>
                <PressableScale
                  style={[styles.nameRow, pickerOpen && styles.nameRowOpen]}
                  onPress={openPrinterPicker}
                  activeScale={0.98}
                >
                  <Text style={styles.printerName} numberOfLines={1}>
                    {printerName}
                  </Text>
                  <Chevron open={pickerOpen} color={colors.text} />
                </PressableScale>
              </View>
              <View style={styles.onlineRow}>
                {printing ? (
                  <LiveDot color={colors.primary} size={7} />
                ) : (
                  <View
                    style={[
                      styles.onlineDot,
                      { backgroundColor: connection === 'connected' ? colors.success : connecting ? colors.warning : colors.danger },
                    ]}
                  />
                )}
                <Text style={styles.onlineText}>
                  {connection === 'connected' ? t('Online') : connecting ? `${connectionHost}...` : t('Offline')}
                </Text>
              </View>
            </View>
            <PressableScale style={styles.iconButton} onPress={reconnect}>
              <MaterialCommunityIcons name="refresh" size={20} color={colors.text} />
            </PressableScale>
          </View>
        </View>

        {connection === 'connected' && klippyState !== 'ready' && (
          <View style={styles.warnBanner}>
            <MaterialCommunityIcons name="alert-circle-outline" size={19} color={colors.warning} />
            <Text style={styles.warnText}>Klipper: {klippyState}</Text>
          </View>
        )}

        {hasCamera && (
          <FadeInUp>
            <CameraFeed
              url={mainCameraUrl}
              snapshotUrl={mainSnapshotUrl}
              height={300}
              radius={radius.lg}
              lightOn={ledOn}
              onToggleLight={ledKey ? toggleLed : undefined}
              stats={cameraStats}
            />
          </FadeInUp>
        )}

        {showCameraValues && (
          <FadeInUp delay={hasCamera ? 40 : 0}>
            <CameraValues
              temps={show.temps ? temps : []}
              unit={unit}
              showMotion={show.homeDock}
              canMove={canMove}
              onHome={doHome}
              onDock={doDock}
            />
          </FadeInUp>
        )}

        {show.estop && (
          <FadeInUp delay={60}>
            <View style={styles.estopWrap}>
              <GlowBackdrop color={colors.primary} size={300} opacity={0.24} style={{ bottom: -100, alignSelf: 'center' }} />
              <PressableScale style={styles.estopBar} onPress={doEstop} activeScale={0.97}>
                <MaterialCommunityIcons name="alert-octagon" size={21} color="#fff" />
                <Text style={styles.estopText}>{t('EMERGENCY STOP')}</Text>
              </PressableScale>
            </View>
          </FadeInUp>
        )}

        {/* print status card */}
        {showJobCard && (
          <FadeInUp delay={40}>
            <Card style={styles.jobCard}>
              <View style={styles.jobRow}>
                <View style={styles.thumbBox}>
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
                  ) : (
                    <MaterialCommunityIcons name="cube-outline" size={30} color={colors.subtext} />
                  )}
                </View>
                <View style={styles.jobInfo}>
                  <Text style={styles.jobTitle} numberOfLines={1}>
                    {jobTitle}
                  </Text>
                  {subtitle ? (
                    <Text style={styles.jobSubtitle} numberOfLines={1}>
                      {subtitle}
                    </Text>
                  ) : null}
                  <View style={styles.jobPctRow}>
                    <Text style={styles.jobPct}>{pct}</Text>
                    <Text style={[styles.jobStatus, { color: stateColor(displayState) }]}>
                      {statusText(displayState)}
                    </Text>
                  </View>
                  <ProgressBar progress={progress} color={stateColor(displayState)} height={7} style={{ marginTop: 6 }} />
                  {(layer || remaining !== '--') && (
                    <Text style={styles.jobMeta} numberOfLines={1}>
                      {[layer && `${t('Layer')} ${layer}`, activeJob && remaining !== '--' && `${remaining} ${t('left')}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  )}
                </View>
              </View>

              {activeJob && show.actions ? (
                <View style={styles.jobActions}>
                  {printing && (
                    <JobButton icon="pause" label={t('Pause')} onPress={doPause} disabled={!connected} />
                  )}
                  {paused && (
                    <JobButton icon="play" label={t('Resume')} onPress={doResume} disabled={!connected} />
                  )}
                  <JobButton icon="close" label={t('Cancel')} tone="danger" onPress={doCancel} disabled={!connected} />
                </View>
              ) : observedFinished ? (
                <View style={styles.jobActions}>
                  <JobButton icon="refresh" label={t('Print again')} onPress={reprint} disabled={!canMove} />
                  <JobButton
                    icon="close"
                    label={t('Dismiss')}
                    tone="ghost"
                    onPress={() => setDismissedJob(jobKey)}
                  />
                </View>
              ) : null}
            </Card>
          </FadeInUp>
        )}

        {show.controls && (
          <FadeInUp delay={140}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('Controls')}</Text>
            </View>
            <ControlsPanel
              status={status}
              sendGcode={sendGcode}
              disabled={!connected}
              showPandaBreath={show.pandaBreath}
              gcodeHelp={gcodeHelp}
              temperatureUnit={unit}
            />
          </FadeInUp>
        )}

        {show.macros && (
          <FadeInUp delay={160}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('Macros')}</Text>
            </View>
            <MacrosPanel />
          </FadeInUp>
        )}

        {/* extra cameras */}
        {show.camera &&
          webcams
            .filter((w) => resolveCameraUrl(w.stream_url, activeBaseUrl) !== mainCameraUrl)
            .map((w) => (
              <View key={w.name} style={styles.extraCamera}>
                <Text style={styles.cameraName}>{w.name}</Text>
                <CameraFeed
                  url={resolveCameraUrl(w.stream_url, activeBaseUrl)}
                  snapshotUrl={resolveSnapshotUrl(w.snapshot_url, w.stream_url, activeBaseUrl)}
                  height={220}
                />
              </View>
            ))}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.pickerModalLayer}>
          <Pressable style={[StyleSheet.absoluteFill, styles.pickerScrim]} onPress={() => setPickerOpen(false)} />
          <PopIn
            style={[
              styles.pickerSheet,
              {
                left: pickerLeft,
                top: pickerTop,
                width: pickerWidth,
                maxHeight: pickerMaxHeight,
              },
            ]}
          >
            <Text style={styles.pickerHeader}>{t('Devices')}</Text>
            <ScrollView
              style={{ maxHeight: pickerMaxHeight - 58 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.pickerList}
            >
              {settings.printers.map((p) => {
                const active = p.id === settings.activePrinterId;
                const rowStatus = active
                  ? { connected: connection === 'connected', state: displayState, progress }
                  : pickerStatuses[p.id] ?? { connected: false, state: 'checking', progress: 0 };
                const checking = !active && !pickerStatuses[p.id];
                const rowUrl = printerConnectionUrl(p);
                return (
                  <PressableScale
                    key={p.id}
                    style={[styles.pickerRow, active && styles.pickerRowActive]}
                    onPress={() => switchPrinter(p)}
                    activeScale={0.98}
                  >
                    <View style={[styles.pickerDot, { backgroundColor: checking ? colors.subtext : pickerStatusColor(rowStatus) }]} />
                    <View style={styles.pickerBody}>
                      <View style={styles.pickerNameRow}>
                        <Text style={styles.pickerName} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <StatusBadge
                          label={active ? t('Active') : checking ? t('Checking') : pickerStatusLabel(rowStatus)}
                          color={active ? colors.primary : checking ? colors.subtext : pickerStatusColor(rowStatus)}
                        />
                      </View>
                      <Text style={styles.pickerUrl} numberOfLines={1}>
                        {shortUrl(rowUrl)}
                      </Text>
                      <View style={styles.pickerMetaRow}>
                        <MaterialCommunityIcons
                          name={connectionModeIcon(p.connectionMode)}
                          size={13}
                          color={colors.subtext}
                        />
                        <Text style={styles.pickerMeta} numberOfLines={1}>
                          {checking
                            ? t('Checking connection')
                            : rowStatus.connected
                              ? `${t('Connected')} · ${connectionModeLabel(p.connectionMode)}`
                              : `${t('Offline')} · ${connectionModeLabel(p.connectionMode)}`}
                          {rowStatus.connected && printerBusy(rowStatus.state)
                            ? ` · ${Math.round(rowStatus.progress * 100)}%`
                            : ''}
                        </Text>
                      </View>
                    </View>
                    {active && <MaterialCommunityIcons name="check" size={18} color={colors.primary} />}
                  </PressableScale>
                );
              })}
              <PressableScale
                style={styles.pickerRow}
                onPress={() => {
                  setPickerOpen(false);
                  router.push('/settings');
                }}
                activeScale={0.98}
              >
                <View style={styles.addPrinterIcon}>
                  <MaterialCommunityIcons name="plus" size={18} color={colors.primary} />
                </View>
                <View style={styles.pickerBody}>
                  <Text style={styles.pickerName}>{t('Add printer')}</Text>
                  <Text style={styles.pickerUrl} numberOfLines={1}>
                    {t('Open Settings')}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.subtext} />
              </PressableScale>
            </ScrollView>
          </PopIn>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.statusBadge, { backgroundColor: withAlpha(color, 0.14), borderColor: withAlpha(color, 0.36) }]}>
      <Text style={[styles.statusBadgeText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function CameraValues({
  temps,
  unit,
  showMotion,
  canMove,
  onHome,
  onDock,
}: {
  temps: { key: string; label: string; temperature?: number; target?: number }[];
  unit: TemperatureUnit;
  showMotion: boolean;
  canMove: boolean;
  onHome: () => void;
  onDock: () => void;
}) {
  return (
    <View style={styles.cameraValues}>
      {temps.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.valueTemps}
        >
          {temps.map((tp) => (
            <MiniTemp key={tp.key} label={tp.label} temperature={tp.temperature} target={tp.target} unit={unit} />
          ))}
        </ScrollView>
      )}
      {showMotion && (
        <View style={styles.valueButtons}>
          <JobButton icon="home" label={t('Home All')} onPress={onHome} disabled={!canMove} />
          <JobButton icon="garage" label={t('Dock Toolhead')} onPress={onDock} disabled={!canMove} />
        </View>
      )}
    </View>
  );
}

function MiniTemp({
  label,
  temperature,
  target,
  unit,
}: {
  label: string;
  temperature?: number;
  target?: number;
  unit: TemperatureUnit;
}) {
  const temp = typeof temperature === 'number' ? temperature : 0;
  const tgt = typeof target === 'number' ? target : 0;
  const color = tgt > 0 ? colors.hot : temp >= 50 ? colors.warning : colors.cold;
  const progress = tgt > 0 ? clampProgress(temp / tgt) : clampProgress(temp / 250);
  return (
    <View style={styles.miniTemp}>
      <View style={styles.miniGauge}>
        <ArcGauge progress={progress} size={50} strokeWidth={4} color={color} />
        <View style={styles.miniGaugeCenter}>
          <Text style={[styles.miniValue, { color }]} numberOfLines={1}>
            {Math.round(displayTemperature(temp, unit))}°
          </Text>
        </View>
      </View>
      <Text style={styles.miniLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function JobButton({
  icon,
  label,
  onPress,
  disabled,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger' | 'ghost';
}) {
  const bg = tone === 'danger' ? colors.danger : tone === 'ghost' ? colors.cardAlt : colors.primary;
  const fg = tone === 'ghost' ? colors.text : '#fff';
  return (
    <PressableScale style={{ flex: 1 }} onPress={onPress} disabled={disabled}>
      <View style={[styles.jobBtn, { backgroundColor: bg }, disabled && styles.disabled]}>
        <MaterialCommunityIcons name={icon} size={17} color={fg} />
        <Text style={[styles.jobBtnText, { color: fg }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: 110,
    gap: spacing.md,
  },
  headerStack: {
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 50,
    position: 'relative',
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 48,
  },
  nameAnchor: {
    alignSelf: 'center',
    maxWidth: '100%',
  },
  nameRow: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: spacing.xs,
    paddingRight: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  nameRowOpen: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  printerName: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    flexShrink: 1,
    textAlign: 'center',
  },
  onlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineText: { color: colors.subtext, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: withAlpha(colors.warning, 0.14),
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warnText: { color: colors.warning, fontSize: 13, fontWeight: '700' },
  cameraValues: {
    gap: spacing.sm,
    marginTop: -spacing.xs,
  },
  valueTemps: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  valueButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  miniTemp: {
    alignItems: 'center',
    width: 72,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  miniGauge: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  miniGaugeCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  miniValue: { fontSize: 13, fontWeight: '900' },
  miniLabel: { color: colors.subtext, fontSize: 11, fontWeight: '700', marginTop: 2 },
  jobCard: { gap: spacing.md },
  jobRow: { flexDirection: 'row', gap: spacing.md },
  thumbBox: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  jobInfo: { flex: 1, minWidth: 0 },
  jobTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  jobSubtitle: { color: colors.subtext, fontSize: 12, fontWeight: '600', marginTop: 1 },
  jobPctRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6 },
  jobPct: { color: colors.text, fontSize: 22, fontWeight: '900' },
  jobStatus: { fontSize: 13, fontWeight: '800' },
  jobMeta: { color: colors.subtext, fontSize: 12, fontWeight: '600', marginTop: 6 },
  jobActions: { flexDirection: 'row', gap: spacing.sm },
  jobBtn: {
    minHeight: 46,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  jobBtnText: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  disabled: { opacity: 0.4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  estopWrap: { alignItems: 'center', justifyContent: 'center' },
  estopBar: {
    width: '100%',
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadow.card,
  },
  estopText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  extraCamera: { gap: spacing.xs },
  cameraName: { color: colors.subtext, fontSize: 12, fontWeight: '700' },
  pickerModalLayer: {
    flex: 1,
  },
  pickerScrim: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pickerSheet: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.hero,
  },
  pickerHeader: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  pickerList: { paddingBottom: spacing.xs },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 70,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pickerRowActive: {
    backgroundColor: withAlpha(colors.primary, 0.12),
  },
  pickerBody: { flex: 1, minWidth: 0 },
  pickerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pickerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  statusBadge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: 92,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  pickerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  pickerMeta: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  addPrinterIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.primary, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerName: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1, minWidth: 0 },
  pickerUrl: { color: colors.subtext, fontSize: 13, marginTop: 2 },
});
