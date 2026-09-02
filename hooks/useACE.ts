import { useMemo } from 'react';
import { useMoonraker } from './useMoonraker';

// multiACE commands verified against decay71/multiACE v0.99.2b ace.py.
// ACE_DRY / ACE_STOP_DRYING work on both ACE Pro V1 and V2 (the A_* raw
// commands are V2-only). Indexes are zero-based.
// crabcore
export const ACE_MACROS = {
  load: (ace: number, lane: number) => `ACE_LOAD_HEAD HEAD=${lane} ACE=${ace} SLOT=${lane}`,
  unload: (_ace: number, lane: number) => `ACE_UNLOAD_HEAD HEAD=${lane}`,
  unloadAll: () => 'ACE_UNLOAD_ALL_HEADS',
  dryStart: (ace: number, temp: number, durationMin: number) =>
    `ACE_DRY ACE=${ace} TEMP=${temp} DURATION=${durationMin}`,
  dryStop: (ace: number) => `ACE_STOP_DRYING ACE=${ace}`,
  switchAce: (ace: number) => `ACE_SWITCH TARGET=${ace} AUTOLOAD=1`,
};

// The lane/unit model moved to services/aceModel.ts so the FlashForge mapping
// can be tested without React. Re-exported here so existing importers are
// unaffected.
export type { AceLane, AceUnit, HeadSource, LaneStatus } from '../services/aceModel';
import type { AceLane, AceUnit, HeadSource, LaneStatus } from '../services/aceModel';
import { useMaterialStation } from './useMaterialStation';

/** The AD5X is single-head, so there is nothing to attribute to a toolhead. */
const NO_HEAD_SOURCES: (HeadSource | null)[] = [null, null, null, null];

function parseColor(c: any): string | undefined {
  if (Array.isArray(c) && c.length >= 3) {
    const hex = c
      .slice(0, 3)
      .map((n: any) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, '0'))
      .join('');
    return '#' + hex;
  }
  if (typeof c === 'string' && c.trim()) {
    const s = c.trim();
    return s.startsWith('#') ? s : '#' + s;
  }
  return undefined;
}

function isGenericBlack(color: string | undefined, source: any): boolean {
  if (color !== '#000000') return false;
  const material = String(source?.material ?? source?.type ?? '').trim();
  const brand = String(source?.brand ?? '').trim();
  const sku = String(source?.sku ?? '').trim();
  return !material && !sku && (!brand || brand.toLowerCase() === 'generic');
}

function parseLanes(slots: any[], dryerActive: boolean): AceLane[] {
  const lanes: AceLane[] = [];
  for (let l = 0; l < 4; l++) {
    // slots[] entries carry their own index; match on it, fall back to position
    const slot = slots.find((s) => s?.index === l) ?? slots[l];
    const s = String(slot?.status ?? '').toLowerCase();
    let laneStatus: LaneStatus = 'unknown';
    if (s === 'ready' || s === 'loaded') laneStatus = 'loaded';
    else if (s === 'empty') laneStatus = 'empty';
    else if (s === 'busy' || s === 'loading' || s === 'unloading') laneStatus = 'busy';
    if (laneStatus === 'loaded' && dryerActive) laneStatus = 'drying';
    lanes.push({
      index: l,
      status: laneStatus,
      brand: slot?.brand || undefined,
      material: slot?.material || slot?.type || undefined,
      sku: slot?.sku || undefined,
      colorHex: (() => {
        const color = parseColor(slot?.color ?? slot?.rgb);
        return isGenericBlack(color, slot) ? undefined : color;
      })(),
    });
  }
  return lanes;
}

export function useACE() {
  const { status, macros, sendGcode } = useMoonraker();

  // Single "ace" Klipper object; everything lives inside it. device_count is
  // 0 in normal mode / with no hardware answering.
  const controller = status.ace;
  const deviceCount: number = typeof controller?.device_count === 'number'
    ? controller.device_count
    : 0;
  const hardwareDetected = deviceCount > 0;
  const mode: string = typeof controller?.mode === 'string' ? controller.mode : 'normal';
  const activeAceIndex: number = typeof controller?.active_device === 'number'
    ? controller.active_device
    : 0;
  const swapInProgress = controller?.swap_in_progress === true;

  const units = useMemo<AceUnit[]>(() => {
    if (!hardwareDetected) return [];

    // v0.99+: per-device state is the aces[] array. Older builds only had the
    // active device's info mirrored at the top level — keep that as fallback.
    const aces: any[] = Array.isArray(controller?.aces) && controller.aces.length > 0
      ? controller.aces
      : [{
          idx: activeAceIndex,
          connected: true,
          status: controller?.status,
          temp: controller?.temp,
          dryer_status: controller?.dryer_status,
          slots: [],
        }];

    return aces.map((raw, i) => {
      const aceIndex = typeof raw?.idx === 'number' ? raw.idx : i;
      const dryerRaw = raw?.dryer_status ?? null;
      const dryerActive =
        String(dryerRaw?.status ?? '').toLowerCase() === 'drying' || dryerRaw?.active === true;
      const slots: any[] = Array.isArray(raw?.slots) ? raw.slots : [];

      return {
        index: aceIndex + 1,
        aceIndex,
        connected: raw?.connected !== false,
        active: aceIndex === activeAceIndex,
        protocol: raw?.protocol || undefined,
        temp: typeof raw?.temp === 'number' ? raw.temp : undefined,
        humidity: typeof raw?.humidity === 'number' ? raw.humidity : undefined,
        dryer: {
          active: dryerActive,
          targetTemp: dryerRaw?.target_temp,
          remainingMin: dryerRaw?.remain_time,
        },
        lanes: parseLanes(slots, dryerActive),
      };
    });
  }, [controller, hardwareDetected, activeAceIndex]);

  // head_source: { "0": {ace_index, slot, type, color, brand} | null, ... }
  const headSources = useMemo<(HeadSource | null)[]>(() => {
    const raw = controller?.head_source;
    const out: (HeadSource | null)[] = [null, null, null, null];
    if (raw && typeof raw === 'object') {
      for (let h = 0; h < 4; h++) {
        const src = raw[String(h)];
        if (src && typeof src.ace_index === 'number') {
          out[h] = {
            aceIndex: src.ace_index,
            slot: typeof src.slot === 'number' ? src.slot : 0,
            material: src.type || undefined,
            colorHex: (() => {
              const color = parseColor(src.color);
              return isGenericBlack(color, src) ? undefined : color;
            })(),
            brand: src.brand || undefined,
          };
        }
      }
    }
    return out;
  }, [controller?.head_source]);

  const aceMacros = useMemo(() => macros.filter((m) => /ace/i.test(m)), [macros]);

  // A FlashForge material station fills the same lane UI, but its state comes
  // from the printer's own REST API rather than Klipper. The two never coexist:
  // a machine has multiACE or an IFS, so whichever reports hardware wins.
  const materialStation = useMaterialStation();
  if (materialStation.detected) {
    return {
      units: materialStation.units,
      aceMacros,
      sendGcode,
      hardwareDetected: true,
      deviceCount: materialStation.units.length,
      mode: 'material-station',
      activeAceIndex: 0,
      swapInProgress: false,
      headSources: NO_HEAD_SOURCES,
      materialStationError: materialStation.error,
      refreshMaterialStation: materialStation.refresh,
    };
  }

  return {
    units,
    aceMacros,
    sendGcode,
    hardwareDetected,
    deviceCount,
    mode,
    activeAceIndex,
    swapInProgress,
    headSources,
    materialStationError: materialStation.error,
    refreshMaterialStation: materialStation.refresh,
  };
}
