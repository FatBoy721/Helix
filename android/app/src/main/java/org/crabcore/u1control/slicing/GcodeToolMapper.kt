package org.crabcore.u1control.slicing

import java.io.File

/**
 * The bundled slicer core is prebuilt, so Helix cannot add new native config
 * fields for initial_extruder. For single-tool slices we patch the generated
 * startup tool selection to the loaded U1 head selected by RN.
 */
object GcodeToolMapper {
  data class Result(val rewritten: Boolean, val usedToolMask: Int)

  private val toolZeroToken = Regex("""(?<![A-Za-z0-9_])T0(?![A-Za-z0-9_])""")
  private val toolAnyToken = Regex("""(?<![A-Za-z0-9_])T([0-3])(?![A-Za-z0-9_])""")
  private val extruderZero = Regex("""\bEXTRUDER=0\b""", RegexOption.IGNORE_CASE)
  private val indexZero = Regex("""\bINDEX=0\b""", RegexOption.IGNORE_CASE)
  private val toolParamZero = Regex("""\bTOOL=0\b""", RegexOption.IGNORE_CASE)
  private val extruderAny = Regex("""\bEXTRUDER=([0-3])\b""", RegexOption.IGNORE_CASE)
  private val indexAny = Regex("""\bINDEX=([0-3])\b""", RegexOption.IGNORE_CASE)

  fun applyInitialTool(path: String, initialTool: Int): Result {
    val file = File(path)
    val tool = initialTool.coerceIn(0, 3)
    if (!file.exists() || !file.isFile) return Result(false, 1 shl tool)

    val original = runCatching { file.readLines() }.getOrNull()
      ?: return Result(false, 1 shl tool)
    var changed = false
    var inThumbnail = false
    var inStartup = true

    val mapped = original.map { line ->
      val trimmed = line.trimStart()
      if (trimmed.startsWith("; thumbnail begin", ignoreCase = true)) {
        inThumbnail = true
      }

      var next = line
      if (!inThumbnail && tool != 0 && inStartup && !trimmed.startsWith(";")) {
        next = toolParamZero.replace(next, "TOOL=$tool")
        next = extruderZero.replace(next, "EXTRUDER=$tool")
        next = indexZero.replace(next, "INDEX=$tool")
        next = toolZeroToken.replace(next, "T$tool")
      }
      if (next != line) changed = true

      if (trimmed.equals("TIMELAPSE_START", ignoreCase = true) ||
        trimmed.startsWith(";LAYER", ignoreCase = true) ||
        trimmed.startsWith("; LAYER", ignoreCase = true)
      ) {
        inStartup = false
      }
      if (trimmed.startsWith("; thumbnail end", ignoreCase = true)) {
        inThumbnail = false
      }
      next
    }

    if (changed) {
      val newline = System.lineSeparator()
      val hadTrailingNewline = original.isNotEmpty()
      runCatching {
        file.writeText(mapped.joinToString(newline) + if (hadTrailingNewline) newline else "")
      }.onFailure {
        return Result(false, scanUsedToolMask(original, tool))
      }
    }

    return Result(changed, scanUsedToolMask(if (changed) mapped else original, tool))
  }

  private fun scanUsedToolMask(lines: List<String>, fallbackTool: Int): Int {
    var mask = 0
    var inThumbnail = false

    for (line in lines) {
      val trimmed = line.trimStart()
      if (trimmed.startsWith("; thumbnail begin", ignoreCase = true)) {
        inThumbnail = true
      }

      if (!inThumbnail && !trimmed.startsWith(";")) {
        toolAnyToken.findAll(line).forEach { match ->
          mask = mask or (1 shl match.groupValues[1].toInt())
        }
        if (trimmed.startsWith("SM_PRINT_", ignoreCase = true)) {
          extruderAny.findAll(line).forEach { match ->
            mask = mask or (1 shl match.groupValues[1].toInt())
          }
          indexAny.findAll(line).forEach { match ->
            mask = mask or (1 shl match.groupValues[1].toInt())
          }
        }
      }

      if (trimmed.startsWith("; thumbnail end", ignoreCase = true)) {
        inThumbnail = false
      }
    }

    return if (mask == 0) 1 shl fallbackTool.coerceIn(0, 3) else mask
  }
}
