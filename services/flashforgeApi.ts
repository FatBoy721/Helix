// FlashForge's own REST API (port 8898), used only for what Moonraker cannot
// answer. On a Klipper-modded AD5X the material station (IFS) stays owned by
// the stock firmware: Klipper exposes a single head filament sensor and no
// per-slot state at all, so slot colours/materials have to come from here.
//
// Everything else Helix does — control, temps, files, camera, history — still
// goes over Moonraker. This is a supplement, not a second driver.
//
// Shapes verified against Parallel-7/FlashForgeEmulator in AD5X mode.
// crabcore

import { isTailscaleUrl, normalizeBaseUrl, printerProxyOrigin } from './moonraker';

/** FlashForge's REST API always listens here, independent of Moonraker's 7125. */
export const FLASHFORGE_API_PORT = 8898;

const DETAIL_TIMEOUT_MS = 4000;

/** Credentials the printer requires on every call. `checkCode` is shown on the
 * printer as "Printer ID" under Settings → Network, and lives in its config as
 * `lanCode`. Treat it as a secret: it grants full control of the machine. */
export interface FlashForgeCredentials {
  serialNumber: string;
  checkCode: string;
}

export interface MaterialSlot {
  /** Zero-based, so it lines up with Helix's filament-slot arrays. The wire
   * format numbers slots from 1. */
  index: number;
  loaded: boolean;
  /**
   * Empty when unknown. Note the printer remembers the last filament for a
   * slot, so an unloaded slot can still report a material and colour — check
   * `loaded` before presenting these as what is actually in the machine.
   */
  material: string;
  /** `#rrggbb`, or empty when the printer has no colour for the slot. */
  colorHex: string;
}

export interface MaterialStation {
  slots: MaterialSlot[];
  /** Zero-based active slot, or null when nothing is selected. */
  activeSlot: number | null;
  /** Zero-based slot currently being loaded, or null when idle. */
  loadingSlot: number | null;
}

export type FlashForgeError =
  | 'missing-credentials'
  | 'unreachable'
  | 'auth-failed'
  | 'bad-response'
  | 'no-material-station';

export type FlashForgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FlashForgeError };

/**
 * Where to reach FlashForge's REST API for a printer we are connected to.
 *
 * On the LAN that is just a port swap. Over Tailscale it CANNOT be: the stock
 * daemon binds the LAN address only — `192.168.1.83:8898 LISTEN`, with
 * 127.0.0.1:8898 refusing — so it is invisible on the tailnet, while Moonraker
 * binds 0.0.0.0 and stays reachable. That asymmetry is why remote printer
 * control worked while the IFS slots never registered. helixd is reachable
 * remotely and proxies the API at /api/ff, so use that when off-LAN.
 *
 * LAN deliberately keeps the direct port swap: it needs no helixd, so a printer
 * without the mod still reports its material station.
 */
export function flashforgeApiUrl(printerUrl: string): string {
  const base = normalizeBaseUrl(printerUrl);
  if (!base) return '';

  if (isTailscaleUrl(base)) {
    const origin = printerProxyOrigin(base);
    return origin ? `${origin}/api/ff` : '';
  }

  try {
    const url = new URL(base);
    url.port = String(FLASHFORGE_API_PORT);
    url.pathname = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function hasFlashForgeCredentials(
  credentials: Partial<FlashForgeCredentials> | undefined
): boolean {
  return Boolean(credentials?.serialNumber?.trim() && credentials?.checkCode?.trim());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Firmware writes "?" into a slot it knows nothing about — the same sentinel
 * the stock config uses for `ffmType0`. The emulator leaves those blank, so
 * only real hardware shows this; without it the UI renders a literal "?".
 */
export function normalizeSlotMaterial(value: unknown): string {
  const raw = text(value);
  return raw === '?' ? '' : raw;
}

/** Normalize `#RGB`/`RRGGBB`/`#RRGGBB` to `#rrggbb`; anything else is dropped. */
export function normalizeSlotColor(value: unknown): string {
  const raw = text(value).replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.toLowerCase().split('').map((c) => c + c).join('')}`;
  }
  return '';
}

/**
 * Convert the wire `matlStationInfo` into Helix's zero-based view.
 * Exported for tests and so callers can parse a payload they already hold.
 */
export function parseMaterialStation(detail: unknown): MaterialStation | null {
  if (!detail || typeof detail !== 'object') return null;
  const record = detail as Record<string, unknown>;

  // Printers without an IFS report hasMatlStation:false and omit the block.
  if (record.hasMatlStation === false) return null;

  const info = record.matlStationInfo;
  if (!info || typeof info !== 'object') return null;
  const station = info as Record<string, unknown>;

  const rawSlots = Array.isArray(station.slotInfos) ? station.slotInfos : [];
  const slots: MaterialSlot[] = [];

  rawSlots.forEach((entry, position) => {
    const slot = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    // slotId is 1-based on the wire; fall back to position when absent.
    const slotId = typeof slot.slotId === 'number' ? slot.slotId : position + 1;
    const index = slotId - 1;
    if (index < 0) return;

    slots.push({
      index,
      loaded: slot.hasFilament === true,
      material: normalizeSlotMaterial(slot.materialName),
      colorHex: normalizeSlotColor(slot.materialColor),
    });
  });

  slots.sort((a, b) => a.index - b.index);

  // Both are 1-based, and 0 is the sentinel for "none".
  const oneBased = (value: unknown): number | null =>
    typeof value === 'number' && value > 0 ? value - 1 : null;

  return {
    slots,
    activeSlot: oneBased(station.currentSlot),
    loadingSlot: oneBased(station.currentLoadSlot),
  };
}

async function postDetail(
  apiUrl: string,
  credentials: FlashForgeCredentials,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<FlashForgeResult<Record<string, unknown>>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${apiUrl}/detail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serialNumber: credentials.serialNumber.trim(),
        checkCode: credentials.checkCode.trim(),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: 'unreachable' };

    const payload = (await response.json()) as Record<string, unknown>;
    // The API answers 200 for auth failures and signals them in the envelope.
    if (payload?.code !== 0) {
      return { ok: false, error: payload?.code === 1 ? 'auth-failed' : 'bad-response' };
    }

    const detail = payload.detail;
    if (!detail || typeof detail !== 'object') return { ok: false, error: 'bad-response' };
    return { ok: true, value: detail as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Fetch the material station for a printer, given its Moonraker URL. */
export async function fetchMaterialStation(
  printerUrl: string,
  credentials: Partial<FlashForgeCredentials> | undefined,
  signal?: AbortSignal,
  timeoutMs: number = DETAIL_TIMEOUT_MS
): Promise<FlashForgeResult<MaterialStation>> {
  if (!hasFlashForgeCredentials(credentials)) {
    return { ok: false, error: 'missing-credentials' };
  }

  const apiUrl = flashforgeApiUrl(printerUrl);
  if (!apiUrl) return { ok: false, error: 'unreachable' };

  const detail = await postDetail(
    apiUrl,
    credentials as FlashForgeCredentials,
    timeoutMs,
    signal
  );
  if (!detail.ok) return detail;

  const station = parseMaterialStation(detail.value);
  if (!station) return { ok: false, error: 'no-material-station' };
  return { ok: true, value: station };
}
