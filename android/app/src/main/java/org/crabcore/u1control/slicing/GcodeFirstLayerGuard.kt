package org.crabcore.u1control.slicing

import java.io.File

/**
 * Caps first-layer extrusion moves after slicing.
 *
 * The prebuilt native core maps SliceConfig.firstLayerSpeed to first-layer
 * walls, but leaves first-layer infill at the embedded process-profile speed.
 * That produced 105 mm/s bottom-surface moves while adjacent walls ran at
 * 50 mm/s. Applying the guard to generated G-code protects STL and 3MF slices
 * through the same path without slowing later layers.
 */
object GcodeFirstLayerGuard {
  const val MAX_FEEDRATE_MM_PER_MIN = 3000.0

  private const val MARKER = "; helix_first_layer_feedrate_limit = 50 mm/s"
  private const val EPSILON = 0.000001
  private val parameterRegex = Regex(
    """(?i)([EF])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))""",
  )
  private val feedrateRegex = Regex(
    """(?i)(?<![A-Za-z0-9_])F\s*-?(?:\d+(?:\.\d*)?|\.\d+)""",
  )
  private val numberedLayerRegex = Regex("""(?i)^;\s*LAYER\s*:\s*(\d+)\s*$""")

  data class Result(
    val success: Boolean,
    val rewrittenMoves: Int,
    val alreadyApplied: Boolean = false,
  )

  fun apply(path: String): Result {
    val file = File(path)
    if (!file.exists() || !file.isFile) return Result(false, 0)
    if (file.bufferedReader().use { it.readLine() } == MARKER) {
      return Result(true, 0, alreadyApplied = true)
    }

    val temp = File(file.parentFile, "${file.name}.first-layer.tmp")
    var rewrittenMoves = 0
    var layerIndex = -1
    var sawLayerMarker = false
    var usesLayerChangeMarkers = false
    var relativeExtrusion = false
    var extrusionPosition = 0.0
    var modalFeedrate: Double? = null

    val wroteTemp = runCatching {
      temp.bufferedWriter().use { writer ->
        writer.write(MARKER)
        writer.newLine()

        file.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            val trimmed = line.trim()
            val commentBody = trimmed.removePrefix(";").trim()
            if (commentBody.equals("LAYER_CHANGE", ignoreCase = true)) {
              layerIndex += 1
              sawLayerMarker = true
              usesLayerChangeMarkers = true
            } else if (!usesLayerChangeMarkers) {
              numberedLayerRegex.matchEntire(trimmed)?.let { match ->
                layerIndex = match.groupValues[1].toInt()
                sawLayerMarker = true
              }
            }

            val code = line.substringBefore(';').trim()
            val command = code.substringBefore(' ').uppercase()
            val parameters = parameterRegex.findAll(code).associate { match ->
              match.groupValues[1].uppercase() to match.groupValues[2].toDouble()
            }

            var output = line
            when (command) {
              "M82" -> relativeExtrusion = false
              "M83" -> relativeExtrusion = true
              "G92" -> parameters["E"]?.let { extrusionPosition = it }
              "G0", "G1" -> {
                val explicitFeedrate = parameters["F"]
                if (explicitFeedrate != null && explicitFeedrate > 0.0) {
                  modalFeedrate = explicitFeedrate
                }

                val nextExtrusion = parameters["E"]
                if (nextExtrusion != null) {
                  val extrusionDelta = if (relativeExtrusion) {
                    extrusionPosition += nextExtrusion
                    nextExtrusion
                  } else {
                    val delta = nextExtrusion - extrusionPosition
                    extrusionPosition = nextExtrusion
                    delta
                  }

                  if (
                    layerIndex == 0 &&
                    extrusionDelta > EPSILON &&
                    (modalFeedrate ?: 0.0) > MAX_FEEDRATE_MM_PER_MIN
                  ) {
                    output = clampFeedrate(line)
                    modalFeedrate = MAX_FEEDRATE_MM_PER_MIN
                    rewrittenMoves += 1
                  }
                }
              }
            }

            writer.write(output)
            writer.newLine()
          }
        }
      }
      true
    }.getOrDefault(false)

    if (!wroteTemp || !sawLayerMarker) {
      temp.delete()
      return Result(false, 0)
    }
    if (!temp.renameTo(file)) {
      temp.delete()
      return Result(false, 0)
    }
    return Result(true, rewrittenMoves)
  }

  private fun clampFeedrate(line: String): String {
    val commentIndex = line.indexOf(';')
    val code = if (commentIndex >= 0) line.substring(0, commentIndex) else line
    val comment = if (commentIndex >= 0) line.substring(commentIndex) else ""
    val limitedCode = if (feedrateRegex.containsMatchIn(code)) {
      feedrateRegex.replace(code, "F${MAX_FEEDRATE_MM_PER_MIN.toInt()}")
    } else {
      "${code.trimEnd()} F${MAX_FEEDRATE_MM_PER_MIN.toInt()}"
    }.trimEnd()
    return if (comment.isEmpty()) limitedCode else "$limitedCode $comment"
  }
}
