export type MacroDisplayMode = 'all' | 'selected';

export interface MacroDisplaySettings {
  mode: MacroDisplayMode;
  selected: string[];
}

export const DEFAULT_MACRO_DISPLAY: MacroDisplaySettings = {
  mode: 'all',
  selected: [],
};

export function normalizeMacroDisplay(
  raw: Partial<MacroDisplaySettings> | undefined
): MacroDisplaySettings {
  const selected = Array.isArray(raw?.selected)
    ? [
        ...new Set(
          raw.selected
            .filter((name): name is string => typeof name === 'string')
            .map((name) => name.trim())
            .filter(Boolean)
        ),
      ]
    : [];

  return {
    mode: raw?.mode === 'selected' ? 'selected' : 'all',
    selected: selected.sort((a, b) => a.localeCompare(b)),
  };
}

export function normalizeMacroDisplayByPrinter(raw: unknown): Record<string, MacroDisplaySettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: Record<string, MacroDisplaySettings> = {};
  for (const [printerId, value] of Object.entries(raw)) {
    if (!printerId || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    out[printerId] = normalizeMacroDisplay(value as Partial<MacroDisplaySettings>);
  }
  return out;
}

export function getMacroDisplay(settings: {
  activePrinterId: string;
  macroDisplayByPrinter: Record<string, MacroDisplaySettings>;
}): MacroDisplaySettings {
  return normalizeMacroDisplay(settings.macroDisplayByPrinter?.[settings.activePrinterId]);
}

export function setMacroDisplayForPrinter(
  macroDisplayByPrinter: Record<string, MacroDisplaySettings>,
  printerId: string,
  next: MacroDisplaySettings
): Record<string, MacroDisplaySettings> {
  return {
    ...macroDisplayByPrinter,
    [printerId || 'default']: normalizeMacroDisplay(next),
  };
}

export function toggleMacroInDisplay(
  display: MacroDisplaySettings,
  macroName: string
): MacroDisplaySettings {
  const selected = new Set(display.selected);
  if (selected.has(macroName)) {
    selected.delete(macroName);
  } else {
    selected.add(macroName);
  }

  return normalizeMacroDisplay({
    mode: 'selected',
    selected: [...selected],
  });
}

export function filterMacrosForDisplay(
  macros: string[],
  display: MacroDisplaySettings
): string[] {
  if (display.mode !== 'selected') return macros;
  const selected = new Set(display.selected);
  return macros.filter((name) => selected.has(name));
}

export function countSelectedMacros(macros: string[], display: MacroDisplaySettings): number {
  if (!macros.length) return display.selected.length;
  const selected = new Set(display.selected);
  return macros.filter((name) => selected.has(name)).length;
}
