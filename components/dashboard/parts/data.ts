// Adapter shaping the live dashboard model into what the Cockpit views render.
//
// Previously also carried a canned mock path so states the printer can't be put
// into on demand (finished / error) could be previewed. That's gone — the
// sections are wired now, so everything reads live.
import { useDashboardModel, type DashboardActions, type DashboardBambu, type DashboardPandaBreath } from '../../../hooks/useDashboardModel';
import type { IconName, PrinterState } from '../shared';
import { t } from '../../../services/i18n';
import type { FlashForgeError } from '../../../services/flashforgeApi';

export interface CockpitTool {
  id: number;
  color: string;
  brand: string;
  /** Joined type + subtype, for wide surfaces. */
  material: string;
  /** Main type alone, for the narrow rail cards. */
  mainType: string;
  temp: number;
  target: number;
  active: boolean;
  empty: boolean;
  bambuTrayIndex: number | null;
  bambuChangeTemp: number;
}

export interface CockpitTemp {
  key: string;
  label: string;
  icon: IconName;
  value: number;
  target: number;
  history: number[];
}

export interface CockpitJob {
  name: string;
  progress: number;
  layerText: string;
  remaining: string;
  eta: string;
  thumbUri: string | null;
}

export interface CockpitData {
  /** True while unreachable OR still dialling — both mean "cannot send yet". */
  offline: boolean;
  /** Distinguishes "still dialling" from "not there", for labelling only. */
  connecting: boolean;
  state: PrinterState;
  paused: boolean;
  actions: DashboardActions;
  printerName: string;
  connectionLabel: string;
  online: boolean;
  errorMessage: string;
  job: CockpitJob | null;
  tools: CockpitTool[];
  materialStationError: FlashForgeError | null;
  temps: CockpitTemp[];
  macros: { label: string; icon: IconName; name: string }[];
  camera: { url: string; snapshotUrl?: string } | null;
  guiScreen: { url: string; snapshotUrl?: string } | null;
  lightOn: boolean;
  toggleLight?: () => void;
  pandaBreath: DashboardPandaBreath;
  bambu: DashboardBambu | null;
}

const TEMP_ICONS: Record<string, IconName> = {
  nozzle: 'printer-3d-nozzle-heat',
  bed: 'radiator',
  chamber: 'thermometer',
};

/** PREHEAT_PLA → "Preheat PLA". Klipper macro names are SCREAMING_SNAKE. */
function macroLabel(name: string): string {
  const words = name.replace(/_/g, ' ').toLowerCase().split(' ').filter(Boolean);
  return words
    .map((w) =>
      /^(pla|petg|abs|tpu|asa|pa|pc)$/.test(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(' ');
}

function macroIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (/preheat|heat|temp/.test(n)) return 'fire';
  if (/unload/.test(n)) return 'tray-arrow-up';
  if (/load|feed/.test(n)) return 'tray-arrow-down';
  if (/mesh|level|calib/.test(n)) return 'grid';
  if (/home|park|dock/.test(n)) return 'home';
  if (/clean|purge|wipe/.test(n)) return 'broom';
  if (/off|shutdown|cool/.test(n)) return 'power';
  return 'flash-outline';
}

export function useCockpitData(): CockpitData {
  const model = useDashboardModel();
  const connecting = model.state === 'connecting';
  // Controls stay disabled while connecting — there is no transport to send on
  // yet — but the label must not claim the printer is offline.
  const offline = model.state === 'offline' || connecting;
  // Offline still has to render something; idle is the least misleading shell.
  const state: PrinterState = offline ? 'idle' : (model.state as PrinterState);

  return {
    offline,
    connecting,
    state,
    paused: model.paused,
    actions: model.actions,
    printerName: model.printerName,
    connectionLabel: model.connectionLabel,
    online: model.online,
    errorMessage: model.errorMessage,
    job: model.job
      ? {
          name: model.job.name,
          progress: model.job.progress,
          layerText:
            model.job.layer != null && model.job.layers != null
              ? `${t('Layer')} ${model.job.layer}/${model.job.layers}`
              : '',
          remaining: model.job.remaining,
          eta: model.job.eta,
          thumbUri: model.job.thumbUri,
        }
      : null,
    tools: model.tools.map((t) => ({
      id: t.id,
      color: t.color,
      brand: t.brand,
      material: t.material,
      mainType: t.mainType,
      temp: t.temp,
      target: t.target,
      active: t.active,
      empty: t.loaded === 'empty',
      bambuTrayIndex: t.bambuTrayIndex,
      bambuChangeTemp: t.bambuChangeTemp,
    })),
    materialStationError: model.materialStationError,
    temps: model.temps.map((t) => ({
      key: t.key,
      label: t.label,
      icon: TEMP_ICONS[t.key] ?? 'thermometer',
      value: t.value,
      target: t.target,
      history: t.history,
    })),
    macros: model.macros.map((name) => ({
      name,
      label: macroLabel(name),
      icon: macroIcon(name),
    })),
    camera: model.camera,
    guiScreen: model.guiScreen,
    lightOn: model.lightOn,
    toggleLight: model.toggleLight,
    pandaBreath: model.pandaBreath,
    bambu: model.bambu,
  };
}
