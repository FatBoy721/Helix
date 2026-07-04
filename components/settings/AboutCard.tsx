import React, { useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../../constants/theme';
import { t } from '../../services/i18n';
import {
  GitHubRelease,
  RELEASE_API_URL,
  REPO_URL,
  buildBugReportUrl,
  isCurrentRelease,
  normalizeBuildCommit,
  releaseCommit,
  releaseDownloadUrl,
} from '../../services/updateCheck';

function buildCommit(): string {
  const extra = Constants.expoConfig?.extra as { buildCommit?: string } | undefined;
  return normalizeBuildCommit(extra?.buildCommit);
}

function openUrl(url: string): void {
  Linking.openURL(url).catch(() => {});
}

export default function AboutCard() {
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const currentBuild = buildCommit();

  const checkForUpdates = async () => {
    if (checkingUpdates) return;
    setCheckingUpdates(true);
    try {
      const res = await fetch(RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);

      const release = (await res.json()) as GitHubRelease;
      const latest = releaseCommit(release.body);
      const downloadUrl = releaseDownloadUrl(release);

      if (isCurrentRelease(currentBuild, latest)) {
        Alert.alert(t('Up to date'), `Helix is already on build ${latest.slice(0, 7)}.`);
        return;
      }

      Alert.alert(
        latest ? `${t('Update available')}: ${latest.slice(0, 7)}` : t('Latest APK available'),
        currentBuild && currentBuild !== 'dev'
          ? `Installed build: ${currentBuild.slice(0, 7)}`
          : t('Open the latest APK download?'),
        [
          { text: t('Not now'), style: 'cancel' },
          { text: t('Download APK'), onPress: () => openUrl(downloadUrl) },
        ]
      );
    } catch (e: any) {
      Alert.alert(t('Update check failed'), e?.message ?? 'Could not reach GitHub releases.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('About')}</Text>
      <TouchableOpacity
        style={styles.linkRow}
        onPress={checkForUpdates}
        disabled={checkingUpdates}
      >
        <MaterialCommunityIcons name="update" size={20} color={colors.text} />
        <Text style={styles.linkText}>
          {checkingUpdates ? t('Checking for updates...') : t('Check for updates')}
        </Text>
        <MaterialCommunityIcons name="download-outline" size={16} color={colors.subtext} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.linkRow} onPress={() => openUrl(REPO_URL)}>
        <MaterialCommunityIcons name="github" size={20} color={colors.text} />
        <Text style={styles.linkText}>GitHub - Helix</Text>
        <MaterialCommunityIcons name="open-in-new" size={16} color={colors.subtext} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.linkRow}
        onPress={() =>
          openUrl(
            buildBugReportUrl({
              version: Constants.expoConfig?.version,
              platform: Platform.OS,
              buildCommit: currentBuild,
            })
          )
        }
      >
        <MaterialCommunityIcons name="bug-outline" size={20} color={colors.text} />
        <Text style={styles.linkText}>{t('Report a bug')}</Text>
        <MaterialCommunityIcons name="open-in-new" size={16} color={colors.subtext} />
      </TouchableOpacity>
      <Text style={styles.version}>
        Helix v{Constants.expoConfig?.version ?? '1.0.0'}
        {currentBuild && currentBuild !== 'dev' ? ` (${currentBuild.slice(0, 7)})` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  linkText: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },
  version: {
    color: colors.subtext,
    fontSize: 11,
    marginTop: spacing.sm,
  },
});
