import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMoonraker } from '../../hooks/useMoonraker';
import BedMesh3D from '../../components/BedMesh3D';
import { Card, FadeInUp, GlowBackdrop, PressableScale } from '../../components/ui';
import { t } from '../../services/i18n';
import { colors, radius, shadow, spacing, withAlpha } from '../../constants/theme';
import { useThemedAlert } from '../../hooks/useThemedAlert';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface BedMeshProfile {
  points?: number[][];
  mesh_params?: {
    min_x?: number;
    max_x?: number;
    min_y?: number;
    max_y?: number;
  };
}

interface BedMeshStatus {
  probed_matrix?: number[][];
  mesh_matrix?: number[][];
  profiles?: Record<string, BedMeshProfile>;
  profile_name?: string;
  mesh_min?: number[];
  mesh_max?: number[];
}

function matrixStats(matrix: number[][]) {
  let min = Infinity;
  let max = -Infinity;
  for (const row of matrix) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max, range: max - min };
}

function formatMm(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(4)}`;
}

function matrixPointCount(matrix: number[][]): string {
  if (!matrix.length || !matrix[0]?.length) return '--';
  return `${matrix[0].length} x ${matrix.length}`;
}

function profilePoints(profile?: BedMeshProfile): number[][] {
  return Array.isArray(profile?.points) && profile.points.length && profile.points[0]?.length
    ? profile.points
    : [];
}

export default function MeshScreen() {
  const { status, sendGcode, connection } = useMoonraker();
  const window = useWindowDimensions();
  const bm = (status.bed_mesh ?? {}) as BedMeshStatus;
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const { showAlert, alertDialog } = useThemedAlert();

  const activeMatrix: number[][] = useMemo(() => {
    const probed = bm.probed_matrix;
    if (Array.isArray(probed) && probed.length && probed[0]?.length) return probed;
    const mesh = bm.mesh_matrix;
    if (Array.isArray(mesh) && mesh.length && mesh[0]?.length) return mesh;
    return [];
  }, [bm.probed_matrix, bm.mesh_matrix]);

  const profiles = bm.profiles ?? {};
  const profileNames = Object.keys(profiles);
  const activeProfileName = bm.profile_name || 'default';
  const selectedMatrix = selectedProfile ? profilePoints(profiles[selectedProfile]) : [];
  const fallbackProfileName = !activeMatrix.length ? profileNames[0] ?? null : null;
  const fallbackMatrix = fallbackProfileName ? profilePoints(profiles[fallbackProfileName]) : [];
  const matrix = selectedMatrix.length ? selectedMatrix : activeMatrix.length ? activeMatrix : fallbackMatrix;
  const displayedProfileName = selectedMatrix.length
    ? selectedProfile
    : activeMatrix.length
      ? activeProfileName
      : fallbackProfileName;
  const isPreview = selectedMatrix.length > 0 || (!activeMatrix.length && fallbackMatrix.length > 0);
  const stats = useMemo(() => (matrix.length ? matrixStats(matrix) : null), [matrix]);
  const disabled = connection !== 'connected';
  const meshHeight = Math.min(430, Math.max(330, Math.round(window.height * 0.42)));

  const rangeProfile = isPreview && displayedProfileName ? profiles[displayedProfileName] : null;
  const mp = rangeProfile?.mesh_params;
  const xRange: [number, number] = isPreview
    ? [mp?.min_x ?? 0, mp?.max_x ?? 270]
    : [bm.mesh_min?.[0] ?? 0, bm.mesh_max?.[0] ?? 270];
  const yRange: [number, number] = isPreview
    ? [mp?.min_y ?? 0, mp?.max_y ?? 270]
    : [bm.mesh_min?.[1] ?? 0, bm.mesh_max?.[1] ?? 270];

  const runCalibration = () => {
    showAlert({
      title: t('Run bed mesh?'),
      message: t('This starts BED_MESH_CALIBRATE on the active printer.'),
      icon: 'grid',
      actions: [
        { text: t('Cancel') },
        { text: t('Run'), variant: 'primary', onPress: () => sendGcode('BED_MESH_CALIBRATE') },
      ],
    });
  };

  const loadProfile = (name: string) => {
    sendGcode(`BED_MESH_PROFILE LOAD=${name}`);
    setSelectedProfile(null);
  };

  return (
    <>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={false}
      >
      <FadeInUp>
        <View style={styles.hero}>
          <GlowBackdrop
            color={colors.primary}
            size={280}
            opacity={0.24}
            style={{ right: -120, top: -130 }}
          />
          <View style={styles.heroTop}>
            <View style={styles.heroTitleWrap}>
              <View style={styles.heroTextWrap}>
                <Text style={styles.heroTitle}>{t('Bed Mesh')}</Text>
                <Text style={styles.heroSub} numberOfLines={1}>
                  {displayedProfileName
                    ? isPreview
                      ? `${t('Previewing')} ${displayedProfileName}`
                      : `${t('Active')} ${displayedProfileName}`
                    : t('No mesh loaded')}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.statGrid}>
            <Metric icon="chart-bell-curve" label={t('Height diff')} value={stats ? `${stats.range.toFixed(4)} mm` : '--'} />
            <Metric icon="arrow-down-thin" label={t('Min')} value={stats ? formatMm(stats.min) : '--'} />
            <Metric icon="arrow-up-thin" label={t('Max')} value={stats ? formatMm(stats.max) : '--'} />
            <Metric icon="map-marker-radius-outline" label={t('Points')} value={matrixPointCount(matrix)} />
          </View>
          <Text style={styles.rangeHelp}>
            {t('Height diff is the gap between the highest and lowest measured points.')}
          </Text>
        </View>
      </FadeInUp>

      {matrix.length ? (
        <FadeInUp delay={60}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('Surface')}</Text>
          </View>
          {isPreview && (
            <View style={styles.notice}>
              <MaterialCommunityIcons name="information-outline" size={17} color={colors.warning} />
              <Text style={styles.noticeText}>
                {t('Preview only. Load the profile to apply it to the printer.')}
              </Text>
            </View>
          )}
          <BedMesh3D
            matrix={matrix}
            height={meshHeight}
            xRange={xRange}
            yRange={yRange}
            onInteraction={(active) => setScrollEnabled(!active)}
          />
          <Text style={styles.hint}>{t('Drag to rotate, pinch to zoom')}</Text>
        </FadeInUp>
      ) : (
        <FadeInUp delay={60}>
          <Card style={styles.emptyCard} elevated>
            <MaterialCommunityIcons name="grid-off" size={42} color={colors.subtext} />
            <Text style={styles.emptyTitle}>{t('No bed mesh data')}</Text>
            <Text style={styles.emptyText}>
              {t('No active mesh or saved profile points were found. Run a calibration to create one.')}
            </Text>
          </Card>
        </FadeInUp>
      )}

      <FadeInUp delay={100}>
        <View style={styles.actionGrid}>
          <MeshAction
            icon="radar"
            label={t('Calibrate')}
            helper="BED_MESH_CALIBRATE"
            onPress={runCalibration}
            disabled={disabled}
            primary
          />
          <MeshAction
            icon="restore"
            label={t('Show active')}
            helper={activeMatrix.length ? activeProfileName : t('No active mesh')}
            onPress={() => setSelectedProfile(null)}
            disabled={!activeMatrix.length || !selectedProfile}
          />
        </View>
      </FadeInUp>

      {profileNames.length > 0 && (
        <FadeInUp delay={140}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('Saved profiles')}</Text>
            <Text style={styles.sectionCount}>{profileNames.length}</Text>
          </View>
          <Card padded={false} style={styles.profileCard}>
            {profileNames.map((name) => {
              const active = activeProfileName === name;
              const selected = displayedProfileName === name && isPreview;
              return (
                <ProfileRow
                  key={name}
                  name={name}
                  active={active}
                  selected={selected}
                  disabled={disabled}
                  onPreview={() => setSelectedProfile(name)}
                  onLoad={() => loadProfile(name)}
                />
              );
            })}
          </Card>
        </FadeInUp>
      )}
        </ScrollView>
      </SafeAreaView>
      {alertDialog}
    </>
  );
}

function Metric({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricTop}>
        <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
        <Text style={styles.metricLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function MeshAction({
  icon,
  label,
  helper,
  onPress,
  disabled,
  primary,
}: {
  icon: IconName;
  label: string;
  helper: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const fg = primary ? '#fff' : colors.text;
  return (
    <PressableScale
      style={[styles.actionButton, primary && styles.actionPrimary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <MaterialCommunityIcons name={icon} size={22} color={fg} />
      <View style={styles.actionTextWrap}>
        <Text style={[styles.actionLabel, { color: fg }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.actionHelper, primary && { color: 'rgba(255,255,255,0.72)' }]} numberOfLines={1}>
          {helper}
        </Text>
      </View>
    </PressableScale>
  );
}

function ProfileRow({
  name,
  active,
  selected,
  disabled,
  onPreview,
  onLoad,
}: {
  name: string;
  active: boolean;
  selected: boolean;
  disabled: boolean;
  onPreview: () => void;
  onLoad: () => void;
}) {
  return (
    <View style={[styles.profileRow, selected && styles.profileRowSelected]}>
      <PressableScale style={styles.profileMain} onPress={onPreview} activeScale={0.99}>
        <View style={[styles.profileIcon, active && { backgroundColor: withAlpha(colors.primary, 0.18) }]}>
          <MaterialCommunityIcons
            name={active ? 'check-circle' : selected ? 'eye-outline' : 'database-outline'}
            size={19}
            color={active ? colors.primary : selected ? colors.warning : colors.subtext}
          />
        </View>
        <View style={styles.profileTextWrap}>
          <Text style={styles.profileNameText} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.profileMetaText} numberOfLines={1}>
            {active ? t('Active') : selected ? t('Previewing') : t('Tap to preview')}
          </Text>
        </View>
      </PressableScale>
      <PressableScale
        style={[styles.loadBtn, disabled && styles.disabled]}
        disabled={disabled}
        onPress={onLoad}
      >
        <Text style={styles.loadBtnText}>{t('Load')}</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 96,
    gap: spacing.md,
  },
  hero: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadow.card,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroTextWrap: { flex: 1, minWidth: 0 },
  heroTitle: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
  },
  heroSub: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricCard: {
    width: '48.6%',
    minHeight: 74,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricLabel: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    flex: 1,
  },
  metricValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: spacing.sm,
  },
  rangeHelp: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  sectionCount: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: '900',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: withAlpha(colors.warning, 0.12),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: withAlpha(colors.warning, 0.3),
    padding: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  noticeText: {
    flex: 1,
    color: colors.warning,
    fontSize: 12,
    fontWeight: '700',
  },
  hint: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 280,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  actionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  actionHelper: {
    color: colors.subtext,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  disabled: {
    opacity: 0.42,
  },
  profileCard: {
    overflow: 'hidden',
  },
  profileRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  profileRowSelected: {
    backgroundColor: withAlpha(colors.warning, 0.09),
  },
  profileMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  profileNameText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  profileMetaText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  loadBtn: {
    minHeight: 38,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.primary, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.35),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  loadBtnText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
});
