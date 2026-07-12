import * as FileSystem from 'expo-file-system/legacy';
import { getMakerWorldCookies } from './nativeSlicer';

export type MakerWorldDownloadResult = {
  designId: string;
  instanceId: string;
  fileName: string;
  fileUri: string;
  sizeBytes: number;
};

const DESIGN_ID_RE = /(?:https?:\/\/)?(?:www\.)?makerworld\.com\/(?:\w+\/)?models\/(\d+)/i;

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

export function extractMakerWorldDesignId(text: string): string | null {
  return DESIGN_ID_RE.exec(text.trim())?.[1] ?? null;
}

export async function downloadMakerWorldModel(
  url: string,
  onStatus?: (message: string) => void
): Promise<MakerWorldDownloadResult> {
  const designId = extractMakerWorldDesignId(url);
  if (!designId) {
    throw new Error('That does not look like a MakerWorld model link.');
  }

  const baseDir = FileSystem.documentDirectory;
  if (!baseDir) throw new Error('App storage is unavailable.');

  const pageUrl = `https://makerworld.com/en/models/${designId}`;

  // Attach the logged-in session cookie captured by the in-app MakerWorld login
  // (stored encrypted). Without it the API returns a login/CAPTCHA wall.
  const cookie = (await getMakerWorldCookies().catch(() => null))?.cookies ?? '';
  const clientHeaders = browserHeaders(false, pageUrl, cookie);

  onStatus?.('Opening MakerWorld page...');
  try {
    await fetch(pageUrl, { headers: clientHeaders });
  } catch {
    // Best effort only. The API call below is the real gate.
  }

  await delay(600);

  onStatus?.('Resolving model profile...');
  const designApiUrl = `https://makerworld.com/api/v1/design-service/design/${designId}`;
  const designResponse = await fetch(designApiUrl, {
    headers: browserHeaders(true, pageUrl, cookie),
  });

  let instanceId = designId;
  if (designResponse.ok) {
    const json = await designResponse.text();
    const resolved = extractInstanceId(json);
    if (resolved) instanceId = resolved;
  }

  onStatus?.('Requesting 3MF download...');
  const downloadApiUrl = `https://makerworld.com/api/v1/design-service/instance/${instanceId}/f3mf?type=download`;
  const downloadResponse = await fetch(downloadApiUrl, {
    headers: browserHeaders(true, pageUrl, cookie),
  });

  if (!downloadResponse.ok) {
    const body = await safeText(downloadResponse);
    throw new Error(classifyDownloadError(downloadResponse.status, body));
  }

  const contentType = downloadResponse.headers.get('content-type') ?? '';
  const targetUri = `${baseDir}makerworld_${designId}.3mf`;
  await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {});

  if (contentType.toLowerCase().includes('json')) {
    const parsed = parseDownloadResponse(await downloadResponse.text());
    if (parsed.kind === 'error') throw new Error(parsed.message);

    onStatus?.(`Downloading ${parsed.fileName}...`);
    const file = await FileSystem.downloadAsync(parsed.url, targetUri, {
      headers: { 'User-Agent': 'HelixSliceLab/1.0 Android' },
    });
    const info = await FileSystem.getInfoAsync(file.uri);
    if (!info.exists || !info.size) throw new Error('Downloaded file is empty.');

    return {
      designId,
      instanceId,
      fileName: parsed.fileName,
      fileUri: file.uri,
      sizeBytes: info.size,
    };
  }

  onStatus?.('Downloading model file...');
  const file = await FileSystem.downloadAsync(downloadApiUrl, targetUri, {
    headers: browserHeaders(true, pageUrl, cookie),
  });
  const info = await FileSystem.getInfoAsync(file.uri);
  if (!info.exists || !info.size) throw new Error('Downloaded file is empty.');

  return {
    designId,
    instanceId,
    fileName: `makerworld_${designId}.3mf`,
    fileUri: file.uri,
    sizeBytes: info.size,
  };
}

function browserHeaders(isApi: boolean, referer: string, cookie = ''): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    'Accept-Language': 'en-US,en;q=0.9',
    DNT: '1',
    Referer: referer,
  };

  if (cookie) headers.Cookie = cookie;

  if (isApi) {
    headers.Accept = 'application/json, text/plain, */*';
    headers.Origin = 'https://makerworld.com';
    headers['Sec-Fetch-Dest'] = 'empty';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Site'] = 'same-origin';
    headers['X-BBL-Client-Type'] = 'web';
    headers['X-BBL-Client-Name'] = 'MakerWorld';
  } else {
    headers.Accept = 'text/html,application/xhtml+xml,*/*;q=0.8';
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = 'none';
    headers['Sec-Fetch-User'] = '?1';
    headers['Upgrade-Insecure-Requests'] = '1';
  }

  return headers;
}

function extractInstanceId(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { defaultInstanceId?: unknown };
    const id = Number(parsed.defaultInstanceId);
    return Number.isFinite(id) && id > 0 ? String(Math.trunc(id)) : null;
  } catch {
    return null;
  }
}

function parseDownloadResponse(json: string):
  | { kind: 'success'; fileName: string; url: string }
  | { kind: 'error'; message: string } {
  try {
    const parsed = JSON.parse(json) as { name?: unknown; url?: unknown; error?: unknown };
    if (typeof parsed.error === 'string' && typeof parsed.url !== 'string') {
      return { kind: 'error', message: parsed.error || 'MakerWorld returned an error.' };
    }
    if (typeof parsed.url !== 'string' || !parsed.url) {
      return { kind: 'error', message: 'Could not find a download URL in MakerWorld response.' };
    }
    return {
      kind: 'success',
      fileName: sanitizeFileName(typeof parsed.name === 'string' ? parsed.name : 'model.3mf'),
      url: parsed.url,
    };
  } catch {
    return { kind: 'error', message: 'Could not parse MakerWorld response.' };
  }
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return cleaned || 'model.3mf';
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

function classifyDownloadError(httpCode: number, responseBody: string): string {
  if (/captcha/i.test(responseBody)) {
    return 'MakerWorld wants CAPTCHA verification. Open the model in MakerWorld first, then share it again.';
  }
  if (/log in|unlogged|sign in/i.test(responseBody)) {
    return 'MakerWorld wants login for this model. Open/login in MakerWorld first, then share it again.';
  }
  if (httpCode === 403) return 'MakerWorld blocked the download. Login may be required.';
  if (httpCode === 429) return 'MakerWorld rate limited the request. Wait a minute and try again.';
  return `MakerWorld download failed: HTTP ${httpCode}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
