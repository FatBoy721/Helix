// Cockpit values behind the old theme's token names.
//
// AboutCard, BackupCard and MacroDisplayCard are ~850 lines that reference
// `colors.card`, `colors.subtext` and friends throughout. Now that Settings is
// Cockpit, those three would be the only old-theme surfaces left in the app —
// but rewriting every style rule to chase a palette swap is a lot of churn for
// no behaviour change, and every touched line is a chance to break something.
//
// Instead they import these tokens: same names, Cockpit values. Each card
// changes by exactly one line.
//
// This is a migration shim, not a pattern. New settings UI should import
// COCKPIT from components/dashboard/shared directly.
import { COCKPIT as P } from '../dashboard/shared';

export const colors = {
  bg: P.bg,
  card: P.surface,
  cardAlt: P.surfaceAlt,
  border: P.border,
  text: P.text,
  subtext: P.dim,
  primary: P.accent,
  success: P.success,
  warning: P.warn,
  danger: P.danger,
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
