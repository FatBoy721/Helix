import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ThemedDialog, { DialogAction } from '../ThemedDialog';
import { colors, spacing } from '../../constants/theme';
import { downloadAndOpenApk, openUrl } from '../../services/apkInstaller';
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

type DialogIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface DialogState {
  title: string;
  message?: string;
  icon: DialogIcon;
  actions: DialogAction[];
}

function buildCommit(): string {
  const extra = Constants.expoConfig?.extra as { buildCommit?: string } | undefined;
  return normalizeBuildCommit(extra?.buildCommit);
}

export default function AboutCard() {
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const currentBuild = buildCommit();

  const closeDialog = () => setDialog(null);

  const messageDialog = (title: string, message: string, icon: DialogIcon = 'information-outline') => {
    setDialog({
      title,
      message,
      icon,
      actions: [{ text: t('OK'), variant: 'primary', onPress: closeDialog }],
    });
  };

  const installUpdate = async (downloadUrl: string, latest: string) => {
    if (downloadingUpdate) return;
    setDownloadingUpdate(true);
    try {
      await downloadAndOpenApk(downloadUrl, latest);
    } catch (e: any) {
      setDialog({
        title: t('Update download failed'),
        message: e?.message ?? 'Could not open the APK installer.',
        icon: 'alert-circle-outline',
        actions: [
          { text: t('Not now'), onPress: closeDialog },
          {
            text: t('Open in browser'),
            icon: 'open-in-new',
            variant: 'primary',
            onPress: () => {
              closeDialog();
              openUrl(downloadUrl).catch(() => {});
            },
          },
        ],
      });
    } finally {
      setDownloadingUpdate(false);
    }
  };

  const checkForUpdates = async () => {
    if (checkingUpdates || downloadingUpdate) return;
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
        messageDialog(
          t('Up to date'),
          `Helix is already on build ${latest.slice(0, 7)}.`,
          'check-circle-outline'
        );
        return;
      }

      const title = latest
        ? `${t('Update available')}: ${latest.slice(0, 7)}`
        : t('Latest APK available');
      const buildLine = currentBuild && currentBuild !== 'dev'
        ? `${t('Installed build')}: ${currentBuild.slice(0, 7)}`
        : t('Open the latest APK download?');

      setDialog({
        title,
        message: `${buildLine}\n${t('Install over existing app to keep settings.')}`,
        icon: 'download-circle-outline',
        actions: [
          { text: t('Not now'), onPress: closeDialog },
          {
            text: t('Download APK'),
            icon: 'download',
            variant: 'primary',
            onPress: () => {
              closeDialog();
              installUpdate(downloadUrl, latest);
            },
          },
        ],
      });
    } catch (e: any) {
      messageDialog(
        t('Update check failed'),
        e?.message ?? 'Could not reach GitHub releases.',
        'alert-circle-outline'
      );
    } finally {
      setCheckingUpdates(false);
    }
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('About')}</Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={checkForUpdates}
          disabled={checkingUpdates || downloadingUpdate}
        >
          <MaterialCommunityIcons name="update" size={20} color={colors.text} />
          <Text style={styles.linkText}>
            {downloadingUpdate
              ? t('Downloading update...')
              : checkingUpdates
                ? t('Checking for updates...')
                : t('Check for updates')}
          </Text>
          <MaterialCommunityIcons name="download-outline" size={16} color={colors.subtext} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={() => openUrl(REPO_URL).catch(() => {})}>
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
            ).catch(() => {})
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
      <ThemedDialog
        visible={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        icon={dialog?.icon}
        actions={dialog?.actions ?? []}
        onClose={closeDialog}
      />
    </>
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
