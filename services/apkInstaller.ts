import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';

const APK_MIME = 'application/vnd.android.package-archive';
const ACTION_VIEW = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type UpdateOpenResult = 'browser' | 'installer' | 'share';

export interface DownloadProgress {
  written: number;
  total: number;
}

function apkFileName(buildId?: string): string {
  const suffix = buildId?.replace(/[^a-z0-9_-]/gi, '').slice(0, 12) || 'latest';
  return `helix-${suffix}.apk`;
}

function isApkUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.apk');
  } catch {
    return url.toLowerCase().includes('.apk');
  }
}

export async function openUrl(url: string): Promise<void> {
  await Linking.openURL(url);
}

async function openAndroidInstaller(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync(ACTION_VIEW, {
    data: contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

async function shareApk(fileUri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('No installer or sharing target is available for this APK.');
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: APK_MIME,
    dialogTitle: 'Install Helix update',
  });
}

export async function downloadAndOpenApk(
  downloadUrl: string,
  buildId?: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<UpdateOpenResult> {
  if (Platform.OS !== 'android' || !isApkUrl(downloadUrl)) {
    await openUrl(downloadUrl);
    return 'browser';
  }

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('Update cache is unavailable on this device.');

  const fileUri = `${cacheDir}${apkFileName(buildId)}`;
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});

  const download = FileSystem.createDownloadResumable(
    downloadUrl,
    fileUri,
    { headers: { Accept: APK_MIME } },
    onProgress
      ? (p) => onProgress({ written: p.totalBytesWritten, total: p.totalBytesExpectedToWrite })
      : undefined
  );

  const result = await download.downloadAsync();
  if (!result) throw new Error('APK download was interrupted.');

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`APK download failed with HTTP ${result.status}.`);
  }

  try {
    await openAndroidInstaller(result.uri);
    return 'installer';
  } catch {
    await shareApk(result.uri);
    return 'share';
  }
}
