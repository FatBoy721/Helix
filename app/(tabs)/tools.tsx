// Tools — Rail's categories, Nova's connected rows, Cockpit's colour.
//
// Rail's contribution is the grouping: tools sit under Printer / Materials /
// Diagnostics headings instead of one undifferentiated list, so you look in a
// category rather than reading five titles. Nova's contribution is the rows
// themselves — each group is one card with hairline-separated rows, nothing
// boxed inside anything else.
//
// One accent throughout. Colour-coding the groups was doing the same job as the
// headings twice, and a rainbow of edges says "these differ" without saying how.
//
// Each row spends its second line on live state rather than a description you
// read once. bed_mesh and print_task_config are both subscribed, so those are
// real. Spoolman and Console aren't probed anywhere — a green "Connected" for
// them would be invented, so they keep a static descriptor and no dot.
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  alpha,
  COCKPIT as P,
  Dot,
  SectionLabel,
  type IconName,
} from '../../components/dashboard/shared';
import Bespok3dEnrollmentDialog from '../../components/settings/Bespok3dEnrollmentDialog';
import ThemedDialog from '../../components/ThemedDialog';
import { useMoonraker } from '../../hooks/useMoonraker';
import { useSettings } from '../../hooks/useSettings';
import { type BambuCalibrationOptions } from '../../services/bambuControls';
import { startBambuCalibration } from '../../services/bambuMqtt';
import { t } from '../../services/i18n';

interface Tool {
  key: string;
  title: string;
  /** Shown when there's no live status for this tool. */
  short: string;
  icon: IconName;
  route?: string;
}

interface Category {
  title: string;
  tools: Tool[];
}

const CATEGORIES: Category[] = [
  {
    title: 'Printer',
    tools: [
      {
        key: 'bambuCalibration',
        title: 'Calibration',
        short: 'Bed, vibration and motor-noise calibration',
        icon: 'tune-variant',
      },
      {
        key: 'mesh',
        title: 'Bed Mesh',
        short: 'Surface shape',
        icon: 'grid',
        route: '/mesh',
      },
      {
        key: 'ace',
        title: 'multiACE',
        short: 'Filament lanes',
        icon: 'palette-swatch',
        route: '/ace',
      },
    ],
  },
  {
    title: 'Materials',
    tools: [
      {
        key: 'spoolman',
        title: 'Spoolman',
        short: 'Spools, usage and labels',
        icon: 'paper-roll-outline',
        route: '/spoolman',
      },
    ],
  },
  {
    title: 'Plugins',
    tools: [
      {
        key: 'bespok3d',
        title: 'Bespok3d',
        short: 'Secure remote access',
        icon: 'cube-outline',
      },
    ],
  },
  {
    title: 'Diagnostics',
    tools: [
      {
        key: 'console',
        title: 'Console',
        short: 'Send commands, read replies',
        icon: 'console',
        route: '/console',
      },
    ],
  },
];

type Tone = 'ok' | 'warn' | 'off';

interface Status {
  label: string;
  tone: Tone;
}

function toneColor(tone: Tone): string {
  if (tone === 'ok') return P.success;
  if (tone === 'warn') return P.warn;
  return P.dim;
}

export default function ToolsScreen() {
  const router = useRouter();
  const { settings } = useSettings();
  const { connection, status } = useMoonraker();
  const [bespokOpen, setBespokOpen] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const connected = connection === 'connected';
  const activePrinter = settings.printers.find(
    (printer) => printer.id === settings.activePrinterId,
  );
  const activeU1 =
    activePrinter?.kind === 'snapmaker-u1' ? activePrinter : null;
  const activeBambu =
    activePrinter?.kind === 'bambu-lan' ? activePrinter : null;
  const bambuPrintState = String(status.print_stats?.state ?? '').toLowerCase();
  const bambuIdle =
    bambuPrintState === 'standby' || bambuPrintState === 'complete';

  const statuses = useMemo<Record<string, Status | null>>(() => {
    const bespok3d: Status = activeU1
      ? { label: `Manage on ${activeU1.name}`, tone: 'ok' }
      : { label: 'Select a Snapmaker U1', tone: 'warn' };

    if (!connected) {
      const off: Status = { label: t('Offline'), tone: 'off' };
      return {
        bambuCalibration: off,
        mesh: off,
        ace: off,
        spoolman: off,
        bespok3d,
        console: off,
      };
    }

    const profile: unknown = status.bed_mesh?.profile_name;
    const exists: unknown[] = Array.isArray(
      status.print_task_config?.filament_exist,
    )
      ? status.print_task_config.filament_exist
      : [];
    const loaded = exists.filter(Boolean).length;

    return {
      bambuCalibration: activeBambu
        ? bambuIdle
          ? { label: t('Ready — printer is idle'), tone: 'ok' }
          : { label: t('Available when the printer is idle'), tone: 'warn' }
        : null,
      mesh:
        typeof profile === 'string' && profile
          ? { label: profile, tone: 'ok' }
          : { label: t('No mesh loaded'), tone: 'warn' },
      ace:
        loaded > 0
          ? {
              label: `${loaded} ${t('of')} ${exists.length || 4} ${t('lanes')}`,
              tone: 'ok',
            }
          : { label: t('No filament'), tone: 'warn' },
      spoolman: null,
      bespok3d,
      console: null,
    };
  }, [activeBambu, activeU1, bambuIdle, connected, status]);

  const confirmBambuCalibration = (
    label: string,
    options: BambuCalibrationOptions,
  ) => {
    setCalibrationOpen(false);
    Alert.alert(
      t(`Start ${label}?`),
      t(
        'The printer must be empty and unobstructed. It will move and make calibration sounds.',
      ),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Start calibration'),
          onPress: () => {
            void startBambuCalibration(options)
              .then(() => Alert.alert(t('Calibration command sent.')))
              .catch((error: unknown) => {
                Alert.alert(
                  t('Calibration failed'),
                  error instanceof Error
                    ? error.message
                    : t('The printer rejected the command.'),
                );
              });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{t('Tools')}</Text>

          {CATEGORIES.map((category) => (
            <View key={category.title} style={styles.category}>
              <SectionLabel palette={P}>{t(category.title)}</SectionLabel>

              <View style={styles.card}>
                {category.tools
                  .filter(
                    (tool) => tool.key !== 'bambuCalibration' || activeBambu,
                  )
                  .map((tool, index) => {
                    const state = statuses[tool.key];
                    const disabled =
                      (tool.key === 'bespok3d' && activeU1 === null) ||
                      (tool.key === 'bambuCalibration' &&
                        (!connected || !bambuIdle));
                    const openTool = () => {
                      if (tool.key === 'bambuCalibration') {
                        if (!disabled) setCalibrationOpen(true);
                        return;
                      }
                      if (tool.key === 'bespok3d') {
                        if (activeU1) setBespokOpen(true);
                        return;
                      }
                      if (tool.route) router.push(tool.route as never);
                    };
                    return (
                      <Pressable
                        key={tool.key}
                        onPress={openTool}
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityState={{ disabled }}
                        style={({ pressed }) => [
                          styles.row,
                          index > 0 && styles.rowDivided,
                          disabled && styles.rowDisabled,
                          pressed && { backgroundColor: alpha(P.accent, 0.07) },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={tool.icon}
                          size={24}
                          color={P.accent}
                        />

                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle}>{t(tool.title)}</Text>
                          <View style={styles.statusLine}>
                            {state ? (
                              <Dot color={toneColor(state.tone)} size={6} />
                            ) : null}
                            <Text style={styles.rowSub} numberOfLines={1}>
                              {state ? state.label : t(tool.short)}
                            </Text>
                          </View>
                        </View>

                        <MaterialCommunityIcons
                          name="chevron-right"
                          size={22}
                          color={P.dim}
                        />
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
      <Bespok3dEnrollmentDialog
        visible={bespokOpen}
        printer={activeU1}
        onClose={() => setBespokOpen(false)}
      />
      <ThemedDialog
        visible={calibrationOpen}
        shape="layer"
        title={t('Bambu calibration')}
        message={t('Choose what the printer should calibrate.')}
        icon="tune-variant"
        onClose={() => setCalibrationOpen(false)}
        actions={[
          {
            text: t('Full calibration'),
            icon: 'tune-variant',
            variant: 'primary',
            onPress: () =>
              confirmBambuCalibration('full calibration', {
                bedLeveling: true,
                vibration: true,
                motorNoise: true,
              }),
          },
          {
            text: t('Bed leveling'),
            icon: 'grid',
            onPress: () =>
              confirmBambuCalibration('bed leveling', { bedLeveling: true }),
          },
          {
            text: t('Vibration compensation'),
            icon: 'waveform',
            onPress: () =>
              confirmBambuCalibration('vibration compensation', {
                vibration: true,
              }),
          },
          {
            text: t('Motor-noise calibration'),
            icon: 'volume-high',
            onPress: () =>
              confirmBambuCalibration('motor-noise calibration', {
                motorNoise: true,
              }),
          },
          { text: t('Close'), onPress: () => setCalibrationOpen(false) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 18 },

  title: {
    color: P.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.7,
    marginBottom: -4,
  },

  category: { gap: 9 },
  card: {
    borderRadius: P.radius,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    paddingHorizontal: 16,
    height: 78,
  },
  rowDisabled: { opacity: 0.58 },
  // Hairline rather than a full border: the rows are one card, and a heavy
  // rule between them would break that.
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: P.border,
  },
  rowText: { flex: 1, gap: 4 },
  rowTitle: {
    color: P.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowSub: { flex: 1, color: P.dim, fontSize: 12, fontWeight: '600' },
});
