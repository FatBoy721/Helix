package org.crabcore.u1control.slicing

import android.content.Context
import android.graphics.Color

/**
 * User-declared colours for the U1's four physical filament slots (T0–T3).
 * Stored in app prefs so paint/preview work without an ACE box or printer link.
 */
object FilamentSlotColors {
  private const val PREFS = "helix_filament_slots"
  private val DEFAULTS = listOf("#FFFFFF", "#161616", "#FF7043", "#2196F3")

  val presets = listOf(
    "161616", "FFFFFF", "FB0207", "FF7043", "FFB300", "4CAF50",
    "2196F3", "0000FF", "AB47BC", "EC407A", "8D6E63", "9E9E9E",
  )

  fun read(context: Context): List<String> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return (0 until 4).map { i ->
      normalizeHex(prefs.getString("slot$i", null)) ?: DEFAULTS[i]
    }
  }

  fun write(context: Context, colors: List<String>) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val editor = prefs.edit()
    for (i in 0 until 4) {
      editor.putString("slot$i", normalizeHex(colors.getOrNull(i)) ?: DEFAULTS[i])
    }
    editor.apply()
  }

  fun normalizeHex(raw: String?): String? {
    val value = raw?.trim()?.takeIf { it.isNotBlank() } ?: return null
    val hex = if (value.startsWith("#")) value else "#$value"
    return try {
      val c = Color.parseColor(hex)
      String.format("#%02X%02X%02X", Color.red(c), Color.green(c), Color.blue(c))
    } catch (_: Throwable) {
      null
    }
  }
}
