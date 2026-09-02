// Per-printer Home layout.
//
// The dashboard toggles used to be one global set, so hiding the GUI card on a
// FlashForge also hid it on every Snapmaker. Each printer now keeps its own
// layout, mirroring how macroDisplay is stored per printer.
//
// The legacy global `dashboard` survives as the template new printers start
// from, so adding a machine doesn't drop someone into a bare Home screen.
// crabcore

import type { DashboardSections } from './settingsMigration';

export type { DashboardSections };

function booleanValue(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/** Fill in every section from `template`, so a new toggle defaults sanely. */
export function normalizeDashboardSections(
  raw: unknown,
  template: DashboardSections
): DashboardSections {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Partial<DashboardSections>)
    : {};

  return {
    progress: booleanValue(value.progress, template.progress),
    actions: booleanValue(value.actions, template.actions),
    estop: booleanValue(value.estop, template.estop),
    homeDock: booleanValue(value.homeDock, template.homeDock),
    controls: booleanValue(value.controls, template.controls),
    pandaBreath: booleanValue(value.pandaBreath, template.pandaBreath),
    temps: booleanValue(value.temps, template.temps),
    camera: booleanValue(value.camera, template.camera),
    gui: booleanValue(value.gui, template.gui),
    filaments: booleanValue(value.filaments, template.filaments),
    macros: booleanValue(value.macros, template.macros),
  };
}

export function normalizeDashboardByPrinter(
  raw: unknown,
  template: DashboardSections
): Record<string, DashboardSections> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: Record<string, DashboardSections> = {};
  for (const [printerId, value] of Object.entries(raw)) {
    if (!printerId || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    out[printerId] = normalizeDashboardSections(value, template);
  }
  return out;
}

/**
 * The active printer's layout. Printers that have never been customised fall
 * back to the global set, which is what they were showing before the split.
 */
export function getDashboardSections(settings: {
  activePrinterId: string;
  dashboard: DashboardSections;
  dashboardByPrinter?: Record<string, DashboardSections>;
  printers?: { id: string; kind?: string }[];
}): DashboardSections {
  const saved = settings.dashboardByPrinter?.[settings.activePrinterId];
  const sections = normalizeDashboardSections(saved, settings.dashboard);
  const activeKind = settings.printers?.find(
    (printer) => printer.id === settings.activePrinterId
  )?.kind;
  return dashboardSectionAvailable(activeKind, 'gui') ? sections : { ...sections, gui: false };
}

/** Sections that the selected printer can genuinely provide. */
export function dashboardSectionAvailable(
  printerKind: string | undefined,
  section: keyof DashboardSections
): boolean {
  return section !== 'gui' || printerKind !== 'bambu-lan';
}

export function setDashboardForPrinter(
  dashboardByPrinter: Record<string, DashboardSections>,
  printerId: string,
  next: DashboardSections,
  template: DashboardSections
): Record<string, DashboardSections> {
  return {
    ...dashboardByPrinter,
    [printerId || 'default']: normalizeDashboardSections(next, template),
  };
}
