import { useMemo } from 'react';
import { useMoonraker } from './useMoonraker';

// actual multiACE commands, pulled from the printer's own gcode help
// (curl http://printer:7125/printer/gcode/help and grep for ACE).
// every forum post says ACE_LOAD_FILAMENT — that command does not exist,
// at least not on this firmware. these do. 0-based indexes everywhere.
// lane N feeds head N by default, run ACE_HEAD_STATUS in console to see
// the live mapping if you've messed with it.
export const ACE_MACROS = {
  load: (ace: number, lane: number) => `ACE_LOAD_HEAD HEAD=${lane} ACE=${ace} SLOT=${lane}`,
  unload: (_ace: number, lane: number) => `ACE_UNLOAD_HEAD HEAD=${lane}`,
  unloadAll: () => 'ACE_UNLOAD_ALL_HEADS',
  dryStart: (ace: number, temp: number, durationMin: number) =>
    `A_DRY ACE=${ace} TEMP=${temp} DURATION=${durationMin}`,
  dryStop: (ace: number) => `A_DRYSTOP ACE=${ace}`,
  switchAce: (ace: number) => `ACE_SWITCH TARGET=${ace} AUTOLOAD=1`,
};

export type LaneStatus = 'loaded' | 'empty' | 'busy' | 'drying' | 'unknown';

export interface AceLane {
  index: number;
  status: LaneStatus;
  brand?: string;
  material?: string;
  sku?: string;
  colorHex?: string;
}

export interface AceUnit {
  index: number; // 1-based
  key?: string; // klipper object key, if detected
  connected: boolean;
  temp?: number;
  dryer: {
    active: boolean;
    targetTemp?: number;
    remainingMin?: number;
  };
  lanes: AceLane[];
}

// on this firmware there's exactly one klipper object called "ace" (the
// multiACE controller). that object exists as soon as the module loads in
// your printer.cfg — regardless of whether you actually have an ACE box
// plugged in. device_count is the field that tells you if real hardware
// answered. learned this the hard way: was reading !!raw as "connected"
// which lied and showed a fake green dot with 0 units physically attached.

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

export function useACE() {
  const { status, macros, sendGcode } = useMoonraker();

  // controller object is present whenever the multiACE module is loaded;
  // deviceCount is the only honest signal that hardware actually answered.
  const controller = status.ace;
  const deviceCount: number = typeof controller?.device_count === 'number'
    ? controller.device_count
    : 0;
  const hardwareDetected = deviceCount > 0;

  const units = useMemo<AceUnit[]>(() => {
    if (!hardwareDetected) return [];

    const aceKeys = Object.keys(status)
      .filter((k) => k === 'ace' || /^ace[\s_\d]/i.test(k))
      .sort();
    const count = Math.max(deviceCount, 1);

    const result: AceUnit[] = [];
    for (let i = 0; i < count; i++) {
      // multi-unit installs may expose separate "ace0"/"ace1" keys; single-unit
      // ones just have "ace" with device_count telling us how many are wired in
      const raw = aceKeys[i] ? status[aceKeys[i]] : aceKeys[0] ? status[aceKeys[0]] : null;
      const dryerRaw = raw?.dryer_status ?? raw?.dryer ?? null;
      const dryerActive =
        String(dryerRaw?.status ?? '').toLowerCase() === 'drying' || dryerRaw?.active === true;
      const slots: any[] = Array.isArray(raw?.slots)
        ? raw.slots
        : Array.isArray(raw?.lanes)
          ? raw.lanes
          : [];

      const lanes: AceLane[] = [];
      for (let l = 0; l < 4; l++) {
        const slot = slots[l];
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
          material: slot?.type || slot?.material || undefined,
          sku: slot?.sku || undefined,
          colorHex: parseColor(slot?.color ?? slot?.rgb),
        });
      }

      result.push({
        index: i + 1,
        key: aceKeys[i],
        connected: !!raw,
        temp: typeof raw?.temp === 'number' ? raw.temp : dryerRaw?.temperature,
        dryer: {
          active: dryerActive,
          targetTemp: dryerRaw?.target_temp,
          remainingMin: dryerRaw?.remain_time,
        },
        lanes,
      });
    }
    return result;
  }, [status, hardwareDetected, deviceCount]);

  const aceMacros = useMemo(() => macros.filter((m) => /ace/i.test(m)), [macros]);

  return { units, aceMacros, sendGcode, hardwareDetected, deviceCount };
}
