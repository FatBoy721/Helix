// Bundled filament temperature floor, derived from the U1 firmware's
// id_material.json (openrfid tigertag database). Brand-agnostic safe nozzle/bed
// ranges for every MAIN_TYPE the editor exposes. Used by the slicer profile
// resolver so a manual PEEK entry slices at ~400C instead of the old PLA 220C
// fallback. Target leans hot (min + 70% of range) to match the prior fallbacks.

export type FilamentTempRange = {
  nozzleMin: number;
  nozzleMax: number;
  target: number;
  bedMin: number;
  bedMax: number;
};

export const FILAMENT_TEMP_CATALOG: Readonly<Record<string, FilamentTempRange>> = {
  'ABS': { nozzleMin: 240, nozzleMax: 290, target: 275, bedMin: 85, bedMax: 90 },
  'ASA': { nozzleMin: 240, nozzleMax: 280, target: 268, bedMin: 90, bedMax: 110 },
  'BVOH': { nozzleMin: 190, nozzleMax: 240, target: 225, bedMin: 55, bedMax: 60 },
  'EVA': { nozzleMin: 175, nozzleMax: 220, target: 206, bedMin: 55, bedMax: 60 },
  'HIPS': { nozzleMin: 220, nozzleMax: 270, target: 255, bedMin: 90, bedMax: 95 },
  'PA': { nozzleMin: 240, nozzleMax: 300, target: 282, bedMin: 40, bedMax: 105 },
  'PA12': { nozzleMin: 250, nozzleMax: 300, target: 285, bedMin: 40, bedMax: 90 },
  'PA6': { nozzleMin: 240, nozzleMax: 300, target: 282, bedMin: 40, bedMax: 105 },
  'PAHT': { nozzleMin: 260, nozzleMax: 300, target: 288, bedMin: 100, bedMax: 105 },
  'PBT': { nozzleMin: 235, nozzleMax: 245, target: 242, bedMin: 0, bedMax: 0 },
  'PC': { nozzleMin: 240, nozzleMax: 290, target: 275, bedMin: 90, bedMax: 130 },
  'PCPTFE': { nozzleMin: 235, nozzleMax: 245, target: 242, bedMin: 50, bedMax: 55 },
  'PCTG': { nozzleMin: 240, nozzleMax: 270, target: 261, bedMin: 70, bedMax: 75 },
  'PE': { nozzleMin: 175, nozzleMax: 220, target: 206, bedMin: 55, bedMax: 60 },
  'PEBA': { nozzleMin: 225, nozzleMax: 250, target: 242, bedMin: 95, bedMax: 100 },
  'PEEK': { nozzleMin: 390, nozzleMax: 410, target: 404, bedMin: 130, bedMax: 145 },
  'PEI-1010': { nozzleMin: 370, nozzleMax: 430, target: 412, bedMin: 80, bedMax: 160 },
  'PEKK': { nozzleMin: 380, nozzleMax: 440, target: 422, bedMin: 120, bedMax: 140 },
  'PET': { nozzleMin: 220, nozzleMax: 300, target: 276, bedMin: 65, bedMax: 95 },
  'PETG': { nozzleMin: 220, nozzleMax: 270, target: 255, bedMin: 65, bedMax: 80 },
  'PHA': { nozzleMin: 190, nozzleMax: 240, target: 225, bedMin: 55, bedMax: 60 },
  'PLA': { nozzleMin: 190, nozzleMax: 260, target: 239, bedMin: 45, bedMax: 55 },
  'PMMA': { nozzleMin: 240, nozzleMax: 265, target: 258, bedMin: 100, bedMax: 110 },
  'POM': { nozzleMin: 230, nozzleMax: 250, target: 244, bedMin: 90, bedMax: 110 },
  'PP': { nozzleMin: 220, nozzleMax: 250, target: 241, bedMin: 55, bedMax: 60 },
  'PPA': { nozzleMin: 280, nozzleMax: 320, target: 308, bedMin: 100, bedMax: 105 },
  'PPS': { nozzleMin: 300, nozzleMax: 340, target: 328, bedMin: 110, bedMax: 115 },
  'PPSU': { nozzleMin: 360, nozzleMax: 400, target: 388, bedMin: 140, bedMax: 170 },
  'PS': { nozzleMin: 220, nozzleMax: 260, target: 248, bedMin: 60, bedMax: 100 },
  'PSU': { nozzleMin: 360, nozzleMax: 400, target: 388, bedMin: 140, bedMax: 160 },
  'PVA': { nozzleMin: 190, nozzleMax: 240, target: 225, bedMin: 30, bedMax: 60 },
  'PVB': { nozzleMin: 205, nozzleMax: 225, target: 219, bedMin: 30, bedMax: 70 },
  'PVC': { nozzleMin: 215, nozzleMax: 230, target: 226, bedMin: 80, bedMax: 85 },
  'PVDF': { nozzleMin: 240, nozzleMax: 265, target: 258, bedMin: 90, bedMax: 110 },
  'SBC': { nozzleMin: 220, nozzleMax: 260, target: 248, bedMin: 65, bedMax: 70 },
  'SBS': { nozzleMin: 195, nozzleMax: 250, target: 234, bedMin: 0, bedMax: 55 },
  'SEBS': { nozzleMin: 245, nozzleMax: 260, target: 256, bedMin: 70, bedMax: 80 },
  'TPC': { nozzleMin: 220, nozzleMax: 245, target: 238, bedMin: 60, bedMax: 90 },
  'TPE': { nozzleMin: 210, nozzleMax: 260, target: 245, bedMin: 45, bedMax: 60 },
  'TPI': { nozzleMin: 360, nozzleMax: 390, target: 381, bedMin: 0, bedMax: 0 },
  'TPS': { nozzleMin: 280, nozzleMax: 290, target: 287, bedMin: 70, bedMax: 90 },
  'TPU': { nozzleMin: 200, nozzleMax: 250, target: 235, bedMin: 35, bedMax: 40 },
};

export const FALLBACK_NOZZLE_TEMP = 220;

export function filamentTempRange(mainType: string): FilamentTempRange | null {
  const key = (mainType || '').trim().toUpperCase();
  return FILAMENT_TEMP_CATALOG[key] ?? null;
}

export function filamentTempTarget(mainType: string): number {
  return filamentTempRange(mainType)?.target ?? FALLBACK_NOZZLE_TEMP;
}
