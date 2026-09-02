// The lane/unit model the multi-material UI renders.
//
// Named for the Snapmaker ACE because that was the first hardware to use it,
// but it is now the shared shape: the FlashForge AD5X's material station maps
// into it too, so components/ACELane.tsx and app/(tabs)/ace.tsx render either
// machine without knowing which one they are looking at.
//
// These types live here rather than in hooks/useACE.ts so the pure mapping
// below can be unit-tested without pulling React in.
// crabcore

import type { MaterialStation } from './flashforgeApi';

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
  aceIndex: number; // 0-based multiACE device index (macro argument)
  connected: boolean;
  active: boolean;
  protocol?: string;
  temp?: number;
  humidity?: number;
  dryer: {
    active: boolean;
    targetTemp?: number;
    remainingMin?: number;
  };
  lanes: AceLane[];
}

// head_source entry from multiACE: which ACE/slot currently feeds a head.
export interface HeadSource {
  aceIndex: number;
  slot: number;
  material?: string;
  colorHex?: string;
  brand?: string;
}

/** The AD5X's IFS always has four slots, matching the ACE lane count. */
const IFS_LANE_COUNT = 4;

/**
 * Present a FlashForge material station as a single ACE-style unit.
 *
 * The AD5X has no dryer and no per-slot temperature/humidity, so those stay
 * empty rather than being faked. Slots the printer still remembers a filament
 * for keep that material and colour — the EMPTY status chip carries the real
 * state, which is how the ACE lanes already behave for unloaded spools.
 */
export function materialStationToAceUnits(station: MaterialStation | null): AceUnit[] {
  if (!station) return [];

  const laneCount = Math.max(
    IFS_LANE_COUNT,
    ...station.slots.map((slot) => slot.index + 1)
  );

  const lanes: AceLane[] = Array.from({ length: laneCount }, (_, index) => {
    const slot = station.slots.find((entry) => entry.index === index);
    // FlashForge omits unused slot records from some /detail replies. The IFS
    // still physically has four lanes, so an omitted lane is empty—not an
    // invitation to resurrect a saved spool from another printer.
    if (!slot) return { index, status: 'empty' as LaneStatus };

    const status: LaneStatus =
      station.loadingSlot === index ? 'busy' : slot.loaded ? 'loaded' : 'empty';

    return {
      index,
      status,
      material: slot.material || undefined,
      colorHex: slot.colorHex || undefined,
    };
  });

  return [
    {
      index: 1,
      aceIndex: 0,
      connected: true,
      active: true,
      dryer: { active: false },
      lanes,
    },
  ];
}
