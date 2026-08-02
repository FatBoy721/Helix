package org.crabcore.u1control.slicing

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.File

/**
 * Reads the largest thumbnail a slicer embedded in a .gcode header.
 *
 * Shared by the RN bridge ([HelixSlicerModule.getGcodeThumbnail]) and the native
 * print preprocess sheet, so both show the render baked in at slice time rather
 * than waiting on a Moonraker upload.
 */
object GcodeThumbnailReader {
  private const val BEGIN = "; thumbnail begin"
  private const val END = "; thumbnail end"

  /** Base64 PNG of the largest embedded thumbnail, or null when there is none. */
  fun readBase64(path: String): String? {
    val file = File(path.removePrefix("file://"))
    if (!file.exists()) return null

    var bestArea = 0
    var best: String? = null
    var currentArea = 0
    var current: StringBuilder? = null

    return try {
      file.bufferedReader().use { reader ->
        while (true) {
          val line = reader.readLine() ?: break
          val trimmed = line.trim()
          when {
            trimmed.startsWith(BEGIN) -> {
              val dims = trimmed.removePrefix(BEGIN).trim().substringBefore(' ').split('x')
              currentArea = (dims.getOrNull(0)?.toIntOrNull() ?: 0) *
                (dims.getOrNull(1)?.toIntOrNull() ?: 0)
              current = StringBuilder()
            }
            trimmed.startsWith(END) -> {
              val block = current
              if (block != null && currentArea > bestArea) {
                bestArea = currentArea
                best = block.toString()
              }
              current = null
            }
            current != null && trimmed.startsWith(";") ->
              current?.append(trimmed.removePrefix(";").trim())
            // Thumbnails live in the header; stop once real motion starts.
            best != null && (trimmed.startsWith("G1") || trimmed.startsWith("G0")) -> return@use
          }
        }
      }
      best
    } catch (_: Throwable) {
      null
    }
  }

  fun readDataUri(path: String): String? = readBase64(path)?.let { "data:image/png;base64,$it" }

  fun readBitmap(path: String): Bitmap? {
    val encoded = readBase64(path) ?: return null
    return try {
      val bytes = Base64.decode(encoded, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: Throwable) {
      null
    }
  }
}
