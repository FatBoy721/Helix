import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import {
  api,
  normalizeMoonrakerUrl,
  resolveCameraUrl,
  resolveSnapshotUrl,
} from '../../services/moonraker';
import TempGauge from '../../components/TempGauge';
import PrintProgress, { formatDuration } from '../../components/PrintProgress';
import CameraFeed, { CameraStat } from '../../components/CameraFeed';
import ControlsPanel from '../../components/ControlsPanel';
import PrinterStrip from '../../components/PrinterStrip';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

function stateColor(state: string): string {
  switch (state) {
    case 'printing': return colors.primary;
    case 'paused': return colors.warning;
    case 'error': return colors.danger;
    case 'complete': return colors.success;
    default: return colors.subtext;
  }
}

export default function Dashboard() {
  const { status, connection, klippyState, activeUrl, rpc, reconnect, sendGcode, webcams } =
    useMoonraker();
  const { settings, update } = useSettings();
  const show = settings.dashboard;

  // finished prints stay visible as a compact summary until dismissed —
  // previously the full progress card just sat there at 100% forever
  const [dismissedJob, setDismissedJob] = useState('');

  // LED strip (e.g. "led cavity_led" on the U1) — toggle via SET_LED
  const ledKey = useMemo(
    () => Object.keys(status).find((k) => /^(led|neopixel|dotstar) /.test(k)),
    [status]
  );
  const ledColors: number[][] = status[ledKey ?? '']?.color_data ?? [];
  const ledOn = ledColors.some((c) => Array.isArray(c) && c.some((v) => v > 0));
  const toggleLed = () => {
    if (!ledKey) return;
    const name = ledKey.split(' ')[1];
    const hasWhite = (ledColors[0]?.length ?? 0) >= 4;
    const v = ledOn ? 0 : 1;
    const script = hasWhite
      ? `SET_LED LED=${name} RED=0 GREEN=0 BLUE=0 WHITE=${v}`
      : `SET_LED LED=${name} RED=${v} GREEN=${v} BLUE=${v}`;
    sendGcode(script);
  };

  const ps = status.print_stats ?? {};
  const vsd = status.virtual_sdcard ?? {};
  const state: string = ps.state ?? 'unknown';
  const printing = state === 'printing';
  const paused = state === 'paused';
  const connected = connection === 'connected' && klippyState === 'ready';

  const showErr = (e: any) => Alert.alert('Error', String(e?.message ?? e));

  const doPause = () => rpc('printer.print.pause').catch(showErr);
  const doResume = () => rpc('printer.print.resume').catch(showErr);
  const doCancel = () =>
    Alert.alert(t('Cancel print?'), t('This stops the current print.'), [
      { text: t('No'), style: 'cancel' },
      {
        text: t('Yes, cancel'),
        style: 'destructive',
        onPress: () => rpc('printer.print.cancel').catch(showErr),
      },
    ]);

  // one tap, NO confirmation dialog on purpose. when you need estop you need
  // it now. fires over websocket AND raw REST to both URLs because the ws
  // might be mid-reconnect at the worst possible moment.
  const doEstop = () => {
    rpc('printer.emergency_stop').catch(() => {});
    const primary = normalizeMoonrakerUrl(settings.primaryUrl);
    const tailscale = normalizeMoonrakerUrl(settings.tailscaleUrl);
    if (primary) api.emergencyStop(primary).catch(() => {});
    if (tailscale && tailscale !== primary) api.emergencyStop(tailscale).catch(() => {});
  };

  const extruderNames = ['extruder', 'extruder1', 'extruder2', 'extruder3'];
  const activeExtruder = status.toolhead?.extruder;

  // Slicer's total time estimate comes from the file metadata; refetched when
  // the printing file changes.
  const [slicerEstimate, setSlicerEstimate] = useState<number | null>(null);
  const filename: string = ps.filename ?? '';
  useEffect(() => {
    let live = true;
    setSlicerEstimate(null);
    if (!filename || !activeUrl) return;
    api
      .metadata(activeUrl, filename)
      .then((m: any) => {
        if (live) setSlicerEstimate(typeof m?.estimated_time === 'number' ? m.estimated_time : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [filename, activeUrl]);

  const cameraStats = useMemo<CameraStat[]>(() => {
    if (!printing && !paused) return [];
    const duration: number = ps.print_duration ?? 0;
    const progress: number = vsd.progress ?? 0;
    const out: CameraStat[] = [];
    if (slicerEstimate != null) {
      out.push({
        label: t('Slicer remaining'),
        value: formatDuration(Math.max(0, slicerEstimate - duration)),
      });
    }
    if (progress > 0.001 && duration > 0) {
      const eta = duration / progress - duration;
      out.push({ label: t('Est. remaining'), value: formatDuration(eta) });
      const finish = new Date(Date.now() + eta * 1000);
      const sameDay = finish.toDateString() === new Date().toDateString();
      out.push({
        label: t('Finishes at'),
        value:
          finish.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
          (sameDay ? '' : ` (${finish.toLocaleDateString([], { month: 'short', day: 'numeric' })})`),
      });
    }
    const layer = ps.info?.current_layer;
    if (typeof layer === 'number' && layer > 0 && duration > 0) {
      out.push({ label: t('Per layer'), value: formatDuration(duration / layer) });
    }
    return out;
  }, [printing, paused, ps.print_duration, ps.info?.current_layer, vsd.progress, slicerEstimate]);

  // PARK_EXTRUDER docks the carried toolhead back in its bay = empty carriage.
  // completely undocumented — not in gcode help, not in any wiki. found it by
  // reading the PRINT_END macro source. G28 alone does NOT dock, verified via
  // the camera. needs XY homed first or it errors, hence the fallback.
  const homedAxes: string = status.toolhead?.homed_axes ?? '';
  const canMove = connected && !printing && !paused;
  const doHome = () => sendGcode('G28');
  const doDock = () =>
    sendGcode(
      homedAxes.includes('x') && homedAxes.includes('y')
        ? 'PARK_EXTRUDER'
        : 'G28\nPARK_EXTRUDER'
    );

  const activeJob = printing || paused;
  const finished = ['complete', 'cancelled', 'error'].includes(state);
  const jobKey = `${ps.filename ?? ''}|${state}`;

  const switchPrinter = (p: (typeof settings.printers)[number]) => {
    update({
      activePrinterId: p.id,
      primaryUrl: p.url,
      tailscaleUrl: p.tailscaleUrl,
      cameraUrl: p.cameraUrl,
    });
  };

  const activeBaseUrl = activeUrl || settings.primaryUrl;
  const mainCameraUrl = resolveCameraUrl(settings.cameraUrl, activeBaseUrl);
  const mainWebcam = webcams.find(
    (w) => resolveCameraUrl(w.stream_url, activeBaseUrl) === mainCameraUrl
  );
  const mainSnapshotUrl = resolveSnapshotUrl(
    mainWebcam?.snapshot_url,
    settings.cameraUrl,
    activeBaseUrl
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PrinterStrip
        printers={settings.printers}
        activeId={settings.activePrinterId}
        activeState={state}
        activeProgress={vsd.progress ?? 0}
        onSwitch={switchPrinter}
      />

      {connection !== 'connected' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {connection === 'connecting' ? `${activeUrl}…` : t('Printer offline')}
          </Text>
          <TouchableOpacity style={styles.bannerBtn} onPress={reconnect}>
            <Text style={styles.bannerBtnText}>{t('Retry')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {connection === 'connected' && klippyState !== 'ready' && (
        <View style={[styles.banner, { backgroundColor: colors.warning + '22' }]}>
          <Text style={[styles.bannerText, { color: colors.warning }]}>
            Klipper: {klippyState}
          </Text>
        </View>
      )}

      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: stateColor(state) }]} />
        <Text style={styles.statusText}>{state.toUpperCase()}</Text>
        {ps.message ? (
          <Text style={styles.statusMessage} numberOfLines={1}>
            {ps.message}
          </Text>
        ) : null}
      </View>

      {/* full progress card only while a job is live; finished jobs collapse
          to a dismissible summary instead of a stuck 100% bar */}
      {show.progress && activeJob && (
        <PrintProgress
          filename={ps.filename}
          progress={vsd.progress ?? status.display_status?.progress ?? 0}
          printDuration={ps.print_duration ?? 0}
          currentLayer={ps.info?.current_layer}
          totalLayer={ps.info?.total_layer}
        />
      )}
      {show.progress && finished && dismissedJob !== jobKey && (
        <View style={styles.finishedCard}>
          <MaterialCommunityIcons
            name={state === 'complete' ? 'check-circle' : 'close-circle'}
            size={22}
            color={state === 'complete' ? colors.success : colors.danger}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.finishedName} numberOfLines={1}>
              {(ps.filename || '').split('/').pop() || t('Last print')}
            </Text>
            <Text style={styles.finishedMeta}>
              {state} · {formatDuration(ps.total_duration ?? ps.print_duration ?? 0)}
            </Text>
          </View>
          <TouchableOpacity style={styles.finishedClose} onPress={() => setDismissedJob(jobKey)}>
            <MaterialCommunityIcons name="close" size={18} color={colors.subtext} />
          </TouchableOpacity>
        </View>
      )}

      {show.actions && activeJob && (
        <View style={styles.actionsRow}>
          {printing && (
            <ActionButton label={t('Pause')} color={colors.warning} onPress={doPause} disabled={!connected} />
          )}
          {paused && (
            <ActionButton label={t('Resume')} color={colors.success} onPress={doResume} disabled={!connected} />
          )}
          <ActionButton label={t('Cancel')} color={colors.cardAlt} onPress={doCancel} disabled={!connected} />
        </View>
      )}

      {show.estop && (
        <TouchableOpacity style={styles.estop} onPress={doEstop} activeOpacity={0.8}>
          <Text style={styles.estopText}>{t('EMERGENCY STOP')}</Text>
        </TouchableOpacity>
      )}

      {show.homeDock && (
        <View style={styles.actionsRow}>
          <ActionButton label={t('Home All')} color={colors.cardAlt} onPress={doHome} disabled={!canMove} />
          <ActionButton
            label={t('Dock Toolhead')}
            color={colors.cardAlt}
            onPress={doDock}
            disabled={!canMove}
          />
        </View>
      )}

      {show.controls && (
        <>
          <Text style={styles.sectionTitle}>{t('Controls')}</Text>
          <ControlsPanel status={status} sendGcode={sendGcode} disabled={!connected} />
        </>
      )}

      {show.temps && (
        <>
      <Text style={styles.sectionTitle}>{t('Temperatures')}</Text>
      <View style={styles.tempGrid}>
        <TempGauge
          name="Bed"
          temperature={status.heater_bed?.temperature}
          target={status.heater_bed?.target}
          power={status.heater_bed?.power}
        />
        {extruderNames.map((name, i) => (
          <TempGauge
            key={name}
            name={`T${i}`}
            temperature={status[name]?.temperature}
            target={status[name]?.target}
            power={status[name]?.power}
            active={activeExtruder === name}
          />
        ))}
      </View>
        </>
      )}

      {show.camera && (
        <>
          <Text style={styles.sectionTitle}>{t('Camera')}</Text>
          <CameraFeed
            url={mainCameraUrl}
            snapshotUrl={mainSnapshotUrl}
            lightOn={ledOn}
            onToggleLight={ledKey ? toggleLed : undefined}
            stats={cameraStats}
          />
          {/* any extra webcams registered in moonraker (e.g. a USB cam) show up
              here automatically — nothing to configure app-side */}
          {webcams
            .filter(
              (w) =>
                resolveCameraUrl(w.stream_url, activeBaseUrl) !== mainCameraUrl
            )
            .map((w) => (
              <View key={w.name}>
                <Text style={styles.cameraName}>{w.name}</Text>
                <CameraFeed
                  url={resolveCameraUrl(w.stream_url, activeBaseUrl)}
                  snapshotUrl={resolveSnapshotUrl(w.snapshot_url, w.stream_url, activeBaseUrl)}
                />
              </View>
            ))}
        </>
      )}
    </ScrollView>
  );
}

function ActionButton({
  label,
  color,
  onPress,
  disabled,
}: {
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: color }, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.actionBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  banner: {
    backgroundColor: colors.danger + '22',
    borderRadius: 8,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  bannerBtn: {
    backgroundColor: colors.danger,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  bannerBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  statusMessage: {
    color: colors.subtext,
    fontSize: 12,
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  estop: {
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  estopText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 1,
  },
  sectionTitle: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  cameraName: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  finishedCard: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  finishedName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  finishedMeta: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: 1,
  },
  finishedClose: {
    padding: 4,
  },
  tempGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
