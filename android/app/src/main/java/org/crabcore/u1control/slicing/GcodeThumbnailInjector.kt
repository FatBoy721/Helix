package org.crabcore.u1control.slicing

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile

object GcodeThumbnailInjector {
  private const val TAG = "HelixThumbnail"
  private val scoreKeywords = listOf("thumbnail", "preview", "cover", "top", "plate", "pick")
  private val plateHintRegex = Regex("""(?i)plate[_-]?(\d+)""")
  private val thumbnailSizes = listOf(48 to 48, 300 to 300)

  fun inject(gcodePath: String, sourcePath: String): Boolean {
    val sourceFile = File(sourcePath)
    if (!sourceFile.exists() || !sourceFile.name.endsWith(".3mf", ignoreCase = true)) return false

    val bitmap = extractPreviewImage(sourceFile, inferPlateHint(sourceFile.name)) ?: return false
    val blocks = buildThumbnailBlocks(bitmap)
    bitmap.recycle()
    if (blocks.isBlank()) return false
    return injectIntoGcode(gcodePath, blocks)
  }

  private fun extractPreviewImage(threeMfFile: File, plateHint: Int?): Bitmap? {
    return try {
      ZipFile(threeMfFile).use { zip ->
        val candidates = zip.entries().asSequence()
          .filter { !it.isDirectory }
          .filter {
            it.name.endsWith(".png", true) ||
              it.name.endsWith(".jpg", true) ||
              it.name.endsWith(".jpeg", true)
          }
          .toList()
        if (candidates.isEmpty()) return null

        val best = candidates
          .map { it to scorePreviewEntry(it, plateHint) }
          .sortedWith(compareByDescending<Pair<ZipEntry, Long>> { it.second }.thenBy { candidates.indexOf(it.first) })
          .first()
          .first
        val bytes = zip.getInputStream(best).use { it.readBytes() }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      }
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to extract 3MF preview: ${error.message}")
      null
    }
  }

  private fun scorePreviewEntry(entry: ZipEntry, plateHint: Int?): Long {
    val name = entry.name.lowercase()
    val base = name.substringAfterLast('/')
    // Prefer the slicer's lit plate render (Metadata/plate_N.png) — that's the
    // clean isometric preview the printer cards show. Cover/marketing images and
    // object-pick masks rank lowest.
    var score = when {
      base.startsWith("pick_") || base.contains("_no_light") -> 2L
      Regex("""^plate_\d+\.""").containsMatchIn(base) -> 100L   // lit plate render
      base == "plate.png" || base == "plate.jpg" -> 95L
      Regex("""^top_\d+\.""").containsMatchIn(base) -> 80L       // top-down plate
      base.startsWith("thumbnail_middle") -> 40L
      base.startsWith("thumbnail_3mf") -> 30L
      base.startsWith("thumbnail") -> 25L
      base.contains("cover") -> 8L
      else -> 5L
    }
    score += scoreKeywords.sumOf { keyword -> if (name.contains(keyword)) 1L else 0L }
    if (plateHint != null) {
      val hints = listOf(
        "plate_no_light_${plateHint}.png" to 120L,
        "plate_no_light_${plateHint}.jpg" to 120L,
        "plate_no_light_${plateHint}.jpeg" to 120L,
        "plate_${plateHint}.png" to 110L,
        "plate_${plateHint}.jpg" to 110L,
        "plate_${plateHint}.jpeg" to 110L,
        "top_${plateHint}.png" to 100L,
        "top_${plateHint}.jpg" to 100L,
        "top_${plateHint}.jpeg" to 100L,
        "pick_${plateHint}.png" to 90L,
        "pick_${plateHint}.jpg" to 90L,
        "pick_${plateHint}.jpeg" to 90L,
      )
      for ((suffix, bonus) in hints) {
        if (name.endsWith(suffix)) {
          score += bonus
          break
        }
      }
    }
    return score
  }

  private fun inferPlateHint(sourceName: String): Int? {
    return plateHintRegex.find(sourceName)?.groupValues?.getOrNull(1)?.toIntOrNull()
  }

  /** True if the gcode already carries an embedded thumbnail (e.g. from a 3MF). */
  fun hasThumbnail(gcodePath: String): Boolean {
    val file = File(gcodePath)
    if (!file.exists()) return false
    file.bufferedReader().use { r ->
      var line: String?
      var scanned = 0
      while (r.readLine().also { line = it } != null) {
        if ((line ?: "").contains("; thumbnail begin")) return true
        // Thumbnails live in the header; give up once past it.
        if (++scanned > 8000) return false
      }
    }
    return false
  }

  /**
   * Injects a rendered bitmap (the live 3D plate) as the gcode thumbnail,
   * replacing any thumbnail blocks already present.
   */
  fun injectBitmap(gcodePath: String, bitmap: Bitmap): Boolean {
    val blocks = buildThumbnailBlocks(bitmap)
    if (blocks.isBlank()) return false
    stripThumbnails(gcodePath)
    return injectIntoGcode(gcodePath, blocks)
  }

  private fun stripThumbnails(gcodePath: String) {
    val file = File(gcodePath)
    if (!file.exists()) return
    val tmp = File("$gcodePath.strip")
    try {
      var inThumb = false
      tmp.bufferedWriter(Charsets.UTF_8).use { w ->
        file.bufferedReader(Charsets.UTF_8).use { r ->
          var line: String?
          while (r.readLine().also { line = it } != null) {
            val cur = line ?: break
            if (cur.contains("; thumbnail begin")) { inThumb = true; continue }
            if (inThumb) {
              if (cur.contains("; thumbnail end")) inThumb = false
              continue
            }
            w.write(cur); w.newLine()
          }
        }
      }
      if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    } catch (_: Throwable) {
      tmp.delete()
    }
  }

  private fun buildThumbnailBlocks(source: Bitmap): String {
    val out = StringBuilder()
    for ((width, height) in thumbnailSizes) {
      val scaled = Bitmap.createScaledBitmap(source, width, height, true)
      val rgb = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
      val canvas = Canvas(rgb)
      canvas.drawColor(Color.WHITE)
      canvas.drawBitmap(scaled, 0f, 0f, null)
      if (scaled !== source) scaled.recycle()

      val pngBytes = ByteArrayOutputStream().use { stream ->
        rgb.compress(Bitmap.CompressFormat.PNG, 100, stream)
        stream.toByteArray()
      }
      rgb.recycle()

      val encoded = Base64.encodeToString(pngBytes, Base64.NO_WRAP)
      out.append("; thumbnail begin ${width}x${height} ${encoded.length}\n")
      var index = 0
      while (index < encoded.length) {
        val end = minOf(index + 76, encoded.length)
        out.append("; ${encoded.substring(index, end)}\n")
        index = end
      }
      out.append("; thumbnail end\n;\n")
    }
    return out.toString()
  }

  private fun injectIntoGcode(gcodePath: String, blocks: String): Boolean {
    val file = File(gcodePath)
    if (!file.exists() || !file.isFile) return false

    val temp = File("$gcodePath.tmp")
    val prepend = File("$gcodePath.pre")
    return try {
      var injected = false
      temp.bufferedWriter(Charsets.UTF_8).use { writer ->
        file.bufferedReader(Charsets.UTF_8).use { reader ->
          var line: String?
          while (reader.readLine().also { line = it } != null) {
            val current = line ?: break
            writer.write(current)
            writer.newLine()
            if (!injected && current.contains("; HEADER_BLOCK_END")) {
              writer.write(blocks)
              injected = true
            }
          }
        }
      }

      val finalFile = if (injected) temp else {
        prepend.bufferedWriter(Charsets.UTF_8).use { writer ->
          writer.write(blocks)
          temp.bufferedReader(Charsets.UTF_8).use { reader ->
            var line: String?
            while (reader.readLine().also { line = it } != null) {
              writer.write(line ?: break)
              writer.newLine()
            }
          }
        }
        temp.delete()
        prepend
      }

      if (!finalFile.renameTo(file)) {
        file.delete()
        finalFile.renameTo(file)
      }
      Log.i(TAG, "Injected thumbnail blocks into ${file.name}")
      true
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to inject thumbnails: ${error.message}")
      temp.delete()
      prepend.delete()
      false
    }
  }
}
