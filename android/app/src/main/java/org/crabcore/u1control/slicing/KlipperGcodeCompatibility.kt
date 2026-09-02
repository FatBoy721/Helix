package org.crabcore.u1control.slicing

import java.io.File
import java.util.Locale
import kotlin.math.sqrt

/**
 * Repairs Marlin-only commands emitted by the prebuilt slicer for a machine
 * profile that explicitly opts in. The native engine knows Orca's Klipper
 * keys, but its JNI SliceConfig bridge does not expose them to Kotlin.
 */
object KlipperGcodeCompatibility {
  data class Result(
    val success: Boolean,
    val rewritten: Boolean,
    val translatedLimits: Int,
    val strippedCommands: Int,
  )

  private data class Rewrite(val line: String?, val translated: Boolean)

  private val targetedCommand = Regex(
    """^(\s*)(M201|M203|M205|M486)\b(.*)$""",
    RegexOption.IGNORE_CASE,
  )
  private val xyParameter = Regex(
    """(?:^|\s)([XY])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))(?=\s|;|$)""",
    RegexOption.IGNORE_CASE,
  )

  fun apply(
    path: String,
    translateMarlinMachineLimits: Boolean,
    stripM486: Boolean,
  ): Result {
    val file = File(path)
    if (!file.exists() || !file.isFile) return Result(false, false, 0, 0)
    if (!translateMarlinMachineLimits && !stripM486) return Result(true, false, 0, 0)

    val tmp = File(file.parentFile, file.name + ".klipper.tmp")
    var changed = false
    var translated = 0
    var stripped = 0
    val completed = runCatching {
      tmp.bufferedWriter().use { out ->
        file.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            val match = targetedCommand.matchEntire(line)
            val command = match?.groupValues?.get(2)?.uppercase(Locale.US)
            val rewrite = when {
              command == "M486" && stripM486 -> Rewrite(null, false)
              command in MACHINE_LIMIT_COMMANDS && translateMarlinMachineLimits ->
                translateLimit(command!!, match!!.groupValues[3])
              else -> Rewrite(line, false)
            }

            if (rewrite.line != line) changed = true
            if (rewrite.translated) translated++
            if (rewrite.line == null) stripped++ else {
              out.write(rewrite.line)
              out.newLine()
            }
          }
        }
      }
      true
    }.getOrDefault(false)

    if (!completed) {
      tmp.delete()
      return Result(false, false, 0, 0)
    }
    if (!changed) {
      tmp.delete()
      return Result(true, false, 0, 0)
    }
    if (!tmp.renameTo(file)) {
      tmp.delete()
      return Result(false, false, 0, 0)
    }
    return Result(true, true, translated, stripped)
  }

  private fun translateLimit(command: String, arguments: String): Rewrite {
    val xyValues = xyParameter.findAll(arguments.substringBefore(';'))
      .mapNotNull { match ->
        match.groupValues[2].toDoubleOrNull()
          ?.takeIf { it.isFinite() && it >= 0.0 }
      }
      .toList()
    val xyLimit = xyValues.minOrNull() ?: return Rewrite(null, false)

    val (parameter, value) = when (command) {
      "M201" -> "ACCEL" to xyLimit
      "M203" -> "VELOCITY" to xyLimit
      // Marlin jerk is an instantaneous velocity-vector delta. At a 90-degree
      // corner that delta is sqrt(2) times Klipper's square-corner velocity.
      "M205" -> "SQUARE_CORNER_VELOCITY" to (xyLimit / sqrt(2.0))
      else -> return Rewrite(null, false)
    }
    return Rewrite(
      "SET_VELOCITY_LIMIT $parameter=${formatValue(value)} ; Helix translated $command",
      true,
    )
  }

  private fun formatValue(value: Double): String =
    String.format(Locale.US, "%.5f", value).trimEnd('0').trimEnd('.')

  private val MACHINE_LIMIT_COMMANDS = setOf("M201", "M203", "M205")
}
