// Cockpit top-of-dashboard: camera card + job card, both fed by CockpitData.
//
// The camera is deliberately unobstructed — no scrim, no status band across it.
// When a real camera is configured this renders the app's own CameraFeed, which
// brings its actual controls (stats / light / snapshot / refresh / fullscreen)
// rather than my mock-ups of them.
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import CameraFeed from '../../CameraFeed';
import ThemedDialog from '../../ThemedDialog';
import { ProgressBar } from '../../ui/progress';
import { alpha, CameraMock, COCKPIT as P, Dot, ThumbMock, type IconName } from '../shared';
import type { CockpitData } from './data';
import { t } from '../../../services/i18n';

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

  // Nothing to report when idle: the camera pill already says READY, so a card
  // holding a placeholder thumbnail and two navigation buttons was just noise
  // between the feed and the toolheads. Files and Slice live in the tab bar.
  if (state === 'idle') return null;

  return (
    <View style={[styles.jobCard, state === 'error' && { borderColor: alpha(P.danger, 0.5) }]}>
      <View style={styles.jobTop}>
        {state === 'error' ? (
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

      <View style={styles.actions}>{renderActions(data, () => setConfirmCancel(true))}</View>

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
    </View>
  );
}

function toneFor(data: CockpitData): { label: string; color: string } {
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

function renderActions(data: CockpitData, onCancel: () => void) {
  const { actions, state, paused } = data;

  if (state === 'printing') {
    return (
      <>
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
