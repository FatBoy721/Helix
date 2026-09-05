// Cockpit top-of-dashboard: camera card + job card, both fed by CockpitData.
//
// The camera is deliberately unobstructed — no scrim, no status band across it.
// When a real camera is configured this renders the app's own CameraFeed, which
// brings its actual controls (stats / light / snapshot / refresh / fullscreen)
// rather than my mock-ups of them.
import React, { useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import CameraFeed from '../../CameraFeed';
import ThemedDialog from '../../ThemedDialog';
import { ProgressBar } from '../../ui/progress';
import { alpha, CameraMock, COCKPIT as P, Dot, ThumbMock, type IconName } from '../shared';
import type { CockpitData } from './data';
import { t } from '../../../services/i18n';
import type { BambuSpeedPreset } from '../../../services/bambuMqtt';

const BAMBU_SPEEDS: { preset: BambuSpeedPreset; label: string }[] = [
  { preset: 1, label: 'Silent (50%)' },
  { preset: 2, label: 'Standard (100%)' },
  { preset: 3, label: 'Sport (124%)' },
  { preset: 4, label: 'Ludicrous (166%)' },
];

export function CameraCard({ data, width }: { data: CockpitData; width: number }) {
  const tone = toneFor(data);
  // Match the stream's own aspect. A fixed height letterboxes the feed and
  // strands the overlay chrome in grey bands instead of over the picture.
  const height = Math.round(width * (9 / 16));

  return (
    <View style={styles.camCard}>
      {data.camera ? (
        <CameraFeed
          url={data.camera.url}
          snapshotUrl={data.camera.snapshotUrl}
          height={height}
          chromeless
          lightOn={data.lightOn}
          onToggleLight={data.toggleLight}
        />
      ) : (
        <CameraMock
          palette={P}
          height={height}
          radius={0}
          label={t('NO CAMERA CONFIGURED')}
        />
      )}

      {/* Bottom-left: CameraFeed anchors its own controls top-right, so the
          state pill has to sit clear of them. */}
      <View style={styles.camPill}>
        <Dot color={tone.color} size={6} />
        <Text style={styles.camPillText}>{tone.label}</Text>
      </View>
    </View>
  );
}

export function JobCard({ data }: { data: CockpitData }) {
  const { state } = data;
  // Cancel used to fire printer.print.cancel straight from the button, so a
  // mis-tap threw away a print with no way back.
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showHms, setShowHms] = useState(false);
  const [showSkipObjects, setShowSkipObjects] = useState(false);
  const [selectedSkipIds, setSelectedSkipIds] = useState<number[]>([]);
  const [skipBusy, setSkipBusy] = useState(false);
  const hmsFaults = data.bambu?.hmsFaults ?? [];
  const hasHmsFaults = hmsFaults.length > 0;
  const printObjects = data.bambu?.printObjects ?? [];
  const activePrintObjects = printObjects.filter((object) => !object.skipped);
  const canSkipObjects = state === 'printing' && activePrintObjects.length > 1;
  const openSkipObjects = () => {
    setSelectedSkipIds([]);
    setShowSkipObjects(true);
  };
  const toggleSkipObject = (identifyId: number) => {
    setSelectedSkipIds((current) =>
      current.includes(identifyId)
        ? current.filter((id) => id !== identifyId)
        : [...current, identifyId]
    );
  };
  const skipSelectionInvalid =
    selectedSkipIds.length === 0 || selectedSkipIds.length >= activePrintObjects.length;
  const confirmSkipObjects = async () => {
    if (skipSelectionInvalid || skipBusy) return;
    setSkipBusy(true);
    try {
      await data.actions.skipBambuObjects(selectedSkipIds);
      setShowSkipObjects(false);
      setSelectedSkipIds([]);
    } catch (error: unknown) {
      Alert.alert(
        t('Could not skip objects'),
        error instanceof Error ? error.message : t('The printer rejected the command.')
      );
    } finally {
      setSkipBusy(false);
    }
  };
  const chooseBambuSpeed = () => {
    Alert.alert(t('Print speed'), t('Choose a Bambu speed preset.'), [
      { text: t('Cancel'), style: 'cancel' },
      ...BAMBU_SPEEDS.map(({ preset, label }) => ({
        text: data.bambu?.speedPreset === preset ? `✓ ${label}` : label,
        onPress: () => void data.actions.setBambuSpeed(preset).catch((error: unknown) => {
          Alert.alert(
            t('Speed change failed'),
            error instanceof Error ? error.message : t('The printer did not accept the speed change.')
          );
        }),
      })),
    ]);
  };

  // Nothing to report when idle: the camera pill already says READY, so a card
  // holding a placeholder thumbnail and two navigation buttons was just noise
  // between the feed and the toolheads. Files and Slice live in the tab bar.
  if (state === 'idle' && (!hasHmsFaults || data.offline)) return null;

  return (
    <View
      style={[
        styles.jobCard,
        (state === 'error' || hasHmsFaults) && { borderColor: alpha(P.danger, 0.5) },
      ]}
    >
      <View style={styles.jobTop}>
        {state === 'error' || (state === 'idle' && hasHmsFaults) ? (
          <View style={styles.errIcon}>
            <MaterialCommunityIcons name="alert-circle-outline" size={32} color={P.danger} />
          </View>
        ) : data.job?.thumbUri ? (
          <Image source={{ uri: data.job.thumbUri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <ThumbMock palette={P} />
        )}
        <View style={styles.jobInfo}>{renderInfo(data)}</View>
      </View>

      {state === 'printing' && data.job ? (
        <View style={styles.progressRow}>
          <ProgressBar
            progress={data.job.progress}
            color={P.accent}
            trackColor={P.surfaceAlt}
            height={7}
            style={styles.progressBar}
          />
          <Text style={styles.progressPct}>{Math.round(data.job.progress * 100)}%</Text>
        </View>
      ) : null}

      {hasHmsFaults ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowHms(true)}
          style={({ pressed }) => [styles.hmsBanner, pressed && { opacity: 0.72 }]}
        >
          <MaterialCommunityIcons name="alert-outline" size={20} color={P.danger} />
          <View style={styles.hmsBannerText}>
            <Text style={styles.hmsBannerTitle} numberOfLines={1}>
              {hmsFaults.length === 1 ? t('Printer alert') : `${hmsFaults.length} ${t('printer alerts')}`}
            </Text>
            <Text style={styles.hmsBannerCode} numberOfLines={1}>
              {hmsFaults[0]?.code}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={P.dim} />
        </Pressable>
      ) : null}

      {canSkipObjects ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Skip objects')}
          onPress={openSkipObjects}
          style={({ pressed }) => [styles.skipBanner, pressed && { opacity: 0.72 }]}
        >
          <MaterialCommunityIcons name="selection-remove" size={20} color={P.warn} />
          <View style={styles.skipBannerText}>
            <Text style={styles.skipBannerTitle}>{t('Skip objects')}</Text>
            <Text style={styles.skipBannerDetail}>
              {activePrintObjects.length} {t('objects still printing')}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={P.dim} />
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        {renderActions(data, () => setConfirmCancel(true), chooseBambuSpeed)}
      </View>

      {/* Layer rather than Focus: losing a print is bad but recoverable — you
          can re-slice and print again — so it doesn't earn the whole screen
          the way the e-stop does. The button stays red regardless. */}
      <ThemedDialog
        visible={confirmCancel}
        shape="layer"
        title={t('Cancel this print?')}
        message={
          data.job
            ? `${data.job.name} ${t('will stop where it is. The partial print stays on the bed and the filament used is spent.')}`
            : t('The running print will stop where it is.')
        }
        icon="close-octagon-outline"
        onClose={() => setConfirmCancel(false)}
        actions={[
          {
            text: t('Cancel print'),
            icon: 'close-octagon-outline',
            variant: 'danger',
            onPress: () => {
              setConfirmCancel(false);
              data.actions.cancel();
            },
          },
          { text: t('Keep printing'), onPress: () => setConfirmCancel(false) },
        ]}
      />

      <ThemedDialog
        visible={showHms}
        shape="layer"
        title={hmsFaults.length === 1 ? t('Printer alert') : t('Printer alerts')}
        message={hmsFaults
          .map((fault) => `${fault.code}\n${fault.summary}`)
          .join('\n\n')}
        icon="alert-outline"
        onClose={() => setShowHms(false)}
        actions={[
          ...(data.paused
            ? [{
                text: t('Resume print'),
                icon: 'play' as const,
                variant: 'primary' as const,
                onPress: () => {
                  setShowHms(false);
                  data.actions.resume();
                },
              }]
            : []),
          ...(state === 'printing'
            ? [{
                text: t('Stop print'),
                icon: 'close-octagon-outline' as const,
                variant: 'danger' as const,
                onPress: () => {
                  setShowHms(false);
                  setConfirmCancel(true);
                },
              }]
            : []),
          {
            text: t('Clear alert'),
            icon: 'check' as const,
            onPress: () => {
              setShowHms(false);
              void data.actions.clearBambuErrors().catch((error: unknown) => {
                Alert.alert(
                  t('Could not clear alert'),
                  error instanceof Error ? error.message : t('The printer rejected the command.')
                );
              });
            },
          },
          {
            text: t('Official help'),
            icon: 'open-in-new' as const,
            onPress: () => {
              const helpUrl = hmsFaults[0]?.helpUrl;
              if (helpUrl) void Linking.openURL(helpUrl).catch(() => {
                Alert.alert(t('Could not open Bambu Lab help.'));
              });
            },
          },
          { text: t('Close'), onPress: () => setShowHms(false) },
        ]}
      />

      <ThemedDialog
        visible={showSkipObjects}
        title={t('Skip objects')}
        message={
          selectedSkipIds.length >= activePrintObjects.length
            ? t('Keep at least one object printing.')
            : t('Selected objects will stop printing permanently. This cannot be undone.')
        }
        icon="selection-remove"
        onClose={() => !skipBusy && setShowSkipObjects(false)}
        actions={[
          {
            text: skipBusy
              ? t('Sending…')
              : `${t('Skip selected')} (${selectedSkipIds.length})`,
            icon: 'selection-remove',
            variant: 'danger',
            disabled: skipSelectionInvalid || skipBusy,
            onPress: () => void confirmSkipObjects(),
          },
          {
            text: t('Keep printing'),
            disabled: skipBusy,
            onPress: () => setShowSkipObjects(false),
          },
        ]}
      >
        <View style={styles.skipObjectList}>
          {printObjects.map((object) => {
            const selected = selectedSkipIds.includes(object.identifyId);
            return (
              <Pressable
                key={object.identifyId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: object.skipped || selected, disabled: object.skipped }}
                disabled={object.skipped || skipBusy}
                onPress={() => toggleSkipObject(object.identifyId)}
                style={({ pressed }) => [
                  styles.skipObjectRow,
                  selected && styles.skipObjectRowSelected,
                  object.skipped && { opacity: 0.5 },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <MaterialCommunityIcons
                  name={object.skipped || selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={23}
                  color={object.skipped ? P.dim : selected ? P.danger : P.text}
                />
                <View style={styles.skipObjectText}>
                  <Text style={styles.skipObjectName} numberOfLines={2}>{object.name}</Text>
                  <Text style={styles.skipObjectId}>
                    {object.skipped ? t('Already skipped') : `ID ${object.identifyId}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ThemedDialog>
    </View>
  );
}

function toneFor(data: CockpitData): { label: string; color: string } {
  if (data.connecting) return { label: t('CONNECTING'), color: P.dim };
  if (data.offline) return { label: t('OFFLINE'), color: P.dim };
  switch (data.state) {
    case 'printing':
      return { label: t('PRINTING'), color: P.accent };
    case 'finished':
      return { label: t('COMPLETE'), color: P.success };
    case 'error':
      return { label: t('ERROR'), color: P.danger };
    default:
      return { label: t('READY'), color: P.success };
  }
}

function renderInfo(data: CockpitData) {
  const { state, job } = data;
  const firstHmsFault = data.bambu?.hmsFaults[0];

  if (state === 'idle' && firstHmsFault) {
    return (
      <>
        <Text style={[styles.jobTitle, { color: P.danger }]}>{t('Printer needs attention')}</Text>
        <Text style={styles.jobSub} numberOfLines={3}>{firstHmsFault.summary}</Text>
      </>
    );
  }

  if (state === 'printing' && job) {
    return (
      <>
        <Text style={styles.jobTitle} numberOfLines={1} ellipsizeMode="middle">
          {job.name}
        </Text>
        <Text style={styles.jobMeta}>{job.remaining} {t('left')}</Text>
        <Text style={styles.jobSub}>
          {[job.layerText, job.eta !== '--' ? `${t('done')} ${job.eta}` : ''].filter(Boolean).join(' · ')}
        </Text>
      </>
    );
  }

  if (state === 'finished' && job) {
    return (
      <>
        <Text style={styles.jobTitle} numberOfLines={1} ellipsizeMode="middle">
          {job.name}
        </Text>
        <Text style={[styles.jobMeta, { color: P.success }]}>{t('Complete')}</Text>
        <Text style={styles.jobSub}>{job.layerText}</Text>
      </>
    );
  }

  if (state === 'error') {
    return (
      <>
        <Text style={[styles.jobTitle, { color: P.danger }]}>{t('Print failed')}</Text>
        {/* Three lines: truncating a Klipper shutdown reason to an ellipsis is
            what forces people over to the Console tab to find out what broke. */}
        <Text style={styles.jobSub} numberOfLines={3}>
          {data.errorMessage || t('The printer reported an error.')}
        </Text>
      </>
    );
  }

  // Reachable only in the odd case of a printing/finished state with no job
  // metadata (e.g. an empty filename); the idle state never renders this card.
  return (
    <>
      <Text style={styles.jobTitle}>{t('Print in progress')}</Text>
      <Text style={styles.jobSub}>{data.connectionLabel}</Text>
    </>
  );
}

function renderActions(data: CockpitData, onCancel: () => void, onSpeed: () => void) {
  const { actions, state, paused } = data;

  if (state === 'printing') {
    return (
      <>
        {data.bambu ? (
          <Action
            icon="speedometer"
            label={
              BAMBU_SPEEDS.find((item) => item.preset === data.bambu?.speedPreset)
                ?.label.split(' ')[0] ?? t('Speed')
            }
            tone="ghost"
            onPress={onSpeed}
          />
        ) : null}
        {paused ? (
          <Action icon="play" label={t('Resume')} tone="accent" onPress={actions.resume} />
        ) : (
          <Action icon="pause" label={t('Pause')} tone="accent" onPress={actions.pause} />
        )}
        {/* Confirms first — this is the only irreversible control on the card. */}
        <Action icon="close" label={t('Cancel')} tone="danger" onPress={onCancel} />
      </>
    );
  }
  if (state === 'finished') {
    return (
      <>
        <Action icon="refresh" label={t('Print again')} tone="accent" onPress={actions.reprint} />
        <Action icon="check" label={t('Dismiss')} tone="ghost" onPress={actions.dismissFinished} />
      </>
    );
  }
  if (state === 'error') {
    return <Action icon="check" label={t('Dismiss')} tone="ghost" onPress={actions.dismissFinished} />;
  }
  return null;
}

function Action({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: IconName;
  label: string;
  tone: 'accent' | 'danger' | 'ghost';
  onPress?: () => void;
}) {
  const fg = tone === 'accent' ? P.onAccent : tone === 'danger' ? P.danger : P.text;
  const bg =
    tone === 'accent' ? P.accentFill : tone === 'danger' ? alpha(P.danger, 0.13) : P.surfaceAlt;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: bg }, pressed && { opacity: 0.7 }]}
    >
      <MaterialCommunityIcons name={icon} size={19} color={fg} />
      <Text style={[styles.actionText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  camCard: {
    borderRadius: P.radius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
  },
  camPill: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: alpha('#000000', 0.55),
  },
  camPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  jobCard: {
    borderRadius: P.radius,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    padding: 14,
    gap: 13,
  },
  jobTop: { flexDirection: 'row', gap: 13 },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: 14,
    backgroundColor: P.surfaceAlt,
    borderWidth: 1,
    borderColor: P.border,
  },
  errIcon: {
    width: 76,
    height: 76,
    borderRadius: 14,
    backgroundColor: alpha(P.danger, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobInfo: { flex: 1, justifyContent: 'center', gap: 3 },
  jobTitle: { color: P.text, fontSize: 15, fontWeight: '800' },
  jobMeta: { color: P.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  jobSub: { color: P.dim, fontSize: 12, fontWeight: '600', lineHeight: 16 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressBar: { flex: 1 },
  progressPct: { color: P.text, fontSize: 13, fontWeight: '800', minWidth: 38, textAlign: 'right' },

  hmsBanner: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: alpha(P.danger, 0.32),
    backgroundColor: alpha(P.danger, 0.09),
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hmsBannerText: { flex: 1, gap: 2 },
  hmsBannerTitle: { color: P.text, fontSize: 13, fontWeight: '800' },
  hmsBannerCode: { color: P.dim, fontSize: 11, fontWeight: '700' },

  skipBanner: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: alpha(P.warn, 0.3),
    backgroundColor: alpha(P.warn, 0.08),
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  skipBannerText: { flex: 1, gap: 2 },
  skipBannerTitle: { color: P.text, fontSize: 13, fontWeight: '800' },
  skipBannerDetail: { color: P.dim, fontSize: 11, fontWeight: '700' },
  skipObjectList: { alignSelf: 'stretch', width: '100%', maxWidth: 460, gap: 8 },
  skipObjectRow: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skipObjectRowSelected: {
    borderColor: alpha(P.danger, 0.65),
    backgroundColor: alpha(P.danger, 0.1),
  },
  skipObjectText: { flex: 1, gap: 2 },
  skipObjectName: { color: P.text, fontSize: 14, fontWeight: '800' },
  skipObjectId: { color: P.dim, fontSize: 11, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    height: 54,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 6,
  },
  actionText: { fontSize: 14, fontWeight: '800' },
});
