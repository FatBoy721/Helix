// Print preprocess — routing and preflight checks for the Ticket dialog.
//
// Auto-routing exists because identity mapping alone blocks healthy setups:
// spools in lanes 1 and 3 with a file wanting tools 1 and 2 is printable, and
// demanding the user hand-fix it is the app refusing arithmetic it can do.
// Blocking is reserved for genuinely unsatisfiable jobs — fewer usable lanes
// than the file needs.
import type { IconName } from '../components/dashboard/shared';

export type PrintPref = 'flowCal' | 'timelapse' | 'autoLevel';

export type PreprocessLaneStatus = 'loaded' | 'empty' | 'busy' | 'unknown';

/** Minimal lane shape both FilamentSlotDisplay and ResolvedFilamentSlot satisfy. */
export type PreprocessLane = {
  index: number;
  color: string;
  brand?: string;
  material: string;
  mainType?: string;
  subType?: string;
  status: PreprocessLaneStatus;
};

export type RouteSource = 'identity' | 'auto' | 'manual';

export type PreprocessTool = {
  fileTool: number;
  assigned: number;
  grams: number;
  lane: PreprocessLane;
  source: RouteSource;
};

export type CheckTone = 'pass' | 'warn' | 'fail' | 'unknown';

export type PreprocessCheck = {
  key: string;
  label: string;
  detail: string;
  tone: CheckTone;
  icon: IconName;
  blocking: boolean;
  fix?: 'printer' | 'filament' | 'options';
};

/** A lane that can feed a print. `unknown` counts — refusing on no evidence is worse. */
function usableLane(lane: PreprocessLane | undefined): boolean {
  return lane != null && lane.status !== 'empty';
}

/**
 * Works out which lane feeds each tool.
 *
 * Manual choices are reserved first. A tool then feeds from its own lane when
 * that lane has filament; otherwise it takes the next usable lane nothing else
 * has claimed.
 */
export function routeTools(
  required: number[],
  lanes: PreprocessLane[],
  manual: Record<number, number> = {},
): Record<number, { lane: number; source: RouteSource }> {
  const out: Record<number, { lane: number; source: RouteSource }> = {};
  const taken = new Set<number>();

  for (const tool of required) {
    const picked = manual[tool];
    if (picked != null && lanes[picked]) {
      out[tool] = { lane: picked, source: 'manual' };
      taken.add(picked);
    }
  }

  for (const tool of required) {
    if (out[tool]) continue;

    if (!taken.has(tool) && usableLane(lanes[tool])) {
      out[tool] = { lane: tool, source: 'identity' };
      taken.add(tool);
      continue;
    }

    const spare = lanes.find((lane) => usableLane(lane) && !taken.has(lane.index));
    if (spare) {
      out[tool] = { lane: spare.index, source: 'auto' };
      taken.add(spare.index);
    } else {
      out[tool] = { lane: tool, source: 'identity' };
    }
  }

  return out;
}

/** Builds the tools list the Ticket dialog renders. */
export function buildPreprocessTools(
  required: number[],
  lanes: PreprocessLane[],
  manual: Record<number, number>,
  perToolGrams: number[],
): PreprocessTool[] {
  const routing = routeTools(required, lanes, manual);
  return required.map((fileTool) => {
    const route = routing[fileTool];
    const lane = lanes[route.lane] ?? lanes[fileTool] ?? {
      index: route.lane,
      color: '#888888',
      material: 'PLA',
      status: 'empty' as const,
    };
    return {
      fileTool,
      assigned: route.lane,
      grams: Number(perToolGrams[fileTool]) || 0,
      lane,
      source: route.source,
    };
  });
}

export function buildPreprocessChecks(input: {
  connected: boolean;
  printerBusy: boolean;
  printerName: string;
  tools: PreprocessTool[];
  lanes: PreprocessLane[];
}): PreprocessCheck[] {
  const { connected, printerBusy, printerName, tools } = input;
  const starved = tools.filter((tool) => tool.lane.status === 'empty');
  const loadedCount = input.lanes.filter((lane) => lane.status === 'loaded').length;
  const rerouted = tools.filter((tool) => tool.source === 'auto');

  const filament: PreprocessCheck =
    starved.length > 0
      ? {
          key: 'filament',
          label: 'Filament loaded',
          detail: `This file needs ${tools.length} materials and only ${loadedCount} ${
            loadedCount === 1 ? 'lane has' : 'lanes have'
          } filament`,
          tone: 'fail',
          icon: 'palette-swatch',
          blocking: true,
          fix: 'filament',
        }
      : rerouted.length > 0
        ? {
            key: 'filament',
            label: 'Filament routed',
            detail: rerouted
              .map((tool) => `T${tool.fileTool} to lane ${tool.assigned + 1}`)
              .join(', ')
              .concat(' — your own lanes were empty'),
            tone: 'pass',
            icon: 'palette-swatch',
            blocking: true,
            fix: 'filament',
          }
        : {
            key: 'filament',
            label: 'Filament loaded',
            detail: `${tools.length} of ${input.lanes.length} lanes feed this print`,
            tone: 'pass',
            icon: 'palette-swatch',
            blocking: true,
            fix: 'filament',
          };

  return [
    {
      key: 'connection',
      label: 'Printer reachable',
      detail: connected ? `${printerName} responded` : 'Not connected — cannot upload the file',
      tone: connected ? 'pass' : 'fail',
      icon: 'access-point-network',
      blocking: true,
      fix: 'printer',
    },
    {
      key: 'state',
      label: 'Printer free',
      detail: printerBusy ? 'A print is already running' : 'Idle and accepting jobs',
      tone: printerBusy ? 'fail' : 'pass',
      icon: 'printer-3d',
      blocking: true,
      fix: 'printer',
    },
    filament,
  ];
}

/** Clock time the print would finish — "4:12 PM" beats doing the arithmetic. */
export function finishClock(seconds: number): string {
  const done = new Date(Date.now() + Math.max(0, seconds) * 1000);
  const time = done.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((done.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return time;
  return days === 1 ? `${time} tomorrow` : `${time} +${days}d`;
}

export function laneLabel(lane: PreprocessLane): string {
  if (lane.status === 'empty') return 'Empty';
  return lane.mainType || lane.material || 'PLA';
}

export function laneDetail(lane: PreprocessLane): string {
  if (lane.status === 'empty') return 'No spool loaded';
  return [lane.subType, lane.brand].filter(Boolean).join(' · ') || 'Loaded';
}

export const PREF_COPY: {
  key: PrintPref;
  label: string;
  hint: string;
  icon: IconName;
}[] = [
  {
    key: 'autoLevel',
    label: 'Auto leveling',
    hint: 'Probe the bed before the first layer',
    icon: 'grid',
  },
  {
    key: 'flowCal',
    label: 'Flow calibration',
    hint: 'Calibrate extrusion on the way in',
    icon: 'tune-variant',
  },
  {
    key: 'timelapse',
    label: 'Time-lapse',
    hint: 'Capture a frame every layer',
    icon: 'video-outline',
  },
];
