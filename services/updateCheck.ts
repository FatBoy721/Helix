export const REPO_URL = 'https://github.com/FatBoy721/Helix';
export const BUG_URL = `${REPO_URL}/issues/new`;
export const RELEASE_API_URL = 'https://api.github.com/repos/FatBoy721/Helix/releases/latest';
export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`;

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  body?: string;
  html_url?: string;
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

/**
 * Human-readable changelog bullets from a release body. Drops the heading,
 * the trailing commit hashes, and the `Build: <sha>` footer (that line is
 * machine data for releaseCommit, not for display).
 */
export function releaseNotes(body?: string, maxLines = 8): string {
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
  return apk?.browser_download_url ?? release.html_url ?? LATEST_RELEASE_URL;
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
