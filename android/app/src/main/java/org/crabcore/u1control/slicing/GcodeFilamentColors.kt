package org.crabcore.u1control.slicing

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.zip.ZipFile

/**
 * Filament colours for the post-slice G-code preview — from the print file / gcode,
 * not the user's machine T0–T3 slot prefs.
 */
object GcodeFilamentColors {
  private val hexInText = Regex("#[0-9A-Fa-f]{6,8}")

  /** Prefer gcode embed, then source 3MF, then machine slot prefs. */
  fun resolve(context: Context, gcodePath: String, modelPath: String?): List<String> {
    // The bundled engine has no colour config, so gcode it produced carries
    // default white for every filament — that's "unset", not a real palette.
    // Desktop-sliced files keep their genuine gcode colours.
    val fromGcode = parseFromGcode(File(gcodePath))
    if (fromGcode.isNotEmpty() && !isDefaultPalette(fromGcode)) return fromGcode

    val model = modelPath?.let { File(it) }?.takeIf { it.exists() }
    if (model != null) {
      PrepareSession.paintedFileFor(model.absolutePath)?.let { painted ->
        readFromModel(File(painted)).takeIf { it.isNotEmpty() }?.let { return it }
      }
      readFromModel(model).takeIf { it.isNotEmpty() }?.let { return it }
    }

    if (fromGcode.isNotEmpty()) return fromGcode
    return FilamentSlotColors.read(context)
  }

  /** True when every colour is the engine's default white — no real palette. */
  private fun isDefaultPalette(colours: List<String>): Boolean =
    colours.all { it.equals("#FFFFFF", ignoreCase = true) }

  /**
   * Writes the true palette into the gcode's config comments, replacing any
   * existing `filament_colour`/`extruder_colour` lines (the engine emits default
   * white; the 3MF's project_settings often carries Bambu's stock palette, not
   * the model's). After this every consumer — preview, dialog, Moonraker — reads
   * the same real colours.
   */
  fun embedPalette(path: String, colours: List<String>): Boolean {
    if (colours.isEmpty()) return false
    val file = File(path)
    if (!file.exists()) return false
    val value = colours.joinToString(";")
    // Streamed line-by-line: gcode for large prints runs to tens of MB, and
    // readLines()+writeText() of the whole file OOMs on-device — which used to
    // silently skip the stamp and leave the engine's default-white palette.
    val tmp = File(file.parentFile, file.name + ".palette.tmp")
    return try {
      var replaced = false
      tmp.bufferedWriter().use { out ->
        file.bufferedReader().use { reader ->
          reader.forEachLine { line ->
            val trimmed = line.trim().removePrefix(";").trim()
            val isColourLine =
              (trimmed.startsWith("filament_colour", ignoreCase = true) ||
                trimmed.startsWith("extruder_colour", ignoreCase = true)) &&
                !trimmed.startsWith("default_filament_colour", ignoreCase = true) &&
                trimmed.contains('=')
            if (isColourLine) {
              replaced = true
              val key = trimmed.substringBefore('=').trim()
              out.write("; $key = $value")
            } else {
              out.write(line)
            }
            out.write(System.lineSeparator())
          }
        }
        if (!replaced) {
          out.write("; filament_colour = $value")
          out.write(System.lineSeparator())
        }
      }
      // rename(2) replaces the target atomically on Android — no window where
      // the gcode is missing.
      if (!tmp.renameTo(file)) {
        tmp.delete()
        return false
      }
      true
    } catch (_: Throwable) {
      runCatching { tmp.delete() }
      false
    }
  }

  /** Orca/Bambu/Prusa embed `; extruder_colour` / `; filament_colour` in gcode config blocks. */
  fun parseFromGcode(file: File): List<String> {
    if (!file.exists()) return emptyList()
    val lines = readGcodeConfigLines(file)
    return parseColourLines(lines)
  }

  fun readFromModel(file: File): List<String> {
    if (!file.name.endsWith(".3mf", ignoreCase = true)) return emptyList()
    return try {
      ZipFile(file).use { zip ->
        val paths = buildList {
          add("Metadata/project_settings.config")
          add("Metadata/Slic3r_PE.config")
          zip.entries().asSequence()
            .map { it.name }
            .filter {
              it.endsWith("project_settings.config", ignoreCase = true) ||
                it.endsWith("Slic3r_PE.config", ignoreCase = true)
            }
            .forEach { add(it) }
        }.distinct()
        for (path in paths) {
          val entry = zip.getEntry(path) ?: continue
          val text = zip.getInputStream(entry).bufferedReader().use { it.readText() }
          parseConfigText(text)?.takeIf { it.isNotEmpty() }?.let { return it }
        }
        emptyList()
      }
    } catch (_: Throwable) {
      emptyList()
    }
  }

  private fun readGcodeConfigLines(file: File): List<String> {
    val head = readTextLines(file, fromStart = true, maxBytes = 512 * 1024)
    val tail = readTextLines(file, fromStart = false, maxBytes = 512 * 1024)
    return head + tail
  }

  private fun readTextLines(file: File, fromStart: Boolean, maxBytes: Int): List<String> {
    return try {
      RandomAccessFile(file, "r").use { raf ->
        val size = raf.length()
        if (size <= 0) return emptyList()
        val readLen = minOf(maxBytes.toLong(), size)
        val start = if (fromStart) 0L else (size - readLen).coerceAtLeast(0)
        raf.seek(start)
        val bytes = ByteArray(readLen.toInt())
        raf.readFully(bytes)
        String(bytes, Charsets.UTF_8).lineSequence().toList()
      }
    } catch (_: Throwable) {
      emptyList()
    }
  }

  private fun parseColourLines(lines: List<String>): List<String> {
    var extruder: List<String>? = null
    var filament: List<String>? = null
    for (line in lines) {
      val trimmed = line.trim().removePrefix(";").trim()
      when {
        extruder == null && trimmed.startsWith("extruder_colour", ignoreCase = true) ->
          extruder = parseDelimitedColours(trimmed.substringAfter('='))
        filament == null &&
          trimmed.startsWith("filament_colour", ignoreCase = true) &&
          !trimmed.startsWith("default_filament_colour", ignoreCase = true) ->
          filament = parseDelimitedColours(trimmed.substringAfter('='))
      }
    }
    // filament_colour is the print's real palette; extruder_colour is the
    // machine's physical-extruder colour (often a single arbitrary swatch in
    // Bambu/Orca project settings) — only fall back to it when no filament
    // palette exists.
    return filament?.takeIf { it.isNotEmpty() }
      ?: extruder?.takeIf { it.isNotEmpty() }
      ?: emptyList()
  }

  private fun parseConfigText(text: String): List<String>? {
    val trimmed = text.trim()
    if (trimmed.startsWith("{")) {
      return try {
        val json = JSONObject(trimmed)
        coloursFromJson(json.optJSONArray("filament_colour"))
          ?: coloursFromJson(json.optJSONArray("extruder_colour"))
      } catch (_: Throwable) {
        null
      }
    }
    return parseColourLines(text.lineSequence().toList())
  }

  private fun coloursFromJson(arr: JSONArray?): List<String>? {
    if (arr == null || arr.length() == 0) return null
    return (0 until arr.length()).mapNotNull { i ->
      FilamentSlotColors.normalizeHex(arr.optString(i))
    }.takeIf { it.isNotEmpty() }
  }

  private fun parseDelimitedColours(raw: String): List<String> =
    raw.split(';', ',')
      .mapNotNull { part ->
        val token = hexInText.find(part.trim())?.value ?: part.trim()
        FilamentSlotColors.normalizeHex(token)
      }
}
