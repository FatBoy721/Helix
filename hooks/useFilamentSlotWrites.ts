// Filament slot writes — settings + printer, in one place.
//
// Extracted from app/(tabs)/index.tsx, which had four near-identical ~25-line
// callbacks that differed only in which field changed. Every one of them has to
// send the FULL slot config (vendor, type, subtype, colour) because
// api.setFilamentSlot clears the RFID cache first and then rewrites the slot —
// so omitting a field would blank it. That's the trap this hook exists to stop
// people falling into twice.
import { useCallback, useMemo } from 'react';
import { useMoonraker } from './useMoonraker';
import { useSettings } from './useSettings';
import { api, printerConnectionUrl } from '../services/moonraker';
import { setBambuFilament } from '../services/bambuMqtt';
import {
  bambuFilamentWriteLocation,
  resolveBambuFilamentEditIdentity,
} from '../services/bambuReport';
import { setFilamentSlotColors } from '../services/nativeSlicer';
import { normalizeFilamentSlotColors } from '../constants/filamentColors';

/** The full slot config as the printer wants it. */
interface EffectiveSlots {
  colors: string[];
  brands: string[];
  materials: string[];
  subtypes: string[];
}

export interface FilamentSlotWrites {
  updateColors: (next: string[], changedIndex?: number) => Promise<void>;
  updateBrands: (next: string[], changedIndex?: number) => Promise<void>;
  updateMaterials: (next: string[], changedIndex?: number) => Promise<void>;
  updateSubtypes: (next: string[], changedIndex?: number) => Promise<void>;
  updateSlot: (
    index: number,
    value: { color: string; brand: string; material: string; subtype: string }
  ) => Promise<boolean>;
}

export function useFilamentSlotWrites(onError?: (message: string) => void): FilamentSlotWrites {
  const { status, activeUrl } = useMoonraker();
  const { settings, update } = useSettings();

  const activePrinter = settings.printers.find((p) => p.id === settings.activePrinterId);
  const baseUrl = activeUrl || (activePrinter ? printerConnectionUrl(activePrinter) : '');
  const isBambu = activePrinter?.kind === 'bambu-lan';

  // Bambu has no Moonraker REST — the same edit goes out as an
  // ams_filament_setting publish. Occupancy and preset identity are separate:
  // manually configured generic spools can be present with no reported ID.
  // The external holder has no idle occupancy sensor, but Bambu explicitly
  // permits editing its virtual tray at 255/254/0.
  const pushBambu = useCallback(
    async (effective: EffectiveSlots, changedIndex?: number) => {
      const cfg = (status.print_task_config ?? {}) as Record<string, any>;
      const source = cfg.bambu_filament_source === 'external' ? 'external' : 'ams';
      const channels = source === 'external'
        ? [changedIndex ?? 0]
        : changedIndex == null
          ? effective.colors.map((_, index) => index)
          : [changedIndex];
      try {
        await Promise.all(
          channels.map((channel) => {
            const material = effective.materials[channel] || 'PLA';
            const identity = resolveBambuFilamentEditIdentity(
              source === 'external' || cfg.filament_exist?.[channel] === true,
              cfg.filament_info_idx?.[channel],
              material
            );
            if (!identity.ok && identity.reason === 'empty') {
              throw new Error('That AMS slot is empty — load a spool before editing it.');
            }
            if (!identity.ok) {
              throw new Error(`Bambu Studio has no generic ${material} preset for this filament edit.`);
            }
            const location = bambuFilamentWriteLocation(source, channel);
            return setBambuFilament({
              ...location,
              filamentId: identity.filamentId,
              type: material,
              colorRgba: `${effective.colors[channel].replace('#', '').slice(0, 6).toUpperCase()}FF`,
              nozzleTempMin: cfg.nozzle_temp_min?.[channel] || 190,
              nozzleTempMax: cfg.nozzle_temp_max?.[channel] || 240,
            });
          })
        );
        return true;
      } catch (error) {
        onError?.(error instanceof Error ? error.message : 'Helix saved the value locally.');
        return false;
      }
    },
    [onError, status]
  );

  const current = useMemo<EffectiveSlots>(
    () => ({
      colors: normalizeFilamentSlotColors(settings.filamentSlotColors),
      brands: settings.filamentSlotBrands ?? [],
      materials: settings.filamentSlotMaterials ?? [],
      subtypes: settings.filamentSlotSubtypes ?? [],
    }),
    [
      settings.filamentSlotBrands,
      settings.filamentSlotColors,
      settings.filamentSlotMaterials,
      settings.filamentSlotSubtypes,
    ]
  );

  const push = useCallback(
    async (effective: EffectiveSlots, changedIndex?: number) => {
      if (isBambu) return pushBambu(effective, changedIndex);
      if (!baseUrl) return true;
      // A single changed slot re-broadcasts only that channel; broadcasting all
      // four would churn the other slots' RFID caches for no reason.
      const channels =
        changedIndex == null ? effective.colors.map((_, index) => index) : [changedIndex];
      try {
        await Promise.all(
          channels.map((channel) =>
            api.setFilamentSlot(baseUrl, channel, {
              VENDOR: effective.brands[channel] || 'Generic',
              MAIN_TYPE: effective.materials[channel] || 'PLA',
              SUB_TYPE:
                effective.subtypes[channel] ||
                status.filament_detect?.info?.[channel]?.SUB_TYPE ||
                'Basic',
              RGB_1: parseInt(effective.colors[channel].replace('#', '').slice(0, 6), 16),
              ALPHA: 255,
            })
          )
        );
        return true;
      } catch (error) {
        onError?.(error instanceof Error ? error.message : 'Helix saved the value locally.');
        return false;
      }
    },
    [baseUrl, isBambu, onError, pushBambu, status]
  );

  const updateColors = useCallback(
    async (next: string[], changedIndex?: number) => {
      const colors = normalizeFilamentSlotColors(next);
      await update({ filamentSlotColors: colors });
      try {
        await setFilamentSlotColors(colors);
      } catch {
        // Native slicer settings are optional on platforms without the module.
      }
      await push({ ...current, colors }, changedIndex);
    },
    [current, push, update]
  );

  const updateBrands = useCallback(
    async (next: string[], changedIndex?: number) => {
      await update({ filamentSlotBrands: next });
      await push({ ...current, brands: next }, changedIndex);
    },
    [current, push, update]
  );

  const updateMaterials = useCallback(
    async (next: string[], changedIndex?: number) => {
      await update({ filamentSlotMaterials: next });
      await push({ ...current, materials: next }, changedIndex);
    },
    [current, push, update]
  );

  const updateSubtypes = useCallback(
    async (next: string[], changedIndex?: number) => {
      // Blank subtypes fall back to the existing value, then 'Basic' — the
      // printer rejects an empty SUB_TYPE.
      const subtypes = Array.from({ length: 4 }, (_, i) => {
        const value = next[i]?.trim();
        return value || current.subtypes[i] || 'Basic';
      });
      await update({ filamentSlotSubtypes: subtypes });
      await push({ ...current, subtypes }, changedIndex);
    },
    [current, push, update]
  );

  const updateSlot = useCallback(
    async (
      index: number,
      value: { color: string; brand: string; material: string; subtype: string }
    ) => {
      const effective: EffectiveSlots = {
        colors: normalizeFilamentSlotColors(
          Array.from({ length: 4 }, (_, i) => (i === index ? value.color : current.colors[i]))
        ),
        brands: Array.from(
          { length: 4 },
          (_, i) => (i === index ? value.brand : current.brands[i] || 'Generic')
        ),
        materials: Array.from(
          { length: 4 },
          (_, i) => (i === index ? value.material : current.materials[i] || 'PLA')
        ),
        subtypes: Array.from(
          { length: 4 },
          (_, i) => (i === index ? value.subtype : current.subtypes[i] || 'Basic')
        ),
      };
      await update({
        filamentSlotColors: effective.colors,
        filamentSlotBrands: effective.brands,
        filamentSlotMaterials: effective.materials,
        filamentSlotSubtypes: effective.subtypes,
      });
      try {
        await setFilamentSlotColors(effective.colors);
      } catch {
        // Native slicer settings are optional on platforms without the module.
      }
      return push(effective, index);
    },
    [current, push, update]
  );

  return { updateColors, updateBrands, updateMaterials, updateSubtypes, updateSlot };
}
