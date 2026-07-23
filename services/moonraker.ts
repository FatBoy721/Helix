// Moonraker REST helpers. WebSocket lives in hooks/useMoonraker.tsx.
// crabcore

export function normalizeBaseUrl(input: string): string {
  let url = (input || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url.replace(/\/+$/, '');
}

export function normalizeMoonrakerUrl(input: string): string {
  const base = normalizeBaseUrl(input);
  if (!base) return '';

  try {
    const url = new URL(base);
    if (url.protocol === 'http:' && !url.port) {
      url.port = '7125';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return base;
  }
}

export function isTailscaleUrl(input: string): boolean {
  const base = normalizeBaseUrl(input);
  if (!base) return false;

  try {
    const host = new URL(base).hostname.toLowerCase();
    return host.endsWith('.ts.net') || host.startsWith('100.');
  } catch {
    return /\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(base) || /\.ts\.net\b/i.test(base);
  }
}

export function printerConnectionUrl(printer: {
  url?: string;
  tailscaleUrl?: string;
  connectionMode?: string;
}): string {
  const lan = normalizeMoonrakerUrl(printer.url || '');
  const tailscale = normalizeMoonrakerUrl(printer.tailscaleUrl || '');

  if (printer.connectionMode === 'tailscale') return tailscale;
  if (printer.connectionMode === 'lan') return lan;
  return lan || tailscale;
}

export type PrinterConnectionValidationError = 'missing-printer-url' | 'missing-tailscale-url';

export function validatePrinterConnectionTarget(
  connectionMode: string,
  url?: string,
  tailscaleUrl?: string
): PrinterConnectionValidationError | null {
  const lan = (url || '').trim();
  const tailscale = (tailscaleUrl || '').trim();

  if (connectionMode === 'tailscale' && !tailscale) return 'missing-tailscale-url';
  if (connectionMode === 'lan' && !lan) return 'missing-printer-url';
  if (connectionMode === 'auto' && !lan && !tailscale) return 'missing-printer-url';
  return null;
}

export interface MoonrakerQueryResponse<TStatus = Record<string, unknown>> {
  status?: TStatus;
  eventtime?: number;
}

export interface MoonrakerServerConfig {
  spoolman?: {
    server?: string;
  };
  [section: string]: unknown;
}

export interface SpoolmanProxyError {
  message?: string;
  [key: string]: unknown;
}

export function wsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws') + '/websocket';
}

// camera setting can be a bare path like /webcam/webrtc, resolved against
// whichever printer host we're currently talking to. this is the whole trick
// that makes the camera follow you between LAN and tailscale without editing
// settings. heads up: camera is on port 80, moonraker is 7125.
export function resolveCameraUrl(cameraUrl: string, activeBaseUrl: string): string {
  const cam = (cameraUrl || '').trim();
  if (!cam) return '';
  if (/^https?:\/\//i.test(cam)) return cam;
  const base = normalizeBaseUrl(activeBaseUrl);
  if (!base) return '';
  const host = base.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\/.*$/, '');
  return `http://${host}${cam.startsWith('/') ? cam : '/' + cam}`;
}

export function resolveSnapshotUrl(
  snapshotUrl: string | undefined,
  streamUrl: string,
  activeBaseUrl: string
): string {
  const explicit = resolveCameraUrl(snapshotUrl || '', activeBaseUrl);
  if (explicit) return explicit;

  const stream = resolveCameraUrl(streamUrl, activeBaseUrl);
  if (!stream || /\/screen\/?($|\?)/i.test(stream)) return '';
  if (/snapshot/i.test(stream)) return stream;

  try {
    const url = new URL(stream);
    if (!url.pathname.includes('/webcam')) return '';
    url.pathname = '/webcam/snapshot.jpg';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

async function request<T = any>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
  timeoutMs = 8000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, { ...options, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const json = await res.json();
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

// Thumbnail relative_path is relative to the gcode file's own directory,
// served from the gcodes root (e.g. .thumbs/foo-300x300.png).
export function thumbnailUrl(base: string, filePath: string, relativePath: string): string {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
  const full = (dir + relativePath).split('/').map(encodeURIComponent).join('/');
  return `${base}/server/files/gcodes/${full}`;
}

export interface FileEntry {
  path: string;
  modified: number;
  size: number;
  permissions?: string;
}

export function fileUrl(base: string, root: string, path: string): string {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/server/files/${root}/${enc}`;
}

export interface WebcamInfo {
  name: string;
  enabled: boolean;
  service: string;
  stream_url: string;
  snapshot_url: string;
}

export interface HistoryJob {
  job_id: string;
  filename: string;
  status: string; // completed | cancelled | error | klippy_shutdown | interrupted | in_progress
  start_time: number;
  end_time: number | null;
  print_duration: number;
  total_duration: number;
  filament_used: number; // mm
  exists: boolean;
  metadata?: {
    size?: number;
    thumbnails?: { width: number; height: number; relative_path: string }[];
  };
}

export interface HistoryTotals {
  total_jobs: number;
  total_time: number;
  total_print_time: number;
  total_filament_used: number; // mm
  longest_job: number;
  longest_print: number;
}

// Writes a config file onto the printer through Moonraker's upload API.
// PAXX ships [include extended/moonraker/*.cfg] stock, so dropping files
// there is safe and survives firmware updates better than editing
// moonraker.conf itself. RN's FormData needs a real file URI, hence the
// temp-file dance through expo-file-system.
export async function uploadConfigFile(
  base: string,
  dirPath: string,
  filename: string,
  content: string
): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const tmp = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(tmp, content);
  const form = new FormData();
  form.append('root', 'config');
  form.append('path', dirPath);
  form.append('file', { uri: tmp, name: filename, type: 'text/plain' } as any);
  const res = await fetch(`${base}/server/files/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
}

export async function restartMoonraker(base: string): Promise<void> {
  await fetch(`${base}/server/restart`, { method: 'POST' }).catch(() => {});
}

export const api = {
  serverInfo: (base: string) => request(base, '/server/info'),

  setFilamentSlot: async (
    base: string,
    channel: number,
    info: Record<string, unknown>,
  ) => {
    const result = await request<{ state?: string; message?: string }>(
      base,
      '/printer/filament_detect/set',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, info }),
      },
    );
    if (result?.state === 'error') {
      throw new Error(result.message || 'PAXX rejected the filament update.');
    }
    return result;
  },

  listFiles: (base: string) => request<FileEntry[]>(base, '/server/files/list?root=gcodes'),

  listFilesRoot: (base: string, root: string) =>
    request<FileEntry[]>(base, `/server/files/list?root=${encodeURIComponent(root)}`),

  startPrint: (base: string, filename: string) =>
    request(base, `/printer/print/start?filename=${encodeURIComponent(filename)}`, { method: 'POST' }),

  pause: (base: string) => request(base, '/printer/print/pause', { method: 'POST' }),

  resume: (base: string) => request(base, '/printer/print/resume', { method: 'POST' }),

  cancel: (base: string) => request(base, '/printer/print/cancel', { method: 'POST' }),

  emergencyStop: (base: string) =>
    request(base, '/printer/emergency_stop', { method: 'POST' }, 3000),

  runGcode: (base: string, script: string) =>
    request(base, `/printer/gcode/script?script=${encodeURIComponent(script)}`, { method: 'POST' }, 60000),

  setMultiAceSlotOverride: async (base: string, channel: number, info: Record<string, unknown>) => {
    const url = new URL(base);
    url.port = '';
    url.pathname = '/multiace/api/slot-override';
    url.search = '';
    url.hash = '';
    const payload = {
      ace: 0,
      slot: channel,
      color: `#${Math.max(0, Math.min(0xffffff, Math.trunc(Number(info.RGB_1) || 0))).toString(16).padStart(6, '0').toUpperCase()}`,
      material: info.MAIN_TYPE || 'PLA',
      brand: info.VENDOR || 'Generic',
      subtype: info.SUB_TYPE || 'Basic',
    };
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`MultiACE returned ${response.status}`);
    return api.runGcode(base, 'MULTIACE_REFRESH_OVERRIDES');
  },

  historyList: (base: string, limit: number, start: number) =>
    request<{ count: number; jobs: HistoryJob[] }>(
      base,
      `/server/history/list?limit=${limit}&start=${start}&order=desc`
    ),

  historyTotals: (base: string) =>
    request<{ job_totals: HistoryTotals }>(base, '/server/history/totals'),

  metadata: (base: string, filename: string) =>
    request(base, `/server/files/metadata?filename=${encodeURIComponent(filename)}`),

  serverConfig: (base: string) => request<{ config?: MoonrakerServerConfig }>(base, '/server/config'),

  spoolmanStatus: (base: string) => request(base, '/server/spoolman/status'),

  spoolmanGetSpoolId: (base: string) =>
    request<{ spool_id: number | null }>(base, '/server/spoolman/spool_id'),

  spoolmanSetSpoolId: (base: string, spoolId: number | null) =>
    request<{ spool_id: number | null }>(base, '/server/spoolman/spool_id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spool_id: spoolId }),
    }),

  // moonraker proxies arbitrary Spoolman API calls so the app never needs to
  // know where the Spoolman server actually lives. spoolman uses POST to
  // create, PATCH to update, DELETE to remove (verified against 0.23).
  spoolmanProxy: (
    base: string,
    method: string,
    path: string,
    opts?: { query?: string; body?: unknown }
  ) =>
    request<{ response?: unknown; error?: SpoolmanProxyError | null }>(base, '/server/spoolman/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_method: method,
        path,
        ...(opts?.query ? { query: opts.query } : {}),
        ...(opts?.body !== undefined ? { body: opts.body } : {}),
        use_v2_response: true,
      }),
    }),

  queryObjects: <TStatus = Record<string, unknown>>(
    base: string,
    objects: string[]
  ) =>
    request<MoonrakerQueryResponse<TStatus>>(
      base,
      `/printer/objects/query?${objects.map((o) => encodeURIComponent(o)).join('&')}`
    ),
};
