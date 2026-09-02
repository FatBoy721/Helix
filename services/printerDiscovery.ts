import * as Network from 'expo-network';

import { isGuiWebcam, type WebcamInfo } from './moonraker';
import {
  detectPrinterKind,
  printerProfile,
  type PrinterKind,
} from './printerProfiles';

const FIRST_HOST = 1;
const LAST_HOST = 254;
const SCAN_CONCURRENCY = 24;
const SCAN_PROGRESS_STEP = 8;
const PROBE_TIMEOUT_MS = 1100;
const DETAILS_TIMEOUT_MS = 1800;
// Printers on weak Wi-Fi (the FlashForge AD5X in particular) drop off for
// seconds at a time, so a single 1.1s shot per host misses them far more often
// than it finds them. A second pass costs nothing on the empty addresses,
// which fail fast with connection-refused rather than a timeout.
const PROBE_ATTEMPTS = 2;

export interface DiscoveredPrinter {
  ip: string;
  moonrakerUrl: string;
  name: string;
  serial: string | null;
  machineType: string | null;
  kind: PrinterKind;
  cameraUrl: string;
  cameraName: string | null;
}

export interface PrinterDiscoveryProgress {
  subnet: string;
  scanned: number;
  total: number;
  found: number;
}

interface ProductInfo {
  device_name?: unknown;
  machine_type?: unknown;
  serial_number?: unknown;
}

interface SystemInfoResult {
  system_info?: {
    product_info?: ProductInfo;
  };
}

interface WebcamListResult {
  webcams?: WebcamInfo[];
}

interface PrinterInfoResult {
  hostname?: unknown;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPrivateLanAddress(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function parseDiscoverySubnet(input: string): { prefix: string; cidr: string } {
  const trimmed = input.trim();
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  const host = withoutScheme.split('/')[0].replace(/:\d+$/, '');
  const withoutCidr = host.replace(/\/24$/, '');
  const parts = withoutCidr.split('.');

  if (parts.length === 3) parts.push('0');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) < 0 || Number(part) > 255)
  ) {
    throw new Error('Enter a /24 subnet such as 192.168.1.0/24.');
  }

  const ip = parts.map(Number).join('.');
  if (!isPrivateLanAddress(ip)) {
    throw new Error('Discovery only scans private LAN addresses (10.x, 172.16–31.x, or 192.168.x).');
  }

  const prefix = parts.slice(0, 3).map(Number).join('.');
  return { prefix, cidr: `${prefix}.0/24` };
}

function subnetFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    if (!isPrivateLanAddress(hostname)) return null;
    return parseDiscoverySubnet(hostname).cidr;
  } catch {
    return null;
  }
}

export async function getSuggestedDiscoverySubnet(printerUrls: string[] = []): Promise<string> {
  try {
    const ip = await Network.getIpAddressAsync();
    if (isPrivateLanAddress(ip)) return parseDiscoverySubnet(ip).cidr;
  } catch {
    // A saved LAN printer still gives us a useful fallback when Android cannot
    // expose the active Wi-Fi address (or a VPN is the main interface).
  }

  for (const url of printerUrls) {
    const subnet = subnetFromUrl(url);
    if (subnet) return subnet;
  }

  throw new Error('Could not determine this Wi-Fi subnet. Enter it manually, for example 192.168.1.0/24.');
}

async function fetchJson<T>(url: string, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    if (signal?.aborted) return null;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

// Stored camera URLs are host-relative so the stream follows the printer
// between LAN and Tailscale. resolveCameraUrl rebuilds them on port 80, so a
// stream served from any other port (the FlashForge mod runs ustreamer on
// 8080) has to keep its absolute form.
function cameraPath(url: string, printerIp: string): string {
  const trimmed = url.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const servedOnPort80 = parsed.port === '' || parsed.port === '80';
    if (parsed.hostname === printerIp && servedOnPort80) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function choosePrintCamera(webcams: WebcamInfo[], printerIp: string): {
  url: string;
  name: string | null;
} {
  const candidates = webcams.filter((webcam) => {
    const streamUrl = stringValue(webcam.stream_url);
    return webcam.enabled !== false && streamUrl && !isGuiWebcam({ name: webcam.name || '', stream_url: streamUrl });
  });
  const camera =
    candidates.find((webcam) => /camera|webcam|print/i.test(webcam.name || '')) ?? candidates[0];
  if (!camera) return { url: '', name: null };

  const streamUrl = stringValue(camera.stream_url) || stringValue(camera.snapshot_url);
  return {
    url: cameraPath(streamUrl, printerIp),
    name: stringValue(camera.name) || 'Print camera',
  };
}

async function probePrinter(ip: string, signal?: AbortSignal): Promise<DiscoveredPrinter | null> {
  // Anything answering machine/system_info is a Moonraker host, which is all
  // Helix needs to drive it. Identity only decides which profile it gets, so an
  // unrecognised Klipper machine is still listed rather than silently dropped.
  const candidates = [`http://${ip}:7125`, `http://${ip}`];

  let match: { baseUrl: string; payload: { result?: SystemInfoResult } | null } | undefined;
  for (let attempt = 0; attempt < PROBE_ATTEMPTS && !match; attempt += 1) {
    if (signal?.aborted) return null;

    const probes = await Promise.all(
      candidates.map(async (baseUrl) => ({
        baseUrl,
        payload: await fetchJson<{ result?: SystemInfoResult }>(
          `${baseUrl}/machine/system_info`,
          PROBE_TIMEOUT_MS,
          signal
        ),
      }))
    );
    match = probes.find(({ payload }) => payload?.result?.system_info != null);
  }
  if (!match) return null;

  const product = match.payload?.result?.system_info?.product_info ?? {};
  const moonrakerUrl = match.baseUrl;

  // product_info is a PAXX extension. Everything else identifies itself through
  // printer/info's hostname, so both are needed before choosing a profile.
  const [webcamPayload, infoPayload] = await Promise.all([
    fetchJson<{ result?: WebcamListResult }>(
      `${moonrakerUrl}/server/webcams/list`,
      DETAILS_TIMEOUT_MS,
      signal
    ),
    fetchJson<{ result?: PrinterInfoResult }>(
      `${moonrakerUrl}/printer/info`,
      DETAILS_TIMEOUT_MS,
      signal
    ),
  ]);

  const hostname = stringValue(infoPayload?.result?.hostname);
  const kind = detectPrinterKind({
    machineType: stringValue(product.machine_type),
    serial: stringValue(product.serial_number),
    deviceName: stringValue(product.device_name),
    hostname,
  });
  const profile = printerProfile(kind);
  const camera = choosePrintCamera(webcamPayload?.result?.webcams ?? [], ip);

  return {
    ip,
    moonrakerUrl,
    name: stringValue(product.device_name) || `${profile.label} (${ip})`,
    serial: stringValue(product.serial_number) || null,
    machineType: stringValue(product.machine_type) || profile.label,
    kind,
    cameraUrl: camera.url || profile.defaultCameraPath,
    cameraName: camera.name,
  };
}

export async function discoverPrinters(
  subnet: string,
  onProgress?: (progress: PrinterDiscoveryProgress) => void,
  signal?: AbortSignal
): Promise<DiscoveredPrinter[]> {
  const { prefix, cidr } = parseDiscoverySubnet(subnet);
  const hosts = Array.from(
    { length: LAST_HOST - FIRST_HOST + 1 },
    (_, index) => `${prefix}.${index + FIRST_HOST}`
  );
  const results: DiscoveredPrinter[] = [];
  let cursor = 0;
  let scanned = 0;
  let lastReportedScanned = -SCAN_PROGRESS_STEP;
  let lastReportedFound = 0;

  const report = (force = false) => {
    const found = results.length;
    if (
      !force &&
      found === lastReportedFound &&
      scanned - lastReportedScanned < SCAN_PROGRESS_STEP
    ) {
      return;
    }

    lastReportedScanned = scanned;
    lastReportedFound = found;
    onProgress?.({ subnet: cidr, scanned, total: hosts.length, found });
  };
  report(true);

  const worker = async () => {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= hosts.length) return;

      const printer = await probePrinter(hosts[index], signal);
      const foundBeforeProbe = results.length;
      if (printer && !results.some((result) => result.ip === printer.ip)) results.push(printer);
      scanned += 1;
      report(results.length !== foundBeforeProbe);
    }
  };

  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => worker()));
  if (!signal?.aborted) report(true);
  return results.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}
