package org.crabcore.u1control.slicing

import android.content.Context
import com.u1.slicer.NativeLibrary
import com.u1.slicer.data.SliceConfig
import com.u1.slicer.data.SliceResult
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The one true slice pipeline: load (painted file when Smart Paint saved one),
 * replay prepare-session edits, build the U1 config, slice, inject thumbnails.
 *
 * Shared by the RN bridge ([HelixSlicerModule.sliceFile]) and the prepare
 * screen's Slice button ([HelixModelPreviewActivity]) so both paths produce
 * identical G-code and can't drift apart.
 */
object HelixSliceRunner {

  private val slicing = AtomicBoolean(false)

  class BusyError : Exception("A slice is already running")
  class LoadError(msg: String) : Exception(msg)

  data class Outcome(
    val result: SliceResult?,
    val thumbnailsInjected: Boolean,
    val initialTool: Int,
    val usedToolMask: Int,
  )

  /**
   * Runs a full slice synchronously on the calling thread (callers spawn their
   * own worker). Throws [BusyError] when a slice is already running anywhere in
   * the app, [LoadError] when the model can't be loaded.
   *
   * [configure] applies caller options onto the [SliceConfig] before the
   * session's wipe-tower override.
   */
  fun run(
    context: Context,
    lib: NativeLibrary,
    path: String,
    onProgress: (Int, String) -> Unit,
    initialTool: Int = 0,
    configure: SliceConfig.() -> Unit = {},
  ): Outcome {
    if (!slicing.compareAndSet(false, true)) throw BusyError()
    try {
      lib.progressListener = onProgress
      synchronized(NativeEngineGuard.LOCK) {
        onProgress(0, "loading model")

        // Smart Paint: when the paint screen saved a painted 3MF for this model,
        // slice THAT file — it carries the per-triangle paint_color data.
        val effectivePath = PrepareSession.paintedFileFor(path)
          ?.takeIf { File(it).exists() }
          ?: path
        if (!lib.loadModel(effectivePath)) {
          throw LoadError("Engine could not load model: $effectivePath")
        }

        // Re-apply any prepare-screen edits (rotate/scale/copies/split/positions)
        // recorded for this model — loadModel wiped the engine's in-memory state.
        // (Painted files never have session ops: setPaintedFile clears them.)
        if (PrepareSession.hasEdits(path)) {
          onProgress(0, "applying arrangement")
          runCatching { PrepareSession.replay(path, lib) }
        }

        val (startGcode, endGcode) = readMachineGcode(context)
        val selectedTool = initialTool.coerceIn(0, 3)
        val config = SliceConfig(
          machineStartGcode = startGcode,
          machineEndGcode = endGcode,
        ).apply {
          configure()
          forceSingleTool(selectedTool)
          // Wipe tower position shown/dragged on the prepare screen.
          PrepareSession.towerPositionFor(path)?.let { (tx, ty) ->
            wipeTowerX = tx
            wipeTowerY = ty
          }
        }

        onProgress(1, "slicing")
        val result = lib.slice(config)
        val toolResult = if (result != null && result.success && result.gcodePath.isNotBlank()) {
          GcodeToolMapper.applyInitialTool(result.gcodePath, selectedTool)
        } else {
          GcodeToolMapper.Result(false, 1 shl selectedTool)
        }

        val thumbnailsInjected = if (result != null && result.success && result.gcodePath.isNotBlank()) {
          runCatching { GcodeThumbnailInjector.inject(result.gcodePath, path) }.getOrDefault(false)
        } else {
          false
        }
        if (result != null && result.success) {
          LastSliceStore.record(path, result, selectedTool, toolResult.usedToolMask)
        }
        return Outcome(result, thumbnailsInjected, selectedTool, toolResult.usedToolMask)
      }
    } finally {
      lib.progressListener = null
      slicing.set(false)
    }
  }

  // Snapmaker U1 machine start/end G-code from the bundled printer profile
  // (same asset + shape as the reference app's readPrinterMachineGcode).
  private fun readMachineGcode(context: Context): Pair<String, String> {
    return try {
      val json = context.assets
        .open("orca_profiles/printer/snapmaker_u1.json")
        .bufferedReader().use { JSONObject(it.readText()) }
      Pair(
        json.optString("machine_start_gcode", ""),
        json.optString("machine_end_gcode", ""),
      )
    } catch (error: Throwable) {
      "" to ""
    }
  }

  private fun SliceConfig.forceSingleTool(tool: Int) {
    if (tool !in 0..3) return
    val count = maxOf(extruderCount, tool + 1)
    extruderCount = count
    if (filamentTypes.size < count) {
      val existing = filamentTypes
      filamentTypes = Array(count) { i -> existing.getOrNull(i) ?: filamentType }
    }
    if (extruderTemps.size < count) {
      val existing = extruderTemps
      extruderTemps = IntArray(count) { i -> existing.getOrNull(i) ?: nozzleTemp }
    }
    if (extruderRetractLength.size < count) {
      val existing = extruderRetractLength
      extruderRetractLength = FloatArray(count) { i -> existing.getOrNull(i) ?: retractLength }
    }
    if (extruderRetractSpeed.size < count) {
      val existing = extruderRetractSpeed
      extruderRetractSpeed = FloatArray(count) { i -> existing.getOrNull(i) ?: retractSpeed }
    }
    supportFilament = tool
    supportInterfaceFilament = tool
  }
}
