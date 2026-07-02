import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMoonraker } from '../../hooks/useMoonraker';
import BedMesh3D from '../../components/BedMesh3D';
import { t } from '../../services/i18n';
import { colors, spacing } from '../../constants/theme';

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

export default function MeshScreen() {
  const { status, sendGcode, connection } = useMoonraker();
  const bm = status.bed_mesh ?? {};
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  // Freeze the ScrollView while the mesh is being rotated, otherwise the
  // scroll gesture eats the drag and touch controls feel broken.
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const activeMatrix: number[][] = useMemo(() => {
    const probed = bm.probed_matrix;
    if (Array.isArray(probed) && probed.length && probed[0]?.length) return probed;
    const mesh = bm.mesh_matrix;
    if (Array.isArray(mesh) && mesh.length && mesh[0]?.length) return mesh;
    return [];
  }, [bm.probed_matrix, bm.mesh_matrix]);

  const profiles: Record<string, any> = bm.profiles ?? {};
  const profileNames = Object.keys(profiles);

  // No active mesh -> preview a saved profile's points instead
  const previewName =
    selectedProfile && profiles[selectedProfile] ? selectedProfile : profileNames[0] ?? null;
  const previewMatrix: number[][] =
    !activeMatrix.length && previewName && Array.isArray(profiles[previewName]?.points)
      ? profiles[previewName].points
      : [];

  const matrix = activeMatrix.length ? activeMatrix : previewMatrix;
  const stats = useMemo(() => (matrix.length ? matrixStats(matrix) : null), [matrix]);
  const isPreview = !activeMatrix.length && matrix.length > 0;

  // real bed mm coords for the axis labels
  const mp = previewName ? profiles[previewName]?.mesh_params : null;
  const xRange: [number, number] = activeMatrix.length
    ? [bm.mesh_min?.[0] ?? 0, bm.mesh_max?.[0] ?? 270]
    : [mp?.min_x ?? 0, mp?.max_x ?? 270];
  const yRange: [number, number] = activeMatrix.length
    ? [bm.mesh_min?.[1] ?? 0, bm.mesh_max?.[1] ?? 270]
    : [mp?.min_y ?? 0, mp?.max_y ?? 270];

  const disabled = connection !== 'connected';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      scrollEnabled={scrollEnabled}
    >
      {matrix.length ? (
        <>
          <View style={styles.infoRow}>
            <Info
              label={isPreview ? t('Profile (saved)') : t('Profile')}
              value={(isPreview ? previewName : bm.profile_name) || 'default'}
            />
            <Info label={t('Range')} value={`${stats!.range.toFixed(4)} mm`} />
            <Info label={t('Min')} value={stats!.min.toFixed(4)} />
            <Info label={t('Max')} value={stats!.max.toFixed(4)} />
          </View>
          {isPreview && (
            <Text style={styles.previewNote}>
              {t('No mesh active — showing saved profile points. Load it to apply.')}
            </Text>
          )}
          <BedMesh3D
            matrix={matrix}
            xRange={xRange}
            yRange={yRange}
            onInteraction={(active) => setScrollEnabled(!active)}
          />
          <Text style={styles.hint}>{t('Drag to rotate · pinch to zoom')}</Text>
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('No bed mesh data')}</Text>
          <Text style={styles.emptyText}>
            No active mesh and no saved profiles. Run BED_MESH_CALIBRATE.
          </Text>
        </View>
      )}

      {profileNames.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('Saved profiles')}</Text>
          {profileNames.map((name) => (
            <View key={name} style={styles.profileRow}>
              <TouchableOpacity style={styles.profileName} onPress={() => setSelectedProfile(name)}>
                <Text
                  style={[
                    styles.profileNameText,
                    (isPreview ? previewName === name : bm.profile_name === name) && {
                      color: colors.primary,
                    },
                  ]}
                >
                  {name}
                  {bm.profile_name === name ? `  (${t('active')})` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.loadBtn,
                  { backgroundColor: colors.primary },
                  disabled && { opacity: 0.4 },
                ]}
                disabled={disabled}
                onPress={() => sendGcode(`BED_MESH_PROFILE LOAD=${name}`)}
              >
                <Text style={styles.loadBtnText}>{t('Load')}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.calibrateBtn, disabled && { opacity: 0.4 }]}
        disabled={disabled}
        onPress={() => sendGcode('BED_MESH_CALIBRATE')}
      >
        <Text style={styles.calibrateText}>Run BED_MESH_CALIBRATE</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  infoCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  infoLabel: {
    color: colors.subtext,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  previewNote: {
    color: colors.warning,
    fontSize: 12,
  },
  hint: {
    color: colors.subtext,
    fontSize: 11,
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.subtext,
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  profileName: { flex: 1 },
  profileNameText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  loadBtn: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  loadBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  calibrateBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  calibrateText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
});
