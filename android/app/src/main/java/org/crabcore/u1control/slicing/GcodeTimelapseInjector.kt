package org.crabcore.u1control.slicing

import java.io.File

/** Adds one timelapse frame command per layer without loading the G-code into memory. */
object GcodeTimelapseInjector {
  private val layerChange = Regex("""^;LAYER_CHANGE(?:\s.*)?$""", RegexOption.IGNORE_CASE)
  private val start = commandRegex("TIMELAPSE_START")
  private val stop = commandRegex("TIMELAPSE_STOP")
  private val takeFrame = commandRegex("TIMELAPSE_TAKE_FRAME")

  fun inject(path: String, outputDir: File): File {
    val source = File(path.removePrefix("file://"))
    require(source.exists() && source.isFile) { "G-code file not found: ${source.absolutePath}" }
    require(source.length() > 0L) { "G-code file is empty: ${source.absolutePath}" }

    var layerCount = 0
    var hasStart = false
    var hasStop = false
    var framesNormalized = true
    var previousWasLayer = false
    source.bufferedReader().useLines { lines ->
      lines.forEach { line ->
        if (previousWasLayer && !takeFrame.matches(line)) framesNormalized = false
        previousWasLayer = layerChange.matches(line)
        if (previousWasLayer) layerCount++
        if (start.matches(line)) hasStart = true
        if (stop.matches(line)) hasStop = true
      }
    }
    if (previousWasLayer) framesNormalized = false

    if (layerCount == 0 || (hasStart && hasStop && framesNormalized)) return source

    outputDir.mkdirs()
    val output = File(outputDir, "tl_${source.name}")
    val temp = File(outputDir, ".${output.name}.tmp")
    temp.delete()
    try {
      var startWritten = hasStart
      temp.bufferedWriter().use { writer ->
        source.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            if (takeFrame.matches(line)) return@forEach
            if (layerChange.matches(line) && !startWritten) {
              writer.appendLine("TIMELAPSE_START")
              startWritten = true
            }
            writer.appendLine(line)
            if (layerChange.matches(line)) writer.appendLine("TIMELAPSE_TAKE_FRAME")
          }
        }
        if (!hasStop) writer.appendLine("TIMELAPSE_STOP")
      }
      if (output.exists() && !output.delete()) {
        error("Could not replace existing timelapse G-code: ${output.absolutePath}")
      }
      check(temp.renameTo(output)) { "Could not finalize timelapse G-code: ${output.absolutePath}" }
      return output
    } catch (error: Throwable) {
      temp.delete()
      throw error
    }
  }

  private fun commandRegex(command: String) =
    Regex("""^\s*$command(?:\s+.*)?$""", RegexOption.IGNORE_CASE)
}
