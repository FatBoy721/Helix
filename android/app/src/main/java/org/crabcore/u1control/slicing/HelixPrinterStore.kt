package org.crabcore.u1control.slicing

import android.content.Context

/**
 * The RN app's printer list, mirrored into native prefs (like FilamentSlotColors)
 * so the gcode preview's Print Preprocessing dialog can offer a printer picker.
 * RN refreshes it via HelixSlicerModule.setPrinters whenever settings change.
 */
object HelixPrinterStore {
  data class Printer(val name: String, val url: String, val tailscaleUrl: String = "")

  private const val PREFS = "helix_printers"
  private const val KEY = "printers"

  fun write(context: Context, printers: List<Printer>) {
    val encoded = printers
      .filter { it.url.isNotBlank() || it.tailscaleUrl.isNotBlank() }
      .joinToString("\n") { p ->
        // JSON array per line: [name, url, tailscaleUrl]. Unambiguous + extensible.
        org.json.JSONArray().apply {
          put(p.name.replace("\n", " "))
          put(p.url)
          put(p.tailscaleUrl)
        }.toString()
      }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(KEY, encoded).apply()
  }

  fun read(context: Context): List<Printer> =
    (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "") ?: "")
      .lineSequence()
      .mapNotNull { line ->
        val trimmed = line.trim()
        if (trimmed.isEmpty()) return@mapNotNull null
        // New format: JSON array [name, url, tailscaleUrl].
        if (trimmed.startsWith("[")) {
          try {
            val a = org.json.JSONArray(trimmed)
            val name = a.optString(0).trim().ifBlank { "Printer" }
            val url = a.optString(1).trim()
            val tailscale = a.optString(2).trim()
            if (url.isBlank() && tailscale.isBlank()) null
            else Printer(name, url, tailscale)
          } catch (_: Throwable) {
            null
          }
        } else {
          // Legacy pipe-delimited "name|url" (pre-failover installs).
          val idx = trimmed.lastIndexOf('|')
          if (idx <= 0) return@mapNotNull null
          val name = trimmed.substring(0, idx).trim()
          val url = trimmed.substring(idx + 1).trim()
          if (url.isBlank()) null else Printer(name.ifBlank { "Printer" }, url)
        }
      }
      .toList()
}
