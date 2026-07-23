export const REPO_URL = 'https://github.com/FatBoy721/Helix';
export const BUG_URL = `${REPO_URL}/issues/new`;
export const RELEASE_API_URL = 'https://api.github.com/repos/FatBoy721/Helix/releases/latest';
export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`;
export const PLAY_STORE_APP_URL = 'market://details?id=org.crabcore.u1control';
export const PLAY_STORE_WEB_URL =
  'https://play.google.com/store/apps/details?id=org.crabcore.u1control';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  body?: string;
  html_url?: string;
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

export function normalizeBuildCommit(commit?: string): string {
  return (commit ?? '').trim().toLowerCase();
}

export function releaseCommit(body?: string): string {
  return body?.match(/\b[0-9a-f]{40}\b/i)?.[0]?.toLowerCase() ?? '';
}

export function isCurrentRelease(currentCommit: string, latestCommit: string): boolean {
  const current = normalizeBuildCommit(currentCommit);
  const latest = normalizeBuildCommit(latestCommit);
  return Boolean(current && latest && current !== 'dev' && current === latest);
}

function numericVersion(version?: string): number[] | null {
  const normalized = (version ?? '').trim().replace(/^v/i, '').split('-', 1)[0];
  if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) return null;
  return normalized.split('.').map(Number);
}

/**
 * Compares the installed native version with a GitHub release tag.
 * Returns -1 when an update is newer, 0 when equal, 1 when installed is newer,
 * and null when either value is not a numeric release version.
 */
export function compareReleaseVersions(
  installedVersion?: string,
  releaseTag?: string
): -1 | 0 | 1 | null {
  const installed = numericVersion(installedVersion);
  const latest = numericVersion(releaseTag);
  if (!installed || !latest) return null;

  const length = Math.max(installed.length, latest.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = installed[index] ?? 0;
    const latestPart = latest[index] ?? 0;
    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }
  return 0;
}

export function isReleaseUpdateAvailable({
  installedVersion,
  releaseTag,
  currentCommit,
  latestCommit,
}: {
  installedVersion?: string;
  releaseTag?: string;
  currentCommit?: string;
  latestCommit?: string;
}): boolean | null {
  const versionComparison = compareReleaseVersions(installedVersion, releaseTag);
  if (versionComparison !== null) return versionComparison < 0;

  const current = normalizeBuildCommit(currentCommit);
  const latest = normalizeBuildCommit(latestCommit);
  if (current && current !== 'dev' && latest && current === latest) return false;
  return null;
}

/**
 * Human-readable changelog bullets from a release body. Drops the heading,
 * the trailing commit hashes, and the `Build: <sha>` footer (that line is
 * machine data for releaseCommit, not for display).
 */
export function releaseNotes(body?: string, maxLines = Infinity): string {
  const bullets = (body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(/\s*\([0-9a-f]{7,40}\)$/i, '').trim())
    .filter(Boolean);
  if (!bullets.length) return '';
  const shown = bullets.slice(0, maxLines).map((line) => `• ${line}`);
  const hidden = bullets.length - maxLines;
  if (hidden > 0) shown.push(`• plus ${hidden} more on GitHub`);
  return shown.join('\n');
}

export function releaseDownloadUrl(release: GitHubRelease): string {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const exact = assets.find((asset) => asset.name.toLowerCase() === 'helix.apk');
  const apk = exact ?? assets.find((asset) => asset.name.toLowerCase().endsWith('.apk'));
  return apk?.browser_download_url ?? '';
}

export function buildBugReportUrl({
  version,
  platform,
  buildCommit,
}: {
  version?: string;
  platform: string;
  buildCommit?: string;
}): string {
  const commit = normalizeBuildCommit(buildCommit) || 'dev';
  const body = [
    `**App version:** ${version || '?'}`,
    `**Platform:** ${platform}`,
    `**Build:** ${commit}`,
    '',
    '**What happened:**',
    '',
    '**Steps to reproduce:**',
    '',
  ].join('\n');

  return `${BUG_URL}?title=${encodeURIComponent('[Bug] ')}&body=${encodeURIComponent(body)}`;
}
