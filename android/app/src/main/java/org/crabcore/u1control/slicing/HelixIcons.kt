package org.crabcore.u1control.slicing

import android.content.Context
import android.graphics.Typeface
import android.util.Log
import android.view.Gravity
import android.widget.TextView

/**
 * MaterialCommunityIcons glyphs for native views.
 *
 * Native screens draw the same glyphs as their RN counterparts by loading the
 * font from assets. Every helper degrades to a blank view if that ever fails, so
 * a missing font costs an icon rather than the screen.
 */
object HelixIcons {
  // Codepoints from @expo/vector-icons' MaterialCommunityIcons glyphmap.
  const val PRINTER_3D = 0xF042B
  const val PRINTER_NOZZLE = 0xF0E5B
  const val CHEVRON_DOWN = 0xF0140
  const val CHEVRON_LEFT = 0xF0141
  const val CHEVRON_RIGHT = 0xF0142
  const val CHECK = 0xF012C
  const val CLOCK = 0xF0150
  const val CALENDAR_CLOCK = 0xF00F0
  const val WEIGHT_GRAM = 0xF0D3F
  const val CHECK_CIRCLE = 0xF05E0
  const val ALERT_CIRCLE = 0xF05D6
  const val CLOSE_CIRCLE = 0xF0159
  const val ALERT = 0xF0026
  const val TUNE = 0xF1542
  const val WRENCH = 0xF0BE0
  const val PALETTE_SWATCH = 0xF08B5
  const val GRID = 0xF02C1
  const val VIDEO = 0xF0BDC
  const val HELP_CIRCLE = 0xF0625
  const val ACCESS_POINT = 0xF0002

  private const val TAG = "HelixIcons"

  /**
   * Our own copy of the font the JS side draws icons with. The bundler also ships
   * it, but release builds obfuscate resource names, so it cannot be looked up at
   * runtime — this asset is the only path that holds in every variant.
   */
  private const val ASSET_PATH = "fonts/MaterialCommunityIcons.ttf"

  @Volatile private var cached: Typeface? = null
  @Volatile private var attempted = false

  /** The glyph as text. These live in a supplementary plane — surrogate pair. */
  fun glyph(codepoint: Int): String = String(Character.toChars(codepoint))

  fun font(context: Context): Typeface? {
    cached?.let { return it }
    synchronized(this) {
      if (!attempted) {
        attempted = true
        cached = load(context)
      }
      return cached
    }
  }

  /** A centred icon view, blank when the font could not be loaded. */
  fun view(context: Context, codepoint: Int, sizeSp: Float, color: Int): TextView {
    val face = font(context)
    return TextView(context).apply {
      text = if (face == null) "" else glyph(codepoint)
      typeface = face
      textSize = sizeSp
      setTextColor(color)
      gravity = Gravity.CENTER
      includeFontPadding = false
    }
  }

  private fun load(context: Context): Typeface? = try {
    Typeface.createFromAsset(context.assets, ASSET_PATH)
  } catch (error: Throwable) {
    Log.w(TAG, "Icon font unavailable: ${error.message}")
    null
  }
}
