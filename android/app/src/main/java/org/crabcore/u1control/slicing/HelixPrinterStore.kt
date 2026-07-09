package org.crabcore.u1control.slicing

import android.content.Context

/**
 * The RN app's printer list, mirrored into native prefs (like FilamentSlotColors)
 * so the gcode preview's Print Preprocessing dialog can offer a printer picker.
 * RN refreshes it via HelixSlicerModule.setPrinters whenever settings change.
 */
object HelixPrinterStore {
  data class Printer(val name: String, val url: String)

  private const val PREFS = "helix_printers"
  private const val KEY = "printers"

  fun write(context: Context, printers: List<Printer>) {
    val encoded = printers
      .filter { it.url.isNotBlank() }
      .joinToString("\n") { "${it.name.replace("\n", " ")}|${it.url}" }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(KEY, encoded).apply()
  }

  fun read(context: Context): List<Printer> =
    (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "") ?: "")
      .lineSequence()
      .mapNotNull { line ->
        val idx = line.lastIndexOf('|')
        if (idx <= 0) return@mapNotNull null
        val name = line.substring(0, idx).trim()
        val url = line.substring(idx + 1).trim()
        if (url.isBlank()) null else Printer(name.ifBlank { "Printer" }, url)
      }
      .toList()
}
