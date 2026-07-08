/** Default colours for the U1's four physical filament slots (T0–T3). */
export const DEFAULT_FILAMENT_SLOT_COLORS = [
  '#FFFFFF',
  '#161616',
  '#FF7043',
  '#2196F3',
] as const;

/** Common filament swatches — same set as the Spoolman editor. */
export const FILAMENT_COLOR_PRESETS = [
  '161616',
  'FFFFFF',
  'FB0207',
  'FF7043',
  'FFB300',
  '4CAF50',
  '2196F3',
  '0000FF',
  'AB47BC',
  'EC407A',
  '8D6E63',
  '9E9E9E',
] as const;

export function normalizeFilamentHex(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const hex = value.startsWith('#') ? value : `#${value}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return hex.toUpperCase();
}

export function normalizeFilamentSlotColors(
  raw: unknown,
  fallback: readonly string[] = DEFAULT_FILAMENT_SLOT_COLORS
): string[] {
  const src = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 4 }, (_, i) => {
    return normalizeFilamentHex(typeof src[i] === 'string' ? src[i] : null) ?? fallback[i];
  });
}
