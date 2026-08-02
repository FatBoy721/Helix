package org.crabcore.u1control.slicing

/**
 * The RN Cockpit palette ([components/dashboard/shared.tsx]) mirrored for native
 * views.
 *
 * The native print preprocess sheet is a port of its RN counterpart and has to
 * match it, so it uses these tokens instead of the app-wide [HelixAppTheme]
 * ones — including the fixed accent, which the RN sheet also uses in place of
 * the user's chosen accent colour. Both preprocess dialogs then look identical
 * no matter which one a print flow reaches.
 */
object HelixCockpit {
  const val BG = 0xFF0B0D10.toInt()
  const val SURFACE = 0xFF15181D.toInt()
  const val SURFACE_ALT = 0xFF1D222A.toInt()
  const val BORDER = 0xFF252A33.toInt()
  const val TEXT = 0xFFF4F7FB.toInt()
  const val DIM = 0xFF8B95A1.toInt()
  const val ACCENT = 0xFF00D4C8.toInt()
  const val ACCENT_FILL = 0xFF00B3A9.toInt()
  const val ON_ACCENT = 0xFF00201E.toInt()
  const val SUCCESS = 0xFF31D583.toInt()
  const val WARN = 0xFFFFB020.toInt()
  const val DANGER = 0xFFFF5A5C.toInt()
  const val SCRIM = 0x9E000000.toInt()

  /** `P.radius` / `P.gap` from the RN palette. */
  const val RADIUS = 20
  const val GAP = 16

  /** RN `alpha()` — the same colour at a new opacity. */
  fun alpha(color: Int, fraction: Float): Int =
    (color and 0x00FFFFFF) or (((fraction.coerceIn(0f, 1f) * 255f).toInt()) shl 24)
}
