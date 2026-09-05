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

/**
 * helixd, Fluidd and the webcam share the AD5X's port-80 origin. Moonraker
 * remains on 7125, so callers must keep this proxy origin separate from their
 * telemetry connection URL.
 */
export function helixdLanBaseUrl(input: string): string {
  const base = normalizeBaseUrl(input);
  if (!base) return '';

  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.port = '';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export interface HelixdStatus {
  backend_state?: unknown;
  dns_name?: unknown;
  serve_url?: unknown;
}

/** Returns an HTTPS/HTTP origin only while helixd says Tailscale is running. */
export function helixdRemoteBaseUrl(status: unknown): string {
  if (!status || typeof status !== 'object') return '';
  const value = status as HelixdStatus;
  if (value.backend_state !== 'Running' || typeof value.serve_url !== 'string') return '';

  const base = normalizeBaseUrl(value.serve_url);
  if (!base) return '';
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' || !url.hostname) return '';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Tailscale Serve fronts port 80 only. Moonraker stays directly reachable on
 * the same discovered tailnet node at 7125.
 */
export function helixdRemoteMoonrakerUrl(remoteBaseUrl: string): string {
  const base = normalizeBaseUrl(remoteBaseUrl);
  if (!base) return '';
  try {
    const url = new URL(base);
    if (!url.hostname || !isTailscaleUrl(url.toString())) return '';
    url.protocol = 'http:';
    url.port = '7125';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * null means the LAN status endpoint could not be reached. An empty string is
 * different: helixd answered, but its Tailscale backend is not usable.
 */
export async function discoverHelixdRemoteBase(
  lanUrl: string,
  timeoutMs = 4000,
): Promise<string | null> {
  const base = helixdLanBaseUrl(lanUrl);
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/status`, { signal: controller.signal });
    if (!response.ok) return null;
    return helixdRemoteBaseUrl(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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

/**
 * U1/PAXX per-print AI monitoring preference.
 *
 * Enabling explicitly arms both user-facing detectors so an earlier manual
 * firmware setting cannot leave the master switch on while spaghetti or
 * build-plate obstruction detection remains off. The residue and nozzle
 * experiments are deliberately untouched.
 */
export type AiDetectionSensitivity = 'low' | 'high';

export function buildAiMonitoringCommand(
  enabled: boolean,
  sensitivity: AiDetectionSensitivity = 'low'
): string {
  return enabled
    ? `DEFECT_DETECTION_CONFIG MAIN_ENABLE=1 CLEAN_BED_ENABLE=1 NOODLE_ENABLE=1 SENSITIVITY=${sensitivity}`
    : 'DEFECT_DETECTION_CONFIG MAIN_ENABLE=0';
}

export function printerProxyOrigin(activeBaseUrl: string): string {
  const base = normalizeBaseUrl(activeBaseUrl);
  if (!base) return '';
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    // Legacy U1 LAN connections still point directly at Moonraker :7125 while
    // their nginx camera proxy lives on port 80. Tailscale Serve is HTTPS and
    // must retain its own origin; rewriting it to HTTP silently breaks remote
    // camera and screen access.
    if (url.protocol === 'http:') url.port = '';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

// Camera paths are advertised relative to the same proxy origin used by
// Fluidd and helixd. This makes one active base work for LAN and Tailscale.
export function resolveCameraUrl(cameraUrl: string, activeBaseUrl: string): string {
  const cam = (cameraUrl || '').trim();
  if (!cam) return '';
  if (/^https?:\/\//i.test(cam)) return cam;
  const origin = printerProxyOrigin(activeBaseUrl);
  if (!origin) return '';
  try {
    return new URL(cam.startsWith('/') ? cam : `/${cam}`, `${origin}/`).toString();
  } catch {
    return '';
  }
}

// helixd (the AD5X screen/touch daemon) shares the printer host with Moonraker
// but listens on port 80 — Moonraker itself is on :7125. Derive the HTTP root
// by stripping Moonraker's port and path, so the screen endpoint follows the
// active LAN/Tailscale selection exactly like the camera does.
export function resolveScreenApiUrl(activeBaseUrl: string): string {
  return printerProxyOrigin(activeBaseUrl);
}

// The printer's own touchscreen, exposed as a webcam entry. Its WebView must
// stay MOUNTED once shown — remounting /screen/ makes the printer report
// "No Signal" — so hide it with height 0 + pointerEvents none instead.
export function isGuiWebcam(webcam: { name: string; stream_url: string }): boolean {
  return webcam.name.toLowerCase() === 'gui' || /\/screen(?:\/|$)/i.test(webcam.stream_url);
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
  target_fps?: number;
  target_fps_idle?: number;
  aspect_ratio?: string;
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

// Writes a config file to Moonraker and restarts the service ONLY when the new
// content differs from the file already on disk. Restarting Moonraker drops the
// /usr/bin/gui MQTT feed and freezes the printer's touchscreen for ~20-30s, so
// callers must avoid spurious restarts. Returns true when a restart actually
// ran (so callers can gate any post-restart settle delay on it).
export async function applyConfigIfChanged(
  base: string,
  dirPath: string,
  filename: string,
  content: string
): Promise<boolean> {
  let unchanged = false;
  try {
    const existing = await fetch(fileUrl(base, 'config', `${dirPath}/${filename}`));
    if (existing.ok) unchanged = (await existing.text()) === content;
  } catch {
    // Read failed (network/auth) — fall through to upload+restart to be safe.
  }
  if (unchanged) return false;
  await uploadConfigFile(base, dirPath, filename, content);
  await restartMoonraker(base);
  return true;
}

function filamentText(value: unknown, fallback: string, field: string): string {
  const text = String(value ?? '').trim() || fallback;
  if (/["\\\r\n]/.test(text)) {
    throw new Error(`${field} contains unsupported characters.`);
  }
  return text;
}

export function buildManualFilamentSlotCommand(
  channel: number,
  info: Record<string, unknown>,
): string {
  if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
    throw new Error('Filament channel must be between 0 and 3.');
  }

  const vendor = filamentText(info.VENDOR, 'Generic', 'Filament vendor');
  const material = filamentText(info.MAIN_TYPE, 'PLA', 'Filament material');
  const subtype = filamentText(info.SUB_TYPE, 'Basic', 'Filament subtype');
  if (!/^[A-Za-z0-9._+-]+$/.test(material)) {
    throw new Error('Filament material contains unsupported characters.');
  }

  const rawColor = Number(info.RGB_1);
  const color = Math.max(
    0,
    Math.min(0xffffff, Number.isFinite(rawColor) ? Math.trunc(rawColor) : 0xffffff),
  ).toString(16).padStart(6, '0').toUpperCase();
  const rawAlpha = Number(info.ALPHA);
  const alpha = Math.max(
    0,
    Math.min(255, Number.isFinite(rawAlpha) ? Math.trunc(rawAlpha) : 255),
  );

  return [
    'SET_PRINT_FILAMENT_CONFIG',
    `CONFIG_EXTRUDER=${channel}`,
    `VENDOR="${vendor}"`,
    `FILAMENT_TYPE=${material}`,
    `FILAMENT_SUBTYPE="${subtype}"`,
    'COLOR_NUMS=1',
    `COLORS=${color}`,
    'MULTI_MODE=0',
    `ALPHA=${alpha}`,
    'FORCE=1',
  ].join(' ');
}

export const api = {
  serverInfo: (base: string) => request(base, '/server/info'),

  restartKlippy: (base: string) =>
    request<string>(base, '/printer/restart', { method: 'POST' }, 15000),

  restartMoonraker: (base: string) =>
    request<string>(base, '/server/restart', { method: 'POST' }, 15000),

  setFilamentSlot: async (
    base: string,
    channel: number,
    info: Record<string, unknown>,
  ) => {
    const clearResult = await request<{ state?: string; message?: string }>(
      base,
      '/printer/filament_detect/set',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, info: {} }),
      },
    );
    if (clearResult?.state === 'error') {
      throw new Error(clearResult.message || 'PAXX rejected the RFID cache clear.');
    }

    return request(
      base,
      `/printer/gcode/script?script=${encodeURIComponent(buildManualFilamentSlotCommand(channel, info))}`,
      { method: 'POST' },
      60000,
    );
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
    objects: string[],
    timeoutMs?: number
  ) =>
    request<MoonrakerQueryResponse<TStatus>>(
      base,
      `/printer/objects/query?${objects.map((o) => encodeURIComponent(o)).join('&')}`,
      {},
      timeoutMs
    ),
};
