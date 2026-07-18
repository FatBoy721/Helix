import React, { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ThemedDialog, { DialogAction } from '../ThemedDialog';
import { ProgressBar } from '../ui';
import { colors, spacing } from '../../constants/theme';
import { DownloadProgress, downloadAndOpenApk, openUrl } from '../../services/apkInstaller';
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
  releaseNotes,
} from '../../services/updateCheck';

type DialogIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const SUPPORT_URL = 'https://ko-fi.com/crabcore';

interface DialogState {
  title: string;
  message?: string;
  /** Scrollable changelog block rendered between the message and the buttons. */
  notes?: string;
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
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [progressVisible, setProgressVisible] = useState(true);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const lastPctRef = useRef(-1);
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
    setDownloadProgress({ written: 0, total: 0 });
    setProgressVisible(true);
    lastPctRef.current = -1;
    try {
      await downloadAndOpenApk(downloadUrl, latest, (p) => {
        // Throttle re-renders: only update when the whole percent (or MB when
        // the size is unknown) actually changes.
        const pct = p.total > 0
          ? Math.round((p.written / p.total) * 100)
          : Math.floor(p.written / (1024 * 1024));
        if (pct === lastPctRef.current) return;
        lastPctRef.current = pct;
        setDownloadProgress(p);
      });
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
      setDownloadProgress(null);
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
        notes: releaseNotes(release.body) || undefined,
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
        <TouchableOpacity style={styles.linkRow} onPress={() => openUrl(SUPPORT_URL).catch(() => {})}>
          <MaterialCommunityIcons name="coffee-outline" size={20} color={colors.text} />
          <Text style={styles.linkText}>{t('Support Helix')}</Text>
          <MaterialCommunityIcons name="open-in-new" size={16} color={colors.subtext} />
        </TouchableOpacity>
        <Text style={styles.supportNote}>
          {t('Totally optional. Helix is free and always will be, but if you want to chip in it really helps me out as a college student.')}
        </Text>
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
      >
        {dialog?.notes ? (
          <>
            <Text style={styles.notesTitle}>{t("What's changed")}</Text>
            <ScrollView style={styles.notesScroll} nestedScrollEnabled>
              <Text style={styles.notesText}>{dialog.notes}</Text>
            </ScrollView>
          </>
        ) : null}
      </ThemedDialog>
      <ThemedDialog
        visible={downloadingUpdate && progressVisible && !!downloadProgress}
        title={t('Downloading update')}
        message={t('The installer opens when the download finishes.')}
        icon="download-circle-outline"
        actions={[{ text: t('Hide'), onPress: () => setProgressVisible(false) }]}
        onClose={() => setProgressVisible(false)}
      >
        <View style={styles.progressWrap}>
          <ProgressBar
            progress={downloadProgress && downloadProgress.total > 0
              ? downloadProgress.written / downloadProgress.total
              : 0}
            color={colors.primary}
          />
          <Text style={styles.progressText}>{formatProgress(downloadProgress)}</Text>
        </View>
      </ThemedDialog>
    </>
  );
}

function formatProgress(progress: DownloadProgress | null): string {
  if (!progress) return '';
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  if (progress.total > 0) {
    const pct = Math.round((progress.written / progress.total) * 100);
    return `${pct}%  (${mb(progress.written)} / ${mb(progress.total)} MB)`;
  }
  return `${mb(progress.written)} MB`;
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
  supportNote: {
    color: colors.subtext,
    fontSize: 11,
    lineHeight: 16,
    marginLeft: 20 + spacing.sm,
  },
  notesTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  notesScroll: {
    maxHeight: 220,
    marginBottom: spacing.lg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  notesText: {
    color: colors.subtext,
    fontSize: 13,
    lineHeight: 19,
  },
  progressWrap: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  progressText: {
    color: colors.subtext,
    fontSize: 12,
    textAlign: 'center',
  },
});
