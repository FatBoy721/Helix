package org.crabcore.u1control.slicing

import java.io.File
import java.util.Locale

/**
 * The bundled slicer core is prebuilt, so Helix cannot add new native config
 * fields for initial_extruder. For single-tool slices we patch the generated
 * startup tool selection to the loaded U1 head selected by RN.
 */
object GcodeToolMapper {
  data class Result(val rewritten: Boolean, val usedToolMask: Int)
  data class BedMeshResult(val success: Boolean, val rewritten: Boolean)

  private data class BedMeshLineResult(val line: String, val valid: Boolean)

  private val toolZeroToken = Regex("""(?<![A-Za-z0-9_])T0(?![A-Za-z0-9_])""")
  private val toolAnyToken = Regex("""(?<![A-Za-z0-9_])T([0-3])(?![A-Za-z0-9_])""")
  private val extruderZero = Regex("""\bEXTRUDER=0\b""", RegexOption.IGNORE_CASE)
  private val indexZero = Regex("""\bINDEX=0\b""", RegexOption.IGNORE_CASE)
  private val toolParamZero = Regex("""\bTOOL=0\b""", RegexOption.IGNORE_CASE)
  private val extruderAny = Regex("""\bEXTRUDER=([0-3])\b""", RegexOption.IGNORE_CASE)
  private val indexAny = Regex("""\bINDEX=([0-3])\b""", RegexOption.IGNORE_CASE)
  private val bedMeshBounds = Regex(
    """(\bmesh_min=)(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(\s+mesh_max=)(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)""",
    RegexOption.IGNORE_CASE,
  )

  // Keep adaptive probing inside the U1's safe bed-mesh area. Model bounds
  // can extend past X=0 even though the printer's motion range starts there.
  private const val U1_BED_MESH_MIN = 3.0
  private const val U1_BED_MESH_MAX = 267.0
  private const val U1_BED_MESH_MIN_SPAN = 1.0

  fun applyInitialTool(path: String, initialTool: Int): Result {
    val file = File(path)
    val tool = initialTool.coerceIn(0, 3)
    if (!file.exists() || !file.isFile) return Result(false, 1 shl tool)

    // Streamed to a temp file: gcode for large prints runs to tens of MB, and
    // readLines()+writeText() of the whole file OOMs on-device — which used to
    // silently skip the remap and start huge prints from T0.
    val tmp = File(file.parentFile, file.name + ".tool.tmp")
    var changed = false
    var mask = 0
    val rewritten = runCatching {
      var inThumbnail = false
      var inStartup = true
      tmp.bufferedWriter().use { out ->
        file.bufferedReader().use { reader ->
          reader.forEachLine { line ->
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
            mask = mask or scanToolMaskLine(next, inThumbnail)

            if (trimmed.equals("TIMELAPSE_START", ignoreCase = true) ||
              trimmed.startsWith(";LAYER", ignoreCase = true) ||
              trimmed.startsWith("; LAYER", ignoreCase = true)
            ) {
              inStartup = false
            }
            if (trimmed.startsWith("; thumbnail end", ignoreCase = true)) {
              inThumbnail = false
            }
            out.write(next)
            out.write(System.lineSeparator())
          }
        }
      }
      true
    }.getOrDefault(false)

    if (!rewritten) {
      tmp.delete()
      // Rewrite pass failed — report the mask from a scan-only pass so the
      // caller still gets truthful used-tool data.
      val scanned = runCatching {
        file.bufferedReader().useLines { lines -> scanUsedToolMask(lines, tool) }
      }.getOrNull() ?: (1 shl tool)
      return Result(false, scanned)
    }

    if (changed) {
      // rename(2) replaces the target atomically on Android.
      if (!tmp.renameTo(file)) {
        tmp.delete()
        return Result(false, if (mask == 0) 1 shl tool else mask)
      }
    } else {
      tmp.delete()
    }
    return Result(changed, if (mask == 0) 1 shl tool else mask)
  }

  fun clampU1BedMeshBounds(path: String): BedMeshResult {
    val file = File(path)
    if (!file.exists() || !file.isFile) return BedMeshResult(false, false)

    var needsRewrite = false
    val safeToRewrite = runCatching {
      file.bufferedReader().useLines { lines ->
        lines.forEach { line ->
          val result = rewriteBedMeshLine(line)
          if (!result.valid) return@runCatching false
          if (result.line != line) needsRewrite = true
        }
      }
      true
    }.getOrDefault(false)

    if (!safeToRewrite) return BedMeshResult(false, false)
    if (!needsRewrite) return BedMeshResult(true, false)

    val tmp = File(file.parentFile, file.name + ".bedmesh.tmp")
    val rewritten = runCatching {
      tmp.bufferedWriter().use { out ->
        file.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            val result = rewriteBedMeshLine(line)
            check(result.valid)
            out.write(result.line)
            out.newLine()
          }
        }
      }
      true
    }.getOrDefault(false)

    if (!rewritten) {
      tmp.delete()
      return BedMeshResult(false, false)
    }
    if (!tmp.renameTo(file)) {
      tmp.delete()
      return BedMeshResult(false, false)
    }
    return BedMeshResult(true, true)
  }

  private fun rewriteBedMeshLine(line: String): BedMeshLineResult {
    val trimmed = line.trimStart()
    if (!trimmed.startsWith("BED_MESH_CALIBRATE", ignoreCase = true)) {
      return BedMeshLineResult(line, true)
    }

    val match = bedMeshBounds.find(line) ?: return BedMeshLineResult(line, true)
    val minX = match.groupValues[2].toDoubleOrNull()
    val minY = match.groupValues[3].toDoubleOrNull()
    val maxX = match.groupValues[5].toDoubleOrNull()
    val maxY = match.groupValues[6].toDoubleOrNull()
    if (minX == null || minY == null || maxX == null || maxY == null) {
      return BedMeshLineResult(line, false)
    }

    val safeX = safeAxisBounds(minX, maxX) ?: return BedMeshLineResult(line, false)
    val safeY = safeAxisBounds(minY, maxY) ?: return BedMeshLineResult(line, false)
    if (safeX.first == minX && safeX.second == maxX &&
      safeY.first == minY && safeY.second == maxY
    ) {
      return BedMeshLineResult(line, true)
    }

    val replacement = "${match.groupValues[1]}${formatCoordinate(safeX.first)},${formatCoordinate(safeY.first)}" +
      "${match.groupValues[4]}${formatCoordinate(safeX.second)},${formatCoordinate(safeY.second)}"
    return BedMeshLineResult(line.replaceRange(match.range, replacement), true)
  }

  private fun safeAxisBounds(rawMin: Double, rawMax: Double): Pair<Double, Double>? {
    if (!rawMin.isFinite() || !rawMax.isFinite() || rawMax <= rawMin) return null

    val safeRange = U1_BED_MESH_MAX - U1_BED_MESH_MIN
    val span = (rawMax - rawMin).coerceIn(U1_BED_MESH_MIN_SPAN, safeRange)
    val min = rawMin.coerceIn(U1_BED_MESH_MIN, U1_BED_MESH_MAX - span)
    return min to (min + span)
  }

  private fun formatCoordinate(value: Double): String =
    String.format(Locale.US, "%.5f", value)

  /** Tool bits used by [line]; 0 when inside a thumbnail block or a comment. */
  private fun scanToolMaskLine(line: String, inThumbnail: Boolean): Int {
    val trimmed = line.trimStart()
    if (inThumbnail || trimmed.startsWith(";")) return 0
    var mask = 0
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
    return mask
  }

  private fun scanUsedToolMask(lines: Sequence<String>, fallbackTool: Int): Int {
    var mask = 0
    var inThumbnail = false

    for (line in lines) {
      val trimmed = line.trimStart()
      if (trimmed.startsWith("; thumbnail begin", ignoreCase = true)) {
        inThumbnail = true
      }

      mask = mask or scanToolMaskLine(line, inThumbnail)

      if (trimmed.startsWith("; thumbnail end", ignoreCase = true)) {
        inThumbnail = false
      }
    }

    return if (mask == 0) 1 shl fallbackTool.coerceIn(0, 3) else mask
  }

  /**
   * Multicolor slices keep every tool change as the engine emitted them — no
   * startup remap. This just reports which tools the gcode actually uses.
   */
  fun usedMaskOnly(path: String): Result {
    val file = File(path)
    // Streamed: multicolor gcode runs to tens of MB; readLines() of the whole
    // file OOMs on-device and used to silently report "T0 only".
    val mask = runCatching {
      file.bufferedReader().useLines { lines -> scanUsedToolMask(lines, 0) }
    }.getOrNull() ?: return Result(false, 1)
    return Result(false, mask)
  }

  private val extruderParamAny = Regex("""\b(EXTRUDER|INDEX|TOOL)=([0-3])\b""", RegexOption.IGNORE_CASE)

  /**
   * Rewrites every tool reference through [mapping] (index = slicer tool,
   * value = physical U1 slot chosen in the print dialog). Writes the remapped
   * gcode to [outPath] so the original slice stays untouched. Single pass per
   * line, so chained collisions (T0→T1 while T1→T0) are safe.
   */
  fun applyToolMapping(srcPath: String, outPath: String, mapping: IntArray): Boolean {
    if (mapping.size != 4 || mapping.withIndex().all { (i, v) -> i == v }) return false
    val src = File(srcPath)
    if (!src.exists()) return false

    return try {
      var inThumbnail = false
      File(outPath).bufferedWriter().use { out ->
        src.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            val trimmed = line.trimStart()
            if (trimmed.startsWith("; thumbnail begin", ignoreCase = true)) inThumbnail = true
            var next = line
            if (!inThumbnail && !trimmed.startsWith(";")) {
              next = toolAnyToken.replace(next) { m ->
                "T${mapping[m.groupValues[1].toInt()].coerceIn(0, 3)}"
              }
              next = extruderParamAny.replace(next) { m ->
                "${m.groupValues[1]}=${mapping[m.groupValues[2].toInt()].coerceIn(0, 3)}"
              }
            }
            if (trimmed.startsWith("; thumbnail end", ignoreCase = true)) inThumbnail = false
            out.write(next)
            out.newLine()
          }
        }
      }
      true
    } catch (_: Throwable) {
      runCatching { File(outPath).delete() }
      false
    }
  }
}
