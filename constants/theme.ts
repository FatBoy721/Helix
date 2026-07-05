export const colors = {
  bg: '#0d0f12',
  card: '#171a1f',
  cardAlt: '#23272f',
  border: '#303640',
  text: '#f4f7fb',
  subtext: '#9aa4af',
  primary: '#2196f3',
  success: '#2ecb70',
  warning: '#f5a524',
  danger: '#ff4d4f',
  cold: '#4fb7ff',
  hot: '#ff6b6b',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

// Shared design tokens for the redesign. Add-only — existing screens keep
// using colors/spacing untouched.
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

// iOS shadow + Android elevation presets. Spread onto a surface style.
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  hero: {
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

export const typography = {
  display: { fontSize: 27, lineHeight: 31, fontWeight: '800' as const },
  title: { fontSize: 19, lineHeight: 23, fontWeight: '800' as const },
  heading: { fontSize: 15, lineHeight: 19, fontWeight: '800' as const },
  body: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '800' as const },
  mono: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const },
};

// Alpha-blend a #rrggbb hex with an opacity (0..1). Replaces the scattered
// `color + '55'` string concat and works for any accent value.
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean.slice(0, 6).padEnd(6, '0');
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, '0');
  return `#${full}${a}`;
}
